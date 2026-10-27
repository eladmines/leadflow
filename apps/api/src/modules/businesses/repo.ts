import type { Business, Membership, Prisma, User } from '@prisma/client';
import type { Db } from '../../lib/db';
import type { TenantContext } from '../../plugins/tenant';

/**
 * Business data access. Tenant reads and writes take a TenantContext and are always keyed by
 * `ctx.businessId`; the only non-tenant queries are "my businesses" (by user) and create.
 */
export const businessRepo = {
  listForUser(db: Db, userId: string) {
    return db.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { business: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async createWithOwner(
    db: Db,
    userId: string,
    data: { name: string; industry: string },
  ): Promise<{ business: Business; membership: Membership }> {
    const business = await db.business.create({
      // Step 1 (name + industry) is done at creation, so the wizard resumes at step 2.
      data: { name: data.name, industry: data.industry, status: 'ONBOARDING', onboardingStep: 2 },
    });
    const membership = await db.membership.create({
      data: { userId, businessId: business.id, role: 'OWNER' },
    });
    return { business, membership };
  },

  get(db: Db, ctx: TenantContext) {
    return db.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  },

  update(db: Db, ctx: TenantContext, data: Prisma.BusinessUpdateInput) {
    return db.business.update({ where: { id: ctx.businessId }, data });
  },

  listMembers(db: Db, ctx: TenantContext): Promise<(Membership & { user: User })[]> {
    return db.membership.findMany({
      where: { businessId: ctx.businessId, status: 'ACTIVE' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  },
};
