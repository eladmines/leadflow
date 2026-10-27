# LeadFlow

A Hebrew/RTL SaaS for small businesses: website, leads, CRM, WhatsApp and an AI agent in one place.

## Quick start

Requires Node 22+, pnpm 9, Docker.

```bash
docker compose up -d
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/health, http://localhost:4000/health/db
- Mailpit (local email inbox): http://localhost:8025
- Postgres: `localhost:5432` (stop other local Postgres containers using that port first)

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm exec playwright install chromium   # first time
pnpm e2e
```

## Repo layout

```
apps/api        Fastify + Prisma API (modular monolith)
apps/web        React + Vite admin app (Hebrew RTL)
packages/shared Zod contracts, error codes, roles/permissions
e2e/            Playwright tests
docs/           Architecture, decisions, roadmap, backlog, feature specs
```

See `CLAUDE.md` for development rules and `docs/FEATURE_BACKLOG.md` for status.
