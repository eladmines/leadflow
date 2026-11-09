-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "attribution" JSONB,
ADD COLUMN     "attribution_source" VARCHAR(20);

-- CreateIndex
CREATE INDEX "leads_business_id_attribution_source_idx" ON "leads"("business_id", "attribution_source");
