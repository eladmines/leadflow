-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_showcase" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "bot_showcase_at" TIMESTAMPTZ(3);
