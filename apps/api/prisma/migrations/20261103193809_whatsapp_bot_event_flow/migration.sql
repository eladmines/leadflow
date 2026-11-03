-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_flow" VARCHAR(20);

-- AlterTable
ALTER TABLE "whatsapp_bot_sessions" ADD COLUMN     "data" JSONB;
