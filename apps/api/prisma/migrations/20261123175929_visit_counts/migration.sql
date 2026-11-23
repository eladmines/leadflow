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
