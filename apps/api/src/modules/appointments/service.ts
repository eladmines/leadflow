import type { Prisma, PrismaClient } from '@prisma/client';
import {
  appointmentMessages,
  BLOCKING_STATUSES,
  can,
  type Appointment,
  type appointmentListQuerySchema,
  type createAppointmentRequestSchema,
  type Service,
  type updateAppointmentRequestSchema,
  type upsertServiceRequestSchema,
} from '@leadflow/shared';
import type { z } from 'zod';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';

const include = {
  service: { select: { id: true, name: true } },
  staff: { select: { id: true, fullName: true } },
  contact: { select: { id: true, name: true, phone: true } },
} as const;
type Row = Prisma.AppointmentGetPayload<{ include: typeof include }>;

const toDto = (r: Row): Appointment => ({
  id: r.id,
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt.toISOString(),
  status: r.status,
  notes: r.notes,
  source: r.source === 'website' ? 'website' : 'manual',
  service: r.service,
  staff: r.staff ? { id: r.staff.id, name: r.staff.fullName } : null,
  customer: r.contact,
  lead: r.leadId ? { id: r.leadId } : null,
  createdAt: r.createdAt.toISOString(),
});

const serviceDto = (s: {
  id: string;
  name: string;
  durationMin: number;
  price: number | null;
  active: boolean;
}): Service => ({
  id: s.id,
  name: s.name,
  durationMin: s.durationMin,
  price: s.price,
  active: s.active,
});

type ServiceInput = z.output<typeof upsertServiceRequestSchema>;
type ListQuery = z.output<typeof appointmentListQuerySchema>;
type CreateInput = z.output<typeof createAppointmentRequestSchema>;
type UpdateInput = z.output<typeof updateAppointmentRequestSchema>;

const DEFAULT_DURATION = 30;
const invalid = (field: string, message: string) =>
  new AppError('VALIDATION_ERROR', message, { [field]: message });

export class AppointmentService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- services

  async listServices(ctx: TenantContext): Promise<Service[]> {
    const rows = await this.prisma.service.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(serviceDto);
  }

  async createService(ctx: TenantContext, input: ServiceInput): Promise<Service> {
    const row = await this.prisma.service.create({
      data: { businessId: ctx.businessId, ...input },
    });
    return serviceDto(row);
  }

  private async findService(db: Db, ctx: TenantContext, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.service.findFirst({ where: { id, businessId: ctx.businessId } })
      : null;
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  async updateService(ctx: TenantContext, id: string, input: ServiceInput): Promise<Service> {
    await this.findService(this.prisma, ctx, id);
    return serviceDto(await this.prisma.service.update({ where: { id }, data: input }));
  }

  /** Unused services are deleted; services with appointments are deactivated (history stays). */
  async removeService(ctx: TenantContext, id: string): Promise<void> {
    await this.findService(this.prisma, ctx, id);
    const used = await this.prisma.appointment.count({ where: { serviceId: id } });
    if (used) await this.prisma.service.update({ where: { id }, data: { active: false } });
    else await this.prisma.service.delete({ where: { id } });
  }

  // ------------------------------------------------------------ appointments

  /** Owner/manager: everything; employee: appointments they are booked on. */
  private visible(ctx: TenantContext): Prisma.AppointmentWhereInput {
    return {
      businessId: ctx.businessId,
      ...(can(ctx.role, 'appointments.view.all') ? {} : { staffId: ctx.userId }),
    };
  }

  private async findVisible(ctx: TenantContext, id: string, db: Db = this.prisma) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.appointment.findFirst({ where: { id, ...this.visible(ctx) }, include })
      : null;
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async requireStaff(db: Db, ctx: TenantContext, staffId: string) {
    if (staffId !== ctx.userId && !can(ctx.role, 'appointments.view.all')) {
      throw new AppError('FORBIDDEN');
    }
    const m = await db.membership.findFirst({
      where: { businessId: ctx.businessId, userId: staffId, status: 'ACTIVE' },
    });
    if (!m) throw invalid('staffId', appointmentMessages.staffInvalid);
  }

  private async requireActiveService(db: Db, ctx: TenantContext, serviceId: string) {
    const s = await db.service.findFirst({
      where: { id: serviceId, businessId: ctx.businessId },
    });
    if (!s) throw invalid('serviceId', appointmentMessages.serviceInvalid);
    return s;
  }

  /**
   * Refuses an overlapping REQUESTED/CONFIRMED appointment for the same staff member. A per-staff
   * transaction lock makes two simultaneous bookings for the same slot impossible.
   */
  private async assertFree(
    db: Db,
    businessId: string,
    staffId: string,
    startsAt: Date,
    endsAt: Date,
    exceptId?: string,
  ) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt:${staffId}`}))`;
    const clash = await db.appointment.findFirst({
      where: {
        businessId,
        staffId,
        status: { in: BLOCKING_STATUSES },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new AppError('CONFLICT', appointmentMessages.clash);
  }

  async list(ctx: TenantContext, q: ListQuery): Promise<Appointment[]> {
    const rows = await this.prisma.appointment.findMany({
      where: {
        AND: [
          this.visible(ctx),
          { startsAt: { lt: new Date(q.to) }, endsAt: { gt: new Date(q.from) } },
          ...(q.staffId ? [{ staffId: q.staffId === 'me' ? ctx.userId : q.staffId }] : []),
          ...(q.leadId ? [{ leadId: q.leadId }] : []),
          ...(q.status ? [{ status: q.status }] : []),
        ],
      },
      include,
      orderBy: { startsAt: 'asc' },
      take: 1000,
    });
    return rows.map(toDto);
  }

  /** Website requests waiting for a decision (owners/managers see all of them). */
  async requests(ctx: TenantContext): Promise<Appointment[]> {
    const rows = await this.prisma.appointment.findMany({
      where: {
        businessId: ctx.businessId,
        status: 'REQUESTED',
        ...(can(ctx.role, 'appointments.view.all') ? {} : { staffId: ctx.userId }),
      },
      include,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
    return rows.map(toDto);
  }

  async create(ctx: TenantContext, input: CreateInput): Promise<Appointment> {
    const staffId = input.staffId === undefined ? ctx.userId : input.staffId;
    const row = await this.prisma.$transaction(async (tx) => {
      if (staffId) await this.requireStaff(tx, ctx, staffId);
      else if (!can(ctx.role, 'appointments.view.all')) throw new AppError('FORBIDDEN');
      const service = input.serviceId
        ? await this.requireActiveService(tx, ctx, input.serviceId)
        : null;
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(
        startsAt.getTime() +
          (input.durationMin ?? service?.durationMin ?? DEFAULT_DURATION) * 60_000,
      );

      // The customer: a visible lead, or a contact matched/created by phone.
      let contactId: string;
      let leadId: string | null = null;
      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: {
            id: input.leadId,
            businessId: ctx.businessId,
            ...(can(ctx.role, 'leads.view.all') ? {} : { ownerId: ctx.userId }),
          },
          select: { id: true, contactId: true },
        });
        if (!lead) throw invalid('leadId', appointmentMessages.leadInvalid);
        contactId = lead.contactId;
        leadId = lead.id;
      } else {
        const { name, phone } = input.customer!;
        const existing = await tx.contact.findFirst({
          where: { businessId: ctx.businessId, phone },
          orderBy: { createdAt: 'asc' },
        });
        contactId =
          existing?.id ??
          (await tx.contact.create({ data: { businessId: ctx.businessId, name, phone } })).id;
      }

      if (staffId) await this.assertFree(tx, ctx.businessId, staffId, startsAt, endsAt);
      const created = await tx.appointment.create({
        data: {
          businessId: ctx.businessId,
          contactId,
          leadId,
          serviceId: service?.id ?? null,
          staffId,
          startsAt,
          endsAt,
          status: staffId ? 'CONFIRMED' : 'REQUESTED',
          notes: input.notes,
          createdById: ctx.userId,
        },
        include,
      });
      if (leadId) {
        await tx.activity.create({
          data: {
            businessId: ctx.businessId,
            leadId,
            actorId: ctx.userId,
            type: 'appointment.created',
            data: {
              startsAt: startsAt.toISOString(),
              service: created.service?.name ?? null,
              staff: created.staff?.fullName ?? null,
            },
          },
        });
      }
      return created;
    });
    return toDto(row);
  }

  /**
   * A website visitor's request (F17): REQUESTED, no staff member yet, linked to the new lead.
   * An unknown or inactive service is ignored rather than failing the visitor's form.
   */
  async requestFromWebsite(input: {
    businessId: string;
    leadId: string;
    contactId: string;
    serviceId: string | null;
    startsAt: Date;
  }): Promise<void> {
    const service = input.serviceId
      ? await this.prisma.service.findFirst({
          where: { id: input.serviceId, businessId: input.businessId, active: true },
        })
      : null;
    const endsAt = new Date(
      input.startsAt.getTime() + (service?.durationMin ?? DEFAULT_DURATION) * 60_000,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          leadId: input.leadId,
          serviceId: service?.id ?? null,
          staffId: null,
          startsAt: input.startsAt,
          endsAt,
          status: 'REQUESTED',
          source: 'website',
        },
      });
      await tx.activity.create({
        data: {
          businessId: input.businessId,
          leadId: input.leadId,
          type: 'appointment.created',
          data: {
            startsAt: input.startsAt.toISOString(),
            service: service?.name ?? null,
            staff: null,
            requested: true,
          },
        },
      });
    });
  }

  async update(ctx: TenantContext, id: string, input: UpdateInput): Promise<Appointment> {
    const row = await this.prisma.$transaction(async (tx) => {
      const appt = await this.findVisible(ctx, id, tx);
      const data: Prisma.AppointmentUncheckedUpdateInput = {};

      let staffId = appt.staffId;
      if (input.staffId !== undefined && input.staffId !== appt.staffId) {
        if (input.staffId) await this.requireStaff(tx, ctx, input.staffId);
        else if (!can(ctx.role, 'appointments.view.all')) throw new AppError('FORBIDDEN');
        staffId = input.staffId;
        data.staffId = staffId;
      }
      if (input.serviceId !== undefined && input.serviceId !== appt.serviceId) {
        if (input.serviceId) await this.requireActiveService(tx, ctx, input.serviceId);
        data.serviceId = input.serviceId;
      }
      const startsAt = input.startsAt ? new Date(input.startsAt) : appt.startsAt;
      const minutes =
        input.durationMin ?? (appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000;
      const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
      if (input.startsAt || input.durationMin) {
        data.startsAt = startsAt;
        data.endsAt = endsAt;
      }
      const status = input.status ?? appt.status;
      if (input.status && input.status !== appt.status) data.status = input.status;
      if (status === 'CONFIRMED' && !staffId) {
        throw invalid('staffId', appointmentMessages.staffRequired);
      }
      if (input.notes !== undefined) data.notes = input.notes;

      // Re-check the slot whenever the booking (still) holds time and its time or staff changed.
      const holdsTime = BLOCKING_STATUSES.includes(status);
      const moved =
        data.startsAt !== undefined ||
        data.staffId !== undefined ||
        (input.status !== undefined && !BLOCKING_STATUSES.includes(appt.status));
      if (staffId && holdsTime && moved) {
        await this.assertFree(tx, ctx.businessId, staffId, startsAt, endsAt, appt.id);
      }
      if (Object.keys(data).length === 0) return appt;

      const updated = await tx.appointment.update({ where: { id: appt.id }, data, include });
      if (appt.leadId) {
        await tx.activity.create({
          data: {
            businessId: ctx.businessId,
            leadId: appt.leadId,
            actorId: ctx.userId,
            type: 'appointment.updated',
            data: {
              startsAt: updated.startsAt.toISOString(),
              status: updated.status,
              ...(data.status ? { statusChanged: true } : {}),
            },
          },
        });
      }
      return updated;
    });
    return toDto(row);
  }
}
