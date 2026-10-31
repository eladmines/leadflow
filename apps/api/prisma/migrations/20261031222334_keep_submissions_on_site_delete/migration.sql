-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_site_id_fkey";

-- AlterTable
ALTER TABLE "form_submissions" ALTER COLUMN "site_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
