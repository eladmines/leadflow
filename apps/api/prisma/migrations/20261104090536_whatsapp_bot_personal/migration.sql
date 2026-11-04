-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_hold_date" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "bot_paused" BOOLEAN NOT NULL DEFAULT false;
