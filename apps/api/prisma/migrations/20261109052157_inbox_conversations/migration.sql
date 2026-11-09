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
