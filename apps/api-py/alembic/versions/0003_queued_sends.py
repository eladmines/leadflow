"""Queued outgoing messages (D-202 phase 2): what to send, how often it was tried, and a sequence
number that keeps one conversation's messages in the order they were queued (timestamps are only
millisecond-precise, and the bot queues several messages at once).

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE whatsapp_messages ADD COLUMN send_payload jsonb")
    op.execute("ALTER TABLE whatsapp_messages ADD COLUMN send_attempts integer NOT NULL DEFAULT 0")
    op.execute("CREATE SEQUENCE whatsapp_messages_send_seq")
    op.execute("ALTER TABLE whatsapp_messages ADD COLUMN send_seq bigint")
    op.execute(
        "CREATE INDEX whatsapp_messages_queued_idx ON whatsapp_messages (number_id, send_seq) "
        "WHERE status = 'queued'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX whatsapp_messages_queued_idx")
    op.execute("ALTER TABLE whatsapp_messages DROP COLUMN send_seq")
    op.execute("DROP SEQUENCE whatsapp_messages_send_seq")
    op.execute("ALTER TABLE whatsapp_messages DROP COLUMN send_attempts")
    op.execute("ALTER TABLE whatsapp_messages DROP COLUMN send_payload")
