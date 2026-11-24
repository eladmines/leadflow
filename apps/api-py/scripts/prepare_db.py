"""Run at every start (before the server): brings the database to the latest schema.

- A database that Prisma already migrated (it has `_prisma_migrations` but no `alembic_version`) is
  stamped at the baseline revision first, so nothing is re-run on live data.
- Then `alembic upgrade head` applies whatever is new (a no-op when up to date).
"""

import asyncio
import os
import sys

sys.path.insert(0, os.getcwd())  # `app` lives next to `scripts/`

import asyncpg  # noqa: E402
from alembic.config import Config

from alembic import command
from app.config import get_settings

BASELINE = "0001"


async def _state() -> tuple[bool, bool]:
    url = get_settings().DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    try:
        has_alembic = await conn.fetchval("select to_regclass('public.alembic_version')") is not None
        has_prisma = await conn.fetchval("select to_regclass('public._prisma_migrations')") is not None
        return has_alembic, has_prisma
    finally:
        await conn.close()


def main() -> int:
    has_alembic, has_prisma = asyncio.run(_state())
    cfg = Config("alembic.ini")
    if not has_alembic and has_prisma:
        print(f"Database was migrated by Prisma: stamping it at {BASELINE}", flush=True)
        command.stamp(cfg, BASELINE)
    command.upgrade(cfg, "head")
    print("Database is up to date", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
