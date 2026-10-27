-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "expected_value" INTEGER,
ADD COLUMN     "next_action_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "leads_business_id_next_action_at_idx" ON "leads"("business_id", "next_action_at");

