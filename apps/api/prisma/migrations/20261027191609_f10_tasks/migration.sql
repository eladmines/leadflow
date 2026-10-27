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

