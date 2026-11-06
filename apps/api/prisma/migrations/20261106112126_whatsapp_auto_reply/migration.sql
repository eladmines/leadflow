-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_active_status" JSONB,
ADD COLUMN     "whatsapp_auto_reply_text" VARCHAR(1000),
ADD COLUMN     "whatsapp_reply_mode" VARCHAR(20) NOT NULL DEFAULT 'auto_reply',
ADD COLUMN     "whatsapp_statuses" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "auto_reply_at" TIMESTAMPTZ(3);

-- Businesses that had the booking bot on keep it (D-123); everyone else starts on the automatic reply.
UPDATE "businesses" SET "whatsapp_reply_mode" = 'booking' WHERE "whatsapp_bot_enabled" = true;
