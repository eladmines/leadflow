-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "domain_check" VARCHAR(12),
ADD COLUMN     "domain_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "domain_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "domain_reminded_days" INTEGER;
