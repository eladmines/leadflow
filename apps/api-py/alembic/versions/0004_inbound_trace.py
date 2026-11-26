"""Inbound events keep the webhook's trace context (D-202 phase 3), so the outbox relay and the
worker continue the same trace.

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE inbound_events ADD COLUMN traceparent varchar(64)")


def downgrade() -> None:
    op.execute("ALTER TABLE inbound_events DROP COLUMN traceparent")
