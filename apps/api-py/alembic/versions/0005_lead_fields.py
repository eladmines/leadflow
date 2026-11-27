"""Custom lead fields (F34, D-203): per-business field definitions, and the values on each lead
in `leads.custom_fields`, keyed by definition id.

`type` is a checked varchar like the newer columns (`inbound_events.provider`,
`leads.attribution_source`), not a Postgres enum, so a later type is a constraint change rather
than an `ALTER TYPE` outside a transaction. A partial unique index keeps active labels unique per
business (case-insensitive) even under concurrent requests.

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE lead_field_definitions (
            id uuid NOT NULL,
            business_id uuid NOT NULL,
            label varchar(40) NOT NULL,
            type varchar(16) NOT NULL,
            options jsonb NOT NULL DEFAULT '[]'::jsonb,
            required boolean NOT NULL DEFAULT false,
            number_min double precision,
            number_max double precision,
            position integer NOT NULL,
            created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp(3) with time zone NOT NULL,
            archived_at timestamp(3) with time zone,
            CONSTRAINT lead_field_definitions_pkey PRIMARY KEY (id),
            CONSTRAINT lead_field_definitions_business_id_fkey FOREIGN KEY (business_id)
                REFERENCES businesses (id) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT lead_field_definitions_type_check
                CHECK (type IN ('text', 'number', 'date', 'select', 'boolean')),
            CONSTRAINT lead_field_definitions_options_check CHECK (jsonb_typeof(options) = 'array')
        )
        """
    )
    op.execute(
        "CREATE INDEX lead_field_definitions_business_id_archived_at_position_idx "
        "ON lead_field_definitions (business_id, archived_at, position)"
    )
    op.execute(
        "CREATE UNIQUE INDEX lead_field_definitions_active_label_key "
        "ON lead_field_definitions (business_id, lower(label)) WHERE archived_at IS NULL"
    )
    # A constant default: no table rewrite on Postgres 11+.
    op.execute("ALTER TABLE leads ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb")
    op.execute(
        "ALTER TABLE leads ADD CONSTRAINT leads_custom_fields_check "
        "CHECK (jsonb_typeof(custom_fields) = 'object')"
    )
    op.execute("CREATE INDEX leads_custom_fields_idx ON leads USING gin (custom_fields jsonb_path_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX leads_custom_fields_idx")
    op.execute("ALTER TABLE leads DROP CONSTRAINT leads_custom_fields_check")
    op.execute("ALTER TABLE leads DROP COLUMN custom_fields")
    op.execute("DROP TABLE lead_field_definitions")
