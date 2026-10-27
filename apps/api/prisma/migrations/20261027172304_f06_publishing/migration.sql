-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "published_version_id" UUID,
ADD COLUMN     "subdomain" VARCHAR(40);

-- CreateTable
CREATE TABLE "site_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "draft_revision" INTEGER NOT NULL,
    "html" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_versions_business_id_idx" ON "site_versions"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_versions_site_id_number_key" ON "site_versions"("site_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sites_subdomain_key" ON "sites"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "sites_published_version_id_key" ON "sites"("published_version_id");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "site_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

