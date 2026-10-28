-- AlterTable
ALTER TABLE "site_versions" ADD COLUMN     "page_html" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "pages" JSONB NOT NULL DEFAULT '[]';

