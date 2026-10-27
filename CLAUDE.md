# LeadFlow — shared development rules

LeadFlow is a multi-tenant Hebrew/RTL SaaS for small Israeli businesses (site builder → leads → CRM → WhatsApp → AI).
Product source of truth: the planning PDFs (PRD v4.0 + docs 02–09). Engineering source of truth: `docs/`.

## Read before working

- `docs/ARCHITECTURE.md` — components, tenancy model, request flow.
- `docs/DECISIONS.md` — decisions made and still open. Don't silently re-decide.
- `docs/FEATURE_BACKLOG.md` — what is in progress; work only on the assigned feature.
- `docs/features/Fxx.md` — the spec and acceptance criteria for your feature.

## Commands

```bash
docker compose up -d            # Postgres (localhost:5432) + Mailpit (UI localhost:8025)
cp apps/api/.env.example apps/api/.env   # first time only
pnpm install
pnpm db:migrate                 # prisma migrate dev (apps/api)
pnpm --filter @leadflow/api exec prisma generate   # after pulling/merging schema changes (stale client = type errors)
pnpm dev                        # API :4000 + web :5173 (web proxies /api)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
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
   `apps/api/src/lib/logger.ts`; extend it when adding sensitive fields. Store only hashes of tokens.
6. **RTL.** Hebrew UI copy, `dir="rtl"`. Use logical Tailwind utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end`).
   Never `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`. Emails, phones and URLs get `dir="ltr"`.
7. **Accessibility.** Labeled inputs, visible focus, keyboard reachable, colour never the only signal.
   Every screen has loading, empty, error and no-permission states.
8. **External integrations** sit behind an interface in `apps/api/src/integrations/*`, with a
   local/test adapter. No paid service without a recorded decision.
9. **Don't invent product requirements.** If the docs are silent, propose it in `docs/DECISIONS.md`
   as _Proposed_ and flag it to the orchestrator.
10. **Pinned stack** (don't bump majors without a decision): Fastify 5, Prisma 6, Zod 3, TypeScript 5.9,
    React 18, Vite 6, Tailwind 3, Vitest 3, React Router 6, TanStack Query 5.

## Code conventions

- API module layout: `src/modules/<feature>/{routes,service,repo}.ts` + `*.test.ts` next to them.
- Build the app with `buildApp()`; test through `app.inject()` against the real test DB
  (`test/helpers.ts`: `createTestApp`, `resetDb`).
- Web: `src/features/<feature>/` for screens and hooks, `src/components/ui/` for the shared kit, `apiFetch` for all calls.
- Migrations: `pnpm --filter @leadflow/api exec prisma migrate dev --name <change>`; never edit an applied migration.

## File ownership (multi-agent work)

| Owner        | May write                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| architect    | `docs/features/**`, `packages/shared/src/**`, `apps/api/prisma/schema.prisma`, append to `docs/DECISIONS.md` |
| backend      | `apps/api/**`                                                                                                |
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
