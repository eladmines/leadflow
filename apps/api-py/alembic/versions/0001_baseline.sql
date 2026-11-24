-- Baseline: the schema as the Prisma migrations built it (apps/api/prisma/migrations, in order).
-- Existing databases that Prisma already migrated are stamped at this revision, not re-run.

-- ===== 20261027132426_init =====
-- Baseline migration (F00). Feature migrations follow.
SELECT 1;

-- ===== 20261027134303_f01_auth =====
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "actor_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== 20261027155916_f02_businesses =====
-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "industry" VARCHAR(40) NOT NULL,
    "phone" VARCHAR(20),
    "address" VARCHAR(200),
    "service_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opening_hours" JSONB,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jerusalem',
    "status" "BusinessStatus" NOT NULL DEFAULT 'ONBOARDING',
    "onboarding_step" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memberships_business_id_idx" ON "memberships"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_business_id_key" ON "memberships"("user_id", "business_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 20261027171315_f04_sites =====
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

-- ===== 20261027172304_f06_publishing =====
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


-- ===== 20261027173714_f07_leads =====
-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('website_form', 'manual', 'whatsapp');

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "StageKind" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "owner_id" UUID,
    "source" "LeadSource" NOT NULL,
    "source_url" VARCHAR(300),
    "message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_hash" VARCHAR(64) NOT NULL,
    "lead_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_business_id_phone_idx" ON "contacts"("business_id", "phone");

-- CreateIndex
CREATE INDEX "contacts_business_id_email_idx" ON "contacts"("business_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_business_id_position_key" ON "pipeline_stages"("business_id", "position");

-- CreateIndex
CREATE INDEX "leads_business_id_created_at_idx" ON "leads"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_business_id_stage_id_idx" ON "leads"("business_id", "stage_id");

-- CreateIndex
CREATE INDEX "leads_business_id_owner_id_idx" ON "leads"("business_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_lead_id_key" ON "form_submissions"("lead_id");

-- CreateIndex
CREATE INDEX "form_submissions_business_id_created_at_idx" ON "form_submissions"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_site_id_idempotency_key_key" ON "form_submissions"("site_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "activities_business_id_lead_id_created_at_idx" ON "activities"("business_id", "lead_id", "created_at");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===== 20261027174724_f08_crm =====
-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "expected_value" INTEGER,
ADD COLUMN     "next_action_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "leads_business_id_next_action_at_idx" ON "leads"("business_id", "next_action_at");


-- ===== 20261027182954_f09_invitations =====
-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "invited_by_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_business_id_email_idx" ON "invitations"("business_id", "email");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===== 20261027190002_f05_media =====
-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "mime" VARCHAR(40) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "original_name" VARCHAR(200),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_key_key" ON "assets"("key");

-- CreateIndex
CREATE INDEX "assets_business_id_created_at_idx" ON "assets"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===== 20261027191609_f10_tasks =====
-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(1000),
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMPTZ(3),
    "assignee_id" UUID NOT NULL,
    "lead_id" UUID,
    "remind" BOOLEAN NOT NULL DEFAULT true,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_business_id_status_due_at_idx" ON "tasks"("business_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_business_id_assignee_id_status_idx" ON "tasks"("business_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_business_id_lead_id_idx" ON "tasks"("business_id", "lead_id");

-- CreateIndex
CREATE INDEX "tasks_status_remind_reminder_sent_at_due_at_idx" ON "tasks"("status", "remind", "reminder_sent_at", "due_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===== 20261028071007_lead_tags =====
-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- ===== 20261028071525_notify_new_leads =====
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "notify_new_leads" BOOLEAN NOT NULL DEFAULT true;


-- ===== 20261028120727_appointments =====
-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "price" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "lead_id" UUID,
    "service_id" UUID,
    "staff_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "notes" VARCHAR(1000),
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_business_id_active_idx" ON "services"("business_id", "active");

-- CreateIndex
CREATE INDEX "appointments_business_id_starts_at_idx" ON "appointments"("business_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_staff_id_starts_at_idx" ON "appointments"("business_id", "staff_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_status_idx" ON "appointments"("business_id", "status");

-- CreateIndex
CREATE INDEX "appointments_business_id_lead_id_idx" ON "appointments"("business_id", "lead_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===== 20261028122359_quotes =====
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


-- ===== 20261028124426_site_pages =====
-- AlterTable
ALTER TABLE "site_versions" ADD COLUMN     "page_html" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "pages" JSONB NOT NULL DEFAULT '[]';


-- ===== 20261031151643_whatsapp_messages =====
-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "lead_id" UUID,
    "direction" "WhatsAppDirection" NOT NULL,
    "wa_message_id" VARCHAR(128) NOT NULL,
    "body" VARCHAR(4096) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "sender_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_wa_message_id_key" ON "whatsapp_messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_business_id_contact_id_created_at_idx" ON "whatsapp_messages"("business_id", "contact_id", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== 20261031205316_whatsapp_numbers =====
-- D-092: WhatsApp numbers are classified per business (unclassified / business / personal).

-- CreateEnum
CREATE TYPE "WhatsAppNumberStatus" AS ENUM ('UNCLASSIFIED', 'BUSINESS', 'PERSONAL');

-- CreateTable
CREATE TABLE "whatsapp_numbers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "status" "WhatsAppNumberStatus" NOT NULL,
    "profile_name" VARCHAR(80),
    "classified_by_id" UUID,
    "classified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_numbers_business_id_status_idx" ON "whatsapp_numbers"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_numbers_business_id_phone_key" ON "whatsapp_numbers"("business_id", "phone");

-- Existing messages all belong to known contacts: their numbers are business numbers.
INSERT INTO "whatsapp_numbers" ("id", "business_id", "phone", "status", "updated_at")
SELECT gen_random_uuid(), c."business_id", c."phone", 'BUSINESS', CURRENT_TIMESTAMP
FROM "contacts" c
WHERE c."phone" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "whatsapp_messages" m WHERE m."contact_id" = c."id")
ON CONFLICT ("business_id", "phone") DO NOTHING;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN "number_id" UUID,
ALTER COLUMN "contact_id" DROP NOT NULL;

UPDATE "whatsapp_messages" m
SET "number_id" = n."id"
FROM "contacts" c
JOIN "whatsapp_numbers" n ON n."business_id" = c."business_id" AND n."phone" = c."phone"
WHERE m."contact_id" = c."id";

-- Messages whose contact has no phone can't be matched to a number (none expected).
DELETE FROM "whatsapp_messages" WHERE "number_id" IS NULL;

ALTER TABLE "whatsapp_messages" ALTER COLUMN "number_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "whatsapp_messages_number_id_created_at_idx" ON "whatsapp_messages"("number_id", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_classified_by_id_fkey" FOREIGN KEY ("classified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 20261031221622_business_website_url =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "website_url" VARCHAR(300);

-- ===== 20261031222334_keep_submissions_on_site_delete =====
-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_site_id_fkey";

-- AlterTable
ALTER TABLE "form_submissions" ALTER COLUMN "site_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== 20261101063925_notifications =====
-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_business_id_created_at_idx" ON "notifications"("user_id", "business_id", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 20261103094020_whatsapp_booking_bot =====
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

-- ===== 20261103181158_whatsapp_bot_texts =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_texts" JSONB;

-- ===== 20261103190951_whatsapp_bot_showcase =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_showcase" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "bot_showcase_at" TIMESTAMPTZ(3);

-- ===== 20261103193809_whatsapp_bot_event_flow =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_flow" VARCHAR(20);

-- AlterTable
ALTER TABLE "whatsapp_bot_sessions" ADD COLUMN     "data" JSONB;

-- ===== 20261104090536_whatsapp_bot_personal =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_bot_hold_date" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "bot_paused" BOOLEAN NOT NULL DEFAULT false;

-- ===== 20261105074212_stored_objects =====
-- CreateTable
CREATE TABLE "stored_objects" (
    "key" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(60) NOT NULL,
    "body" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("key")
);

-- ===== 20261106112126_whatsapp_auto_reply =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_active_status" JSONB,
ADD COLUMN     "whatsapp_auto_reply_text" VARCHAR(1000),
ADD COLUMN     "whatsapp_reply_mode" VARCHAR(20) NOT NULL DEFAULT 'auto_reply',
ADD COLUMN     "whatsapp_statuses" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "auto_reply_at" TIMESTAMPTZ(3);

-- Businesses that had the booking bot on keep it (D-123); everyone else starts on the automatic reply.
UPDATE "businesses" SET "whatsapp_reply_mode" = 'booking' WHERE "whatsapp_bot_enabled" = true;

-- ===== 20261108073907_business_language =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "language" VARCHAR(2) NOT NULL DEFAULT 'he';

-- ===== 20261108130127_messenger_channel =====
-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'facebook';

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "channel" VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "contact_id" UUID,
ALTER COLUMN "phone" SET DATA TYPE VARCHAR(64);

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== 20261109052157_inbox_conversations =====
-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "last_message_at" TIMESTAMPTZ(3),
ADD COLUMN     "unread" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "whatsapp_numbers_business_id_last_message_at_idx" ON "whatsapp_numbers"("business_id", "last_message_at");

-- F24: fill the new columns from the messages already stored.
UPDATE "whatsapp_numbers" n
SET "last_message_at" = m.last_at
FROM (
  SELECT "number_id", MAX("created_at") AS last_at FROM "whatsapp_messages" GROUP BY "number_id"
) m
WHERE m."number_id" = n."id";

-- Keep them current: every stored message moves its conversation up; a customer's message marks
-- it unread (the team marks it read when they open it).
CREATE OR REPLACE FUNCTION whatsapp_messages_touch_number() RETURNS trigger AS $$
BEGIN
  UPDATE "whatsapp_numbers"
  SET "last_message_at" = GREATEST(COALESCE("last_message_at", NEW."created_at"), NEW."created_at"),
      "unread" = CASE WHEN NEW."direction" = 'IN' THEN true ELSE "unread" END
  WHERE "id" = NEW."number_id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER whatsapp_messages_touch_number
AFTER INSERT ON "whatsapp_messages"
FOR EACH ROW EXECUTE FUNCTION whatsapp_messages_touch_number();

-- ===== 20261109060211_channel_connections =====
-- CreateTable
CREATE TABLE "channel_connections" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "external_id" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "connected_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_pending" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "data_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_pending_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_channel_external_id_key" ON "channel_connections"("channel", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_business_id_channel_key" ON "channel_connections"("business_id", "channel");

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_pending" ADD CONSTRAINT "oauth_pending_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 20261109063802_lead_attribution =====
-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "attribution" JSONB,
ADD COLUMN     "attribution_source" VARCHAR(20);

-- CreateIndex
CREATE INDEX "leads_business_id_attribution_source_idx" ON "leads"("business_id", "attribution_source");

-- ===== 20261109063944_sender_attribution =====
-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "attribution" JSONB;

-- ===== 20261110124413_email_channel =====
-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'email';

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "subject" VARCHAR(300);

-- AlterTable
ALTER TABLE "whatsapp_numbers" ALTER COLUMN "phone" SET DATA TYPE VARCHAR(260);

-- ===== 20261121183641_whatsapp_questions =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_questions" JSONB;

-- ===== 20261122162205_instagram_lead_source =====
-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'instagram';

-- ===== 20261122162525_channel_connection_page_id =====
-- AlterTable
ALTER TABLE "channel_connections" ADD COLUMN     "page_id" VARCHAR(64);

-- ===== 20261122194440_gmail_sync_cursor =====
-- AlterTable
ALTER TABLE "channel_connections" ADD COLUMN     "sync_cursor" BIGINT;

-- ===== 20261123175929_visit_counts =====
-- CreateTable
CREATE TABLE "visit_counts" (
    "business_id" UUID NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL DEFAULT '',
    "campaign" VARCHAR(100) NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "visit_counts_pkey" PRIMARY KEY ("business_id","day","source","name","campaign")
);

-- AddForeignKey
ALTER TABLE "visit_counts" ADD CONSTRAINT "visit_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 20261123183242_event_counts =====
-- CreateTable
CREATE TABLE "event_counts" (
    "business_id" UUID NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "label" VARCHAR(100) NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_counts_pkey" PRIMARY KEY ("business_id","day","kind","label")
);

-- AddForeignKey
ALTER TABLE "event_counts" ADD CONSTRAINT "event_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 20261123202218_domain_expiry =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "domain_check" VARCHAR(12),
ADD COLUMN     "domain_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "domain_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "domain_reminded_days" INTEGER;

-- ===== 20261123223919_questions_enabled =====
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "whatsapp_questions_enabled" BOOLEAN NOT NULL DEFAULT true;
