import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultOpeningHours } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import {
  addMember,
  bpaths,
  createBusiness,
  newUser,
  ownerWithBusiness,
  req,
} from '../../../test/business-helpers';

describe('businesses', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  describe('create and list', () => {
    it('creates a business in ONBOARDING at step 2 with the caller as OWNER, and audits it', async () => {
      const { token, userId } = await newUser(ctx.app);
      const res = await req(ctx.app, 'POST', bpaths.create, token, {
        name: '  מספרת שירן ',
        industry: 'beauty',
      });
      expect(res.statusCode).toBe(201);
      const { business } = res.json();
      expect(business).toMatchObject({
        name: 'מספרת שירן',
        industry: 'beauty',
        status: 'ONBOARDING',
        onboardingStep: 2,
        role: 'OWNER',
        timezone: 'Asia/Jerusalem',
        phone: null,
        serviceAreas: [],
        openingHours: null,
      });
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'business.created' } });
      expect(audit).toMatchObject({ businessId: business.id, actorUserId: userId });
    });

    it('ignores client-supplied id, status and role on create (mass assignment)', async () => {
      const { token } = await newUser(ctx.app);
      const res = await req(ctx.app, 'POST', bpaths.create, token, {
        name: 'מוסך הצפון',
        industry: 'garage',
        id: '00000000-0000-4000-8000-000000000000',
        status: 'ACTIVE',
        role: 'EMPLOYEE',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().business).toMatchObject({ status: 'ONBOARDING', role: 'OWNER' });
      expect(res.json().business.id).not.toBe('00000000-0000-4000-8000-000000000000');
    });

    it('validates name and industry with Hebrew field errors', async () => {
      const { token } = await newUser(ctx.app);
      const res = await req(ctx.app, 'POST', bpaths.create, token, { name: 'א', industry: 'bank' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.name).toMatch(/[֐-׿]/);
      expect(res.json().error.fields.industry).toMatch(/[֐-׿]/);
    });

    it('requires sign-in', async () => {
      expect((await req(ctx.app, 'GET', bpaths.list)).statusCode).toBe(401);
      expect((await req(ctx.app, 'POST', bpaths.create, undefined, {})).statusCode).toBe(401);
    });

    it("lists only the caller's businesses", async () => {
      const a = await ownerWithBusiness(ctx.app, 'a');
      await createBusiness(ctx.app, a.token, { name: 'סניף שני', industry: 'beauty' });
      await ownerWithBusiness(ctx.app, 'b');
      const res = await req(ctx.app, 'GET', bpaths.list, a.token);
      expect(res.statusCode).toBe(200);
      expect(res.json().businesses.map((b: { name: string }) => b.name)).toEqual([
        'מספרת שירן',
        'סניף שני',
      ]);
    });
  });

  describe('onboarding', () => {
    it('saves each wizard step and resumes from the saved step (AC-01)', async () => {
      const { token, business } = await ownerWithBusiness(ctx.app);
      const url = bpaths.detail(business.id);

      let res = await req(ctx.app, 'PATCH', url, token, {
        phone: '050-1234567',
        address: 'הרצל 10, חיפה',
        onboardingStep: 3,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().business).toMatchObject({
        phone: '+972501234567',
        address: 'הרצל 10, חיפה',
        onboardingStep: 3,
      });

      res = await req(ctx.app, 'PATCH', url, token, {
        serviceAreas: ['חיפה', 'יקנעם', 'חיפה'],
        onboardingStep: 4,
      });
      expect(res.json().business.serviceAreas).toEqual(['חיפה', 'יקנעם']);

      // "Come back later": a fresh GET returns the saved step and data.
      res = await req(ctx.app, 'GET', url, token);
      expect(res.json().business).toMatchObject({ onboardingStep: 4, status: 'ONBOARDING' });
    });

    it('rejects an invalid phone and invalid opening hours', async () => {
      const { token, business } = await ownerWithBusiness(ctx.app);
      const url = bpaths.detail(business.id);
      let res = await req(ctx.app, 'PATCH', url, token, { phone: '12345' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.phone).toBeTruthy();
      res = await req(ctx.app, 'PATCH', url, token, {
        openingHours: { ...defaultOpeningHours, sun: { open: true, from: '18:00', to: '09:00' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields['openingHours.sun.to']).toBeTruthy();
    });

    it('complete requires a phone, then activates the business (idempotent)', async () => {
      const { token, business } = await ownerWithBusiness(ctx.app);
      const complete = bpaths.completeOnboarding(business.id);

      let res = await req(ctx.app, 'POST', complete, token);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.phone).toBeTruthy();

      await req(ctx.app, 'PATCH', bpaths.detail(business.id), token, {
        phone: '03-1234567',
        openingHours: defaultOpeningHours,
      });
      res = await req(ctx.app, 'POST', complete, token);
      expect(res.statusCode).toBe(200);
      expect(res.json().business).toMatchObject({
        status: 'ACTIVE',
        openingHours: defaultOpeningHours,
      });

      res = await req(ctx.app, 'POST', complete, token);
      expect(res.statusCode).toBe(200);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'business.onboarding.completed' } }),
      ).toBe(1);
    });

    it('ignores onboardingStep once ACTIVE, and audits field names only', async () => {
      const { token, business } = await ownerWithBusiness(ctx.app);
      await req(ctx.app, 'PATCH', bpaths.detail(business.id), token, { phone: '050-1234567' });
      await req(ctx.app, 'POST', bpaths.completeOnboarding(business.id), token);
      const res = await req(ctx.app, 'PATCH', bpaths.detail(business.id), token, {
        onboardingStep: 1,
        address: 'הנביאים 5',
      });
      expect(res.json().business.onboardingStep).not.toBe(1);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'business.updated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toEqual({ fields: ['address'] });
      expect(JSON.stringify(audit?.metadata)).not.toContain('הנביאים');
    });

    it('a businessId in the body cannot redirect a write to another business', async () => {
      const a = await ownerWithBusiness(ctx.app, 'a');
      const b = await ownerWithBusiness(ctx.app, 'b');
      const res = await req(ctx.app, 'PATCH', bpaths.detail(a.business.id), a.token, {
        businessId: b.business.id,
        name: 'שם חדש',
      });
      expect(res.statusCode).toBe(200);
      const bAfter = await ctx.prisma.business.findUniqueOrThrow({ where: { id: b.business.id } });
      expect(bAfter.name).toBe('מספרת שירן');
    });
  });

  describe('roles (AC-10)', () => {
    async function teamBusiness() {
      const owner = await ownerWithBusiness(ctx.app, 'owner');
      const manager = await newUser(ctx.app, 'manager');
      const employee = await newUser(ctx.app, 'employee');
      await addMember(ctx.prisma, owner.business.id, manager.userId, 'MANAGER');
      await addMember(ctx.prisma, owner.business.id, employee.userId, 'EMPLOYEE');
      return { owner, manager, employee, id: owner.business.id };
    }

    it('every member can view the business with their own role', async () => {
      const t = await teamBusiness();
      for (const [who, role] of [
        [t.owner, 'OWNER'],
        [t.manager, 'MANAGER'],
        [t.employee, 'EMPLOYEE'],
      ] as const) {
        const res = await req(ctx.app, 'GET', bpaths.detail(t.id), who.token);
        expect(res.statusCode).toBe(200);
        expect(res.json().business.role).toBe(role);
      }
    });

    it('only the owner can update or complete onboarding (403 for manager and employee)', async () => {
      const t = await teamBusiness();
      for (const who of [t.manager, t.employee]) {
        const patch = await req(ctx.app, 'PATCH', bpaths.detail(t.id), who.token, { name: 'x' });
        expect(patch.statusCode).toBe(403);
        expect(patch.json().error.code).toBe('FORBIDDEN');
        const done = await req(ctx.app, 'POST', bpaths.completeOnboarding(t.id), who.token);
        expect(done.statusCode).toBe(403);
      }
    });

    it('owner and manager can list members; employee cannot; no secrets in the response', async () => {
      const t = await teamBusiness();
      const res = await req(ctx.app, 'GET', bpaths.members(t.id), t.manager.token);
      expect(res.statusCode).toBe(200);
      expect(res.json().members.map((m: { role: string }) => m.role)).toEqual([
        'OWNER',
        'MANAGER',
        'EMPLOYEE',
      ]);
      expect(res.body).not.toMatch(/passwordHash|password_hash|\$argon2/);
      expect((await req(ctx.app, 'GET', bpaths.members(t.id), t.employee.token)).statusCode).toBe(
        403,
      );
    });
  });
});
