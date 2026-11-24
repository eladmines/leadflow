# SimpleCatch

A Hebrew/RTL SaaS for small businesses: website, leads, CRM, WhatsApp and an AI agent in one place.

## Quick start

Requires Node 22+, pnpm 9, Python 3.12 with [uv](https://docs.astral.sh/uv/), Docker.

```bash
docker compose up -d
cp apps/api-py/.env.example apps/api-py/.env
pnpm install
(cd apps/api-py && uv sync)
pnpm db:migrate        # Alembic: builds or updates the schema
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/health, http://localhost:4000/health/db
- Mailpit (local email inbox): http://localhost:8025
- Postgres: `localhost:5432` (stop other local Postgres containers using that port first)

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:api && pnpm build
(cd apps/api-py && uv run ruff check . && uv run ruff format --check .)
pnpm exec playwright install chromium   # first time
pnpm e2e
```

## Repo layout

```
apps/api-py     FastAPI + SQLAlchemy + Alembic API (modular monolith; it replaced the Node API)
apps/web        React + Vite admin app (Hebrew RTL)
packages/shared Zod contracts, error codes, roles/permissions (the web app's source of types for now)
e2e/            Playwright tests
docs/           Architecture, decisions, roadmap, backlog, feature specs
```

See `CLAUDE.md` for development rules and `docs/FEATURE_BACKLOG.md` for status.
