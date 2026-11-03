-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_auto_confirm" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsapp_bot_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "whatsapp_bot_sessions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "number_id" UUID NOT NULL,
    "step" VARCHAR(20) NOT NULL,
    "service_id" UUID,
    "date" VARCHAR(10),
    "time" VARCHAR(5),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_bot_sessions_number_id_key" ON "whatsapp_bot_sessions"("number_id");

-- CreateIndex
CREATE INDEX "whatsapp_bot_sessions_business_id_idx" ON "whatsapp_bot_sessions"("business_id");

-- AddForeignKey
ALTER TABLE "whatsapp_bot_sessions" ADD CONSTRAINT "whatsapp_bot_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_bot_sessions" ADD CONSTRAINT "whatsapp_bot_sessions_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
