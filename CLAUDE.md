# SimpleCatch — shared development rules

SimpleCatch is a multi-tenant Hebrew/RTL SaaS for small Israeli businesses (site builder → leads → CRM → WhatsApp → AI).
Product source of truth: the planning PDFs (PRD v4.0 + docs 02–09). Engineering source of truth: `docs/`.

## Read before working

- `docs/ARCHITECTURE.md` — components, tenancy model, request flow.
- `docs/DECISIONS.md` — decisions made and still open. Don't silently re-decide.
- `docs/FEATURE_BACKLOG.md` — what is in progress; work only on the assigned feature.
- `docs/features/Fxx.md` — the spec and acceptance criteria for your feature.

## Commands

```bash
docker compose up -d            # Postgres (localhost:5432) + Mailpit (UI localhost:8025)
cp apps/api-py/.env.example apps/api-py/.env   # first time only
pnpm install && (cd apps/api-py && uv sync)
pnpm db:migrate                 # Alembic: builds/updates the schema (apps/api-py)
pnpm dev                        # API :4000 + web :5173 (web proxies /api) + public sites :4100 (http://<sub>.lvh.me:4100)
pnpm lint && pnpm typecheck && pnpm test && pnpm test:api && pnpm build   # test:api = pytest
(cd apps/api-py && uv run ruff check . && uv run ruff format --check .)
pnpm e2e                        # Playwright, desktop + mobile (stop `pnpm dev` first; e2e starts its own servers)
```

## Non-negotiable rules

1. **Tenant isolation.** Every tenant-owned table has `business_id`. Tenant routes live under
   `/api/v1/businesses/:businessId/...` and are registered inside the tenant plugin scope.
   Never read a business id from the body/query/headers. Services take a `TenantContext`; every
   repository query filters by `ctx.businessId`. Missing membership → **404** (not 403).
2. **Server-side authorization.** Check permissions with the shared permission matrix
   (`packages/shared`). Hiding a button is never the protection.
3. **Contracts live in `packages/shared`.** Zod schemas (with Hebrew messages), roles, permissions,
   error codes. API and web both import them; don't duplicate validation.
4. **Errors** use the shared shape `{ error: { code, message, fields?, requestId } }`. Throw
   `AppError` for expected errors. Never leak stack traces, SQL or provider errors to clients.
5. **Secrets and PII.** Never hardcode secrets, never log them. Logger redaction lives in
   the API's logging setup (`apps/api-py/app`); extend it when adding sensitive fields. Store only hashes of tokens.
6. **Bilingual app, RTL and LTR (D-100).** The web app defaults to Hebrew (RTL, D-186) with English (LTR) as an
   option. Write copy in Hebrew wrapped in `tr('…')` (`apps/web/src/i18n`) and add its English to
   `apps/web/src/i18n/en.*.ts`; shared labels/messages are wrapped where they're shown. `dir` follows the
   language, so use logical Tailwind utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end`),
   never `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`; directional icons flip with `ltr:`/`rtl:`.
   Emails, phones and URLs get `dir="ltr"`. Customer-facing copy (website, WhatsApp, emails) follows the business's language (D-142, D-143): add both Hebrew and English.
7. **Accessibility.** Labeled inputs, visible focus, keyboard reachable, colour never the only signal.
   Every screen has loading, empty, error and no-permission states.
8. **External integrations** sit behind an interface in `apps/api-py/app/integrations/*`, with a
   local/test adapter. No paid service without a recorded decision.
9. **Don't invent product requirements.** If the docs are silent, propose it in `docs/DECISIONS.md`
   as _Proposed_ and flag it to the orchestrator.
10. **Pinned stack** (don't bump majors without a decision): FastAPI, SQLAlchemy 2, Alembic, Pydantic 2, Zod 3 (web), TypeScript 5.9,
    React 18, Vite 6, Tailwind 3, Vitest 3, React Router 6, TanStack Query 5.

## Code conventions

- API module layout (`apps/api-py/app/modules/<feature>/`): `routes.py`, `service.py`, `schemas.py`; tests in `apps/api-py/tests/test_<feature>.py`.
- Build the app with `create_app()`; tests call it through httpx's ASGI transport against the real test DB (`tests/conftest.py`: `client`, `db`, `owner_with_business`, …; the tables are emptied between tests).
- Response models are Pydantic; after changing one run `uv run python scripts/export_openapi.py` and `pnpm --filter @simplecatch/web api:types` (CI fails when the generated files are stale).
- Web: `src/features/<feature>/` for screens and hooks, `src/components/ui/` for the shared kit, `apiFetch` for all calls.
- Migrations: `cd apps/api-py && uv run alembic revision -m "<change>"` (hand-written SQL/ops), keep `app/db/models.py` in step; never edit an applied revision.

## File ownership (multi-agent work)

| Owner        | May write                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| architect    | `docs/features/**`, `packages/shared/src/**`, `apps/api-py/app/db/models.py`, `apps/api-py/alembic/**`, append to `docs/DECISIONS.md` |
| backend      | `apps/api-py/**`                                                                                              |
| frontend     | `apps/web/**`                                                                                                |
| qa           | `e2e/**`, `apps/*/test/qa/**`, the QA section of `docs/features/Fxx.md`                                      |
| orchestrator | root config, lockfile and dependencies, `docs/FEATURE_BACKLOG.md`, `docs/ROADMAP.md`, `CLAUDE.md`            |

Need a change outside your area? Say so in your final report; don't edit it.
Only the orchestrator adds dependencies or edits `pnpm-lock.yaml`.

## Definition of Done (per feature)

- [ ] Every acceptance criterion in `docs/features/Fxx.md` passes, end to end.
- [ ] Permissions enforced server-side, with tests; tenant routes covered by the cross-tenant walker.
- [ ] Errors handled with Hebrew messages; nothing internal leaks.
- [ ] No secrets or unnecessary PII in logs.
- [ ] RTL, mobile (375px) and keyboard checked.
- [ ] `pnpm lint typecheck test build e2e` green; migrations apply on a clean DB.
- [ ] Docs updated (feature card status, decisions, backlog).
- [ ] No known privacy issue.
