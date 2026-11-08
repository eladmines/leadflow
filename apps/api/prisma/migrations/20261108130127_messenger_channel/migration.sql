-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'facebook';

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "channel" VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "contact_id" UUID,
ALTER COLUMN "phone" SET DATA TYPE VARCHAR(64);

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
