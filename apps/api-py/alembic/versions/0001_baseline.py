"""Baseline: the schema as the Prisma migrations built it.

Revision ID: 0001
Revises:
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One statement at a time: asyncpg refuses several commands in one prepared statement.
    sql = (Path(__file__).with_suffix(".sql")).read_text(encoding="utf-8")
    conn = op.get_bind()
    for statement in _statements(sql):
        conn.exec_driver_sql(statement)


def downgrade() -> None:
    raise RuntimeError("The baseline cannot be undone; drop the database instead.")


def _statements(sql: str) -> list[str]:
    """Splits the SQL on semicolons outside quotes, comments and $$ bodies."""
    out: list[str] = []
    buf: list[str] = []
    i, n = 0, len(sql)
    quote: str | None = None
    dollar: str | None = None
    while i < n:
        c = sql[i]
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
        elif quote:
            if c == quote:
                if quote == "'" and sql[i + 1 : i + 2] == "'":
                    buf.append("''")
                    i += 2
                    continue
                quote = None
        elif c == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j < 0 else j
            i = j
            continue
        elif c in ("'", '"'):
            quote = c
        elif c == "$":
            j = i + 1
            while j < n and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            if j < n and sql[j] == "$":
                dollar = sql[i : j + 1]
                buf.append(dollar)
                i = j + 1
                continue
        elif c == ";":
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out
