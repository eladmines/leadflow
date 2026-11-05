-- CreateTable
CREATE TABLE "stored_objects" (
    "key" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(60) NOT NULL,
    "body" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("key")
);
