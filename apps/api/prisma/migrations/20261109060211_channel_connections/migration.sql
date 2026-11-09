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
