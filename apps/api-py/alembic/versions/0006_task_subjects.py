"""Tasks linked to a quote or an appointment, and automatic follow-ups (F35, D-213, D-214).

- `tasks.quote_id` / `tasks.appointment_id`: at most one (check). The foreign keys are composite,
  `(business_id, quote_id)` → `quotes (business_id, id)`, so the database itself refuses a link to
  another business's quote or appointment. `ON DELETE SET NULL (col)` (Postgres 15+) clears only
  the link column, never `business_id`. The referenced pairs get unique indexes (the id alone is
  already unique, so they can't fail on existing data). The two keys are checked at commit
  (`DEFERRABLE INITIALLY DEFERRED`): Postgres re-checks a key on any update of a row inserted in the
  same transaction, so deleting a lead (its quote cascades, the task's `lead_id` is cleared first)
  would otherwise fail inside a transaction that also created the task. The service still checks
  every link before writing; this is the backstop.
- `tasks.auto_kind`: set on tasks the system created; a checked varchar like `inbound_events.provider`.
  Partial unique indexes keep one **open** automatic task per quote / appointment, so concurrent
  sends or retries can't create a second follow-up. No check ties `auto_kind` to a subject: when a
  subject is deleted its link becomes NULL and the task must survive that.
- `businesses.task_auto_quote_followup` / `task_auto_appointment_confirm`: the per-business
  switches, default on. Constant defaults: no table rewrite.

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX quotes_business_id_id_key ON quotes (business_id, id)")
    op.execute("CREATE UNIQUE INDEX appointments_business_id_id_key ON appointments (business_id, id)")

    op.execute("ALTER TABLE tasks ADD COLUMN quote_id uuid")
    op.execute("ALTER TABLE tasks ADD COLUMN appointment_id uuid")
    op.execute("ALTER TABLE tasks ADD COLUMN auto_kind varchar(32)")
    op.execute(
        "ALTER TABLE tasks ADD CONSTRAINT tasks_quote_fkey FOREIGN KEY (business_id, quote_id) "
        "REFERENCES quotes (business_id, id) ON DELETE SET NULL (quote_id) ON UPDATE CASCADE "
        "DEFERRABLE INITIALLY DEFERRED"
    )
    op.execute(
        "ALTER TABLE tasks ADD CONSTRAINT tasks_appointment_fkey FOREIGN KEY (business_id, appointment_id) "
        "REFERENCES appointments (business_id, id) ON DELETE SET NULL (appointment_id) "
        "ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED"
    )
    op.execute(
        "ALTER TABLE tasks ADD CONSTRAINT tasks_one_subject_check "
        "CHECK (quote_id IS NULL OR appointment_id IS NULL)"
    )
    op.execute(
        "ALTER TABLE tasks ADD CONSTRAINT tasks_auto_kind_check "
        "CHECK (auto_kind IS NULL OR auto_kind IN ('quote_followup', 'appointment_confirm'))"
    )
    op.execute(
        "CREATE INDEX tasks_business_id_quote_id_idx ON tasks (business_id, quote_id) "
        "WHERE quote_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX tasks_business_id_appointment_id_idx ON tasks (business_id, appointment_id) "
        "WHERE appointment_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX tasks_open_auto_quote_key ON tasks (quote_id) "
        "WHERE auto_kind IS NOT NULL AND status = 'OPEN' AND quote_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX tasks_open_auto_appointment_key ON tasks (appointment_id) "
        "WHERE auto_kind IS NOT NULL AND status = 'OPEN' AND appointment_id IS NOT NULL"
    )

    op.execute("ALTER TABLE businesses ADD COLUMN task_auto_quote_followup boolean NOT NULL DEFAULT true")
    op.execute(
        "ALTER TABLE businesses ADD COLUMN task_auto_appointment_confirm boolean NOT NULL DEFAULT true"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE businesses DROP COLUMN task_auto_appointment_confirm")
    op.execute("ALTER TABLE businesses DROP COLUMN task_auto_quote_followup")
    op.execute("DROP INDEX tasks_open_auto_appointment_key")
    op.execute("DROP INDEX tasks_open_auto_quote_key")
    op.execute("DROP INDEX tasks_business_id_appointment_id_idx")
    op.execute("DROP INDEX tasks_business_id_quote_id_idx")
    op.execute("ALTER TABLE tasks DROP CONSTRAINT tasks_auto_kind_check")
    op.execute("ALTER TABLE tasks DROP CONSTRAINT tasks_one_subject_check")
    op.execute("ALTER TABLE tasks DROP CONSTRAINT tasks_appointment_fkey")
    op.execute("ALTER TABLE tasks DROP CONSTRAINT tasks_quote_fkey")
    op.execute("ALTER TABLE tasks DROP COLUMN auto_kind")
    op.execute("ALTER TABLE tasks DROP COLUMN appointment_id")
    op.execute("ALTER TABLE tasks DROP COLUMN quote_id")
    op.execute("DROP INDEX appointments_business_id_id_key")
    op.execute("DROP INDEX quotes_business_id_id_key")
