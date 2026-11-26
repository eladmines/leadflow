"""Inbound events: signed webhook deliveries stored before processing (D-202 phase 1).

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE inbound_events (
            id uuid NOT NULL,
            provider varchar(16) NOT NULL,
            dedupe_key char(64) NOT NULL,
            payload jsonb NOT NULL,
            received_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            published_at timestamp(3) with time zone,
            processed_at timestamp(3) with time zone,
            attempts integer NOT NULL DEFAULT 0,
            last_error varchar(200),
            CONSTRAINT inbound_events_pkey PRIMARY KEY (id)
        )
        """
    )
    op.execute("CREATE UNIQUE INDEX inbound_events_dedupe_key_key ON inbound_events (dedupe_key)")
    op.execute(
        "CREATE INDEX inbound_events_unpublished_idx ON inbound_events (received_at) "
        "WHERE published_at IS NULL AND processed_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE inbound_events")
