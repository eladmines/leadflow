-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL DEFAULT '',
    "items" JSONB NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(4,2) NOT NULL DEFAULT 18,
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "valid_until" DATE,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "public_token" VARCHAR(64),
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_public_token_key" ON "quotes"("public_token");

-- CreateIndex
CREATE INDEX "quotes_business_id_status_idx" ON "quotes"("business_id", "status");

-- CreateIndex
CREATE INDEX "quotes_business_id_lead_id_idx" ON "quotes"("business_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_business_id_number_key" ON "quotes"("business_id", "number");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

