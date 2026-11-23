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
