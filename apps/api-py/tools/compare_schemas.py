"""Compares two databases' schemas (columns, indexes, constraints, enums, triggers, functions),
ignoring alembic's and Prisma's bookkeeping tables. Usage: PW=<password> python tools/compare_schemas.py <db_a> <db_b>
Used to prove that `alembic upgrade head` on an empty database builds the same schema Prisma did."""

import asyncio
import os
import sys

import asyncpg

PW = os.environ["PW"]
Q = {
    "columns": "select table_name,column_name,data_type,udt_name,is_nullable,column_default,character_maximum_length,datetime_precision from information_schema.columns where table_schema='public' and table_name not in ('_prisma_migrations','alembic_version') order by 1,2",
    "indexes": "select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename not in ('_prisma_migrations','alembic_version') order by 1,2",
    "constraints": "select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text not in ('_prisma_migrations','alembic_version') order by 1,2",
    "enums": "select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid group by 1 order by 1",
    "triggers": "select tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1",
    "functions": "select proname, prosrc from pg_proc where pronamespace='public'::regnamespace order by 1",
}


async def dump(db):
    c = await asyncpg.connect(f"postgresql://leadflow:{PW}@localhost:5432/{db}")
    out = {k: [tuple(r) for r in await c.fetch(q)] for k, q in Q.items()}
    ver = (
        await c.fetchval("select count(*) from alembic_version")
        if await c.fetchval("select to_regclass('alembic_version')")
        else None
    )
    await c.close()
    return out, ver


async def main():
    a, _ = await dump(sys.argv[1])
    b, v = await dump(sys.argv[2])
    print("alembic_version rows:", v)
    for k in Q:
        print(k, len(a[k]), len(b[k]), "OK" if a[k] == b[k] else "DIFF")
        if a[k] != b[k]:
            for x in set(a[k]) ^ set(b[k]):
                print("   ", x)


asyncio.run(main())
