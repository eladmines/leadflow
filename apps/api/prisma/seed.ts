/**
 * Development seed (never run in production). Idempotent: re-running resets the demo accounts.
 *   owner@leadflow.test     → OWNER of "מספרת שירן" (active)
 *   employee@leadflow.test  → EMPLOYEE of "מספרת שירן"
 *   other@leadflow.test     → OWNER of "מוסך הצפון" (another tenant, for isolation checks)
 * Password for all: LeadFlow-demo-1
 */
import { PrismaClient } from '@prisma/client';
import { defaultOpeningHours } from '@leadflow/shared';
import { hashPassword } from '../src/lib/crypto';

const prisma = new PrismaClient();
const PASSWORD = 'LeadFlow-demo-1';

async function user(email: string, fullName: string) {
  const passwordHash = await hashPassword(PASSWORD);
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, fullName, status: 'ACTIVE' },
    create: { email, fullName, passwordHash, emailVerifiedAt: new Date() },
  });
}

async function business(name: string, industry: string, phone: string, address: string) {
  await prisma.business.deleteMany({ where: { name } });
  return prisma.business.create({
    data: {
      name,
      industry,
      phone,
      address,
      serviceAreas: ['חיפה', 'יקנעם', 'קריות'],
      openingHours: defaultOpeningHours,
      status: 'ACTIVE',
      onboardingStep: 4,
    },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed production');

  const owner = await user('owner@leadflow.test', 'שירן לוי');
  const employee = await user('employee@leadflow.test', 'יוסי מזרחי');
  const other = await user('other@leadflow.test', 'אבי כהן');

  const salon = await business('מספרת שירן', 'beauty', '+972501234567', 'הרצל 10, חיפה');
  const garage = await business('מוסך הצפון', 'garage', '+97248123456', 'דרך העצמאות 3, יקנעם');

  await prisma.membership.createMany({
    data: [
      { userId: owner.id, businessId: salon.id, role: 'OWNER' },
      { userId: employee.id, businessId: salon.id, role: 'EMPLOYEE' },
      { userId: other.id, businessId: garage.id, role: 'OWNER' },
    ],
  });
  console.log(`Seeded 3 users (password: ${PASSWORD}) and 2 businesses.`);
}

main().finally(() => prisma.$disconnect());
