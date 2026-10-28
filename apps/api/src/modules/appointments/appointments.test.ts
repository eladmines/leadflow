import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const ap = apiPaths.appointments;
const at = (h: number, m = 0) => {
  const d = new Date(Date.UTC(2030, 0, 6, h, m)); // a Sunday, far from "now"
  return d.toISOString();
};
const day = { from: at(0), to: at(23, 59) };
const listQs = (extra = '') => `?from=${day.from}&to=${day.to}${extra}`;

describe('appointments (F17)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  async function team() {
    const owner = await ownerWithBusiness(ctx.app, 'owner');
    const id = owner.business.id;
    const emp = await newUser(ctx.app, 'emp');
    const emp2 = await newUser(ctx.app, 'emp2');
    await addMember(ctx.prisma, id, emp.userId, 'EMPLOYEE');
    await addMember(ctx.prisma, id, emp2.userId, 'EMPLOYEE');
    const service = (
      await req(ctx.app, 'POST', ap.services(id), owner.token, {
        name: 'תספורת',
        durationMin: 45,
        price: 120,
      })
    ).json().service;
    return { owner, emp, emp2, id, service };
  }
  const book = (id: string, token: string, body: object) =>
    req(ctx.app, 'POST', ap.list(id), token, body);

  it('books with the service duration, reuses the contact by phone, lists the day', async () => {
    const t = await team();
    const res = await book(t.id, t.owner.token, {
      startsAt: at(9),
      serviceId: t.service.id,
      staffId: t.emp.userId,
      customer: { name: 'דנה כהן', phone: '052-1112233' },
      notes: 'פעם ראשונה',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().appointment).toMatchObject({
      startsAt: at(9),
      endsAt: at(9, 45),
      status: 'CONFIRMED',
      service: { name: 'תספורת' },
      staff: { id: t.emp.userId },
      customer: { name: 'דנה כהן', phone: '+972521112233' },
    });
    await book(t.id, t.owner.token, {
      startsAt: at(11),
      staffId: t.emp.userId,
      customer: { name: 'דנה', phone: '0521112233' },
    });
    expect(await ctx.prisma.contact.count()).toBe(1);
    const list = (await req(ctx.app, 'GET', `${ap.list(t.id)}${listQs()}`, t.owner.token)).json();
    expect(list.appointments.map((a: { startsAt: string }) => a.startsAt)).toEqual([at(9), at(11)]);
    expect(list.appointments[1].endsAt).toBe(at(11, 30)); // default 30 minutes
  });

  it('prevents double booking the same staff member, allows back-to-back and other staff', async () => {
    const t = await team();
    const c = { name: 'לקוח', phone: '052-0000001' };
    await book(t.id, t.owner.token, {
      startsAt: at(10),
      durationMin: 60,
      staffId: t.emp.userId,
      customer: c,
    });

    const clash = await book(t.id, t.owner.token, {
      startsAt: at(10, 30),
      durationMin: 30,
      staffId: t.emp.userId,
      customer: c,
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.message).toMatch(/יש כבר תור/);

    expect(
      (await book(t.id, t.owner.token, { startsAt: at(11), staffId: t.emp.userId, customer: c }))
        .statusCode,
    ).toBe(201); // starts exactly when the first ends
    expect(
      (
        await book(t.id, t.owner.token, {
          startsAt: at(10, 15),
          staffId: t.emp2.userId,
          customer: c,
        })
      ).statusCode,
    ).toBe(201);
  });

  it('simultaneous bookings for one slot: exactly one wins', async () => {
    const t = await team();
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        book(t.id, t.owner.token, {
          startsAt: at(14),
          staffId: t.emp.userId,
          customer: { name: `לקוח ${n}`, phone: `052-000000${n}` },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });

  it('cancelling frees the slot; rescheduling into a busy slot is refused', async () => {
    const t = await team();
    const c = { name: 'לקוח', phone: '052-0000001' };
    const a = (
      await book(t.id, t.owner.token, { startsAt: at(9), staffId: t.emp.userId, customer: c })
    ).json().appointment;
    const b = (
      await book(t.id, t.owner.token, { startsAt: at(12), staffId: t.emp.userId, customer: c })
    ).json().appointment;

    const move = await req(ctx.app, 'PATCH', ap.appointment(t.id, b.id), t.owner.token, {
      startsAt: at(9, 15),
    });
    expect(move.statusCode).toBe(409);

    await req(ctx.app, 'PATCH', ap.appointment(t.id, a.id), t.owner.token, { status: 'CANCELLED' });
    const moved = await req(ctx.app, 'PATCH', ap.appointment(t.id, b.id), t.owner.token, {
      startsAt: at(9, 15),
    });
    expect(moved.statusCode).toBe(200);
    // Re-confirming the cancelled one now clashes.
    const back = await req(ctx.app, 'PATCH', ap.appointment(t.id, a.id), t.owner.token, {
      status: 'CONFIRMED',
    });
    expect(back.statusCode).toBe(409);
  });

  it('books from a lead and records it in the lead history', async () => {
    const t = await team();
    const lead = (
      await req(ctx.app, 'POST', apiPaths.leads.list(t.id), t.owner.token, {
        name: 'רון',
        phone: '054-1112233',
      })
    ).json().lead;
    const res = await book(t.id, t.owner.token, {
      startsAt: at(9),
      leadId: lead.id,
      serviceId: t.service.id,
    });
    expect(res.json().appointment).toMatchObject({
      lead: { id: lead.id },
      customer: { name: 'רון' },
    });
    const detail = (
      await req(ctx.app, 'GET', apiPaths.leads.detail(t.id, lead.id), t.owner.token)
    ).json();
    expect(detail.activities[0]).toMatchObject({
      type: 'appointment.created',
      data: { service: 'תספורת' },
    });
    const byLead = (
      await req(ctx.app, 'GET', `${ap.list(t.id)}${listQs(`&leadId=${lead.id}`)}`, t.owner.token)
    ).json();
    expect(byLead.appointments).toHaveLength(1);
  });

  it('employees see and book only themselves; only owners/managers manage services', async () => {
    const t = await team();
    const c = { name: 'לקוח', phone: '052-0000001' };
    await book(t.id, t.owner.token, { startsAt: at(9), staffId: t.emp2.userId, customer: c });
    const mine = await book(t.id, t.emp.token, { startsAt: at(9), customer: c });
    expect(mine.statusCode).toBe(201);
    expect(mine.json().appointment.staff.id).toBe(t.emp.userId);
    expect(
      (await book(t.id, t.emp.token, { startsAt: at(15), staffId: t.emp2.userId, customer: c }))
        .statusCode,
    ).toBe(403);

    const seen = (await req(ctx.app, 'GET', `${ap.list(t.id)}${listQs()}`, t.emp.token)).json();
    expect(seen.appointments).toHaveLength(1);
    const theirs = (await req(ctx.app, 'GET', `${ap.list(t.id)}${listQs()}`, t.owner.token))
      .json()
      .appointments.find((a: { staff: { id: string } }) => a.staff.id === t.emp2.userId);
    expect(
      (
        await req(ctx.app, 'PATCH', ap.appointment(t.id, theirs.id), t.emp.token, {
          status: 'CANCELLED',
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (await req(ctx.app, 'POST', ap.services(t.id), t.emp.token, { name: 'x', durationMin: 30 }))
        .statusCode,
    ).toBe(403);
    expect((await req(ctx.app, 'GET', ap.services(t.id), t.emp.token)).statusCode).toBe(200);
  });

  it('services: validation, used services are deactivated instead of deleted', async () => {
    const t = await team();
    const bad = await req(ctx.app, 'POST', ap.services(t.id), t.owner.token, {
      name: '',
      durationMin: 2,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.durationMin).toMatch(/5 דקות/);

    await book(t.id, t.owner.token, {
      startsAt: at(9),
      serviceId: t.service.id,
      customer: { name: 'לקוח', phone: '052-0000001' },
    });
    await req(ctx.app, 'DELETE', ap.service(t.id, t.service.id), t.owner.token);
    expect(
      (await ctx.prisma.service.findUniqueOrThrow({ where: { id: t.service.id } })).active,
    ).toBe(false);
    const unused = (
      await req(ctx.app, 'POST', ap.services(t.id), t.owner.token, { name: 'צבע', durationMin: 90 })
    ).json().service;
    await req(ctx.app, 'DELETE', ap.service(t.id, unused.id), t.owner.token);
    expect(await ctx.prisma.service.count({ where: { id: unused.id } })).toBe(0);
  });

  it("another business can't use our services, staff or appointments", async () => {
    const t = await team();
    const other = await ownerWithBusiness(ctx.app, 'other');
    const appt = (
      await book(t.id, t.owner.token, {
        startsAt: at(9),
        customer: { name: 'לקוח', phone: '052-0000001' },
      })
    ).json().appointment;
    const res = await book(other.business.id, other.token, {
      startsAt: at(9),
      serviceId: t.service.id,
      customer: { name: 'זר', phone: '052-9999999' },
    });
    expect(res.statusCode).toBe(400);
    expect(
      (
        await book(other.business.id, other.token, {
          startsAt: at(9),
          staffId: t.emp.userId,
          customer: { name: 'זר', phone: '052-9999999' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await req(ctx.app, 'PATCH', ap.appointment(other.business.id, appt.id), other.token, {
          status: 'CANCELLED',
        })
      ).statusCode,
    ).toBe(404);
  });
});
