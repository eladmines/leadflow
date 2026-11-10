-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'email';

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "subject" VARCHAR(300);

-- AlterTable
ALTER TABLE "whatsapp_numbers" ALTER COLUMN "phone" SET DATA TYPE VARCHAR(260);
