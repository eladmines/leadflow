-- D-092: WhatsApp numbers are classified per business (unclassified / business / personal).

-- CreateEnum
CREATE TYPE "WhatsAppNumberStatus" AS ENUM ('UNCLASSIFIED', 'BUSINESS', 'PERSONAL');

-- CreateTable
CREATE TABLE "whatsapp_numbers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "status" "WhatsAppNumberStatus" NOT NULL,
    "profile_name" VARCHAR(80),
    "classified_by_id" UUID,
    "classified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_numbers_business_id_status_idx" ON "whatsapp_numbers"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_numbers_business_id_phone_key" ON "whatsapp_numbers"("business_id", "phone");

-- Existing messages all belong to known contacts: their numbers are business numbers.
INSERT INTO "whatsapp_numbers" ("id", "business_id", "phone", "status", "updated_at")
SELECT gen_random_uuid(), c."business_id", c."phone", 'BUSINESS', CURRENT_TIMESTAMP
FROM "contacts" c
WHERE c."phone" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "whatsapp_messages" m WHERE m."contact_id" = c."id")
ON CONFLICT ("business_id", "phone") DO NOTHING;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN "number_id" UUID,
ALTER COLUMN "contact_id" DROP NOT NULL;

UPDATE "whatsapp_messages" m
SET "number_id" = n."id"
FROM "contacts" c
JOIN "whatsapp_numbers" n ON n."business_id" = c."business_id" AND n."phone" = c."phone"
WHERE m."contact_id" = c."id";

-- Messages whose contact has no phone can't be matched to a number (none expected).
DELETE FROM "whatsapp_messages" WHERE "number_id" IS NULL;

ALTER TABLE "whatsapp_messages" ALTER COLUMN "number_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "whatsapp_messages_number_id_created_at_idx" ON "whatsapp_messages"("number_id", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_classified_by_id_fkey" FOREIGN KEY ("classified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
