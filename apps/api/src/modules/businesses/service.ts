import { Prisma, type Business, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  businessMessages,
  industrySchema,
  openingHoursSchema,
  type Business as BusinessDto,
  type BusinessSummary,
  type CreateBusinessRequest,
  type Member,
  type Role,
  type updateBusinessRequestSchema,
} from '@leadflow/shared';
import type { z } from 'zod';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit, recordAuditSafe } from '../audit/service';
import { businessRepo } from './repo';

type UpdateInput = z.output<typeof updateBusinessRequestSchema>;

export function toBusinessDto(business: Business, role: Role): BusinessDto {
  const hours = openingHoursSchema.safeParse(business.openingHours);
  return {
    id: business.id,
    name: business.name,
    industry: industrySchema.catch('other').parse(business.industry),
    phone: business.phone,
    address: business.address,
    serviceAreas: business.serviceAreas,
    openingHours: hours.success ? hours.data : null,
    timezone: business.timezone,
    status: business.status,
    onboardingStep: business.onboardingStep,
    role,
    createdAt: business.createdAt.toISOString(),
  };
}

export class BusinessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  async listMine(userId: string): Promise<BusinessSummary[]> {
    const memberships = await businessRepo.listForUser(this.prisma, userId);
    return memberships.map((m) => ({
      id: m.business.id,
      name: m.business.name,
      status: m.business.status,
      onboardingStep: m.business.onboardingStep,
      role: m.role,
    }));
  }

  async create(userId: string, input: CreateBusinessRequest): Promise<BusinessDto> {
    const { business } = await this.prisma.$transaction(async (tx) => {
      const created = await businessRepo.createWithOwner(tx, userId, input);
      await recordAudit(tx, {
        action: 'business.created',
        businessId: created.business.id,
        actorUserId: userId,
        entityType: 'business',
        entityId: created.business.id,
        metadata: { industry: input.industry },
      });
      return created;
    });
    return toBusinessDto(business, 'OWNER');
  }

  async get(ctx: TenantContext): Promise<BusinessDto> {
    return toBusinessDto(await businessRepo.get(this.prisma, ctx), ctx.role);
  }

  async update(ctx: TenantContext, input: UpdateInput): Promise<BusinessDto> {
    const current = await businessRepo.get(this.prisma, ctx);
    const data: Prisma.BusinessUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.industry !== undefined) data.industry = input.industry;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.address !== undefined) data.address = input.address;
    if (input.serviceAreas !== undefined) data.serviceAreas = input.serviceAreas;
    if (input.openingHours !== undefined) {
      data.openingHours = input.openingHours ?? Prisma.DbNull;
    }
    // Wizard progress only matters while onboarding.
    if (input.onboardingStep !== undefined && current.status === 'ONBOARDING') {
      data.onboardingStep = input.onboardingStep;
    }

    const changed = Object.keys(data);
    if (changed.length === 0) return toBusinessDto(current, ctx.role);

    const updated = await businessRepo.update(this.prisma, ctx, data);
    // Field names only: values may contain personal data (phone, address).
    await recordAuditSafe(this.prisma, this.log, {
      action: 'business.updated',
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      entityType: 'business',
      entityId: ctx.businessId,
      metadata: { fields: changed },
    });
    return toBusinessDto(updated, ctx.role);
  }

  /** Validates the required profile and activates the business. Idempotent once ACTIVE. */
  async completeOnboarding(ctx: TenantContext): Promise<BusinessDto> {
    const current = await businessRepo.get(this.prisma, ctx);
    if (current.status !== 'ONBOARDING') return toBusinessDto(current, ctx.role);

    const fields: Record<string, string> = {};
    if (!current.name) fields.name = businessMessages.nameRequired;
    if (!current.industry) fields.industry = businessMessages.industryRequired;
    if (!current.phone) fields.phone = businessMessages.phoneRequired;
    if (Object.keys(fields).length > 0) {
      throw new AppError('VALIDATION_ERROR', businessMessages.onboardingIncomplete, fields);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const b = await businessRepo.update(tx, ctx, { status: 'ACTIVE' });
      await recordAudit(tx, {
        action: 'business.onboarding.completed',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'business',
        entityId: ctx.businessId,
      });
      return b;
    });
    return toBusinessDto(updated, ctx.role);
  }

  async listMembers(ctx: TenantContext): Promise<Member[]> {
    const rows = await businessRepo.listMembers(this.prisma, ctx);
    return rows.map((m) => ({
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    }));
  }
}
