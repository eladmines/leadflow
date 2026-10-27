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

