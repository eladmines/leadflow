-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_key" VARCHAR(30) NOT NULL,
    "theme" JSONB NOT NULL,
    "seo" JSONB NOT NULL,
    "sections" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" "SiteStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_business_id_key" ON "sites"("business_id");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
