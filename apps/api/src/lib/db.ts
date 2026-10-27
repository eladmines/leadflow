import { PrismaClient, type Prisma } from '@prisma/client';

/** A Prisma client or an interactive-transaction client. Repositories accept either. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
