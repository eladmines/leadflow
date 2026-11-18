# Architecture

Status: baseline for MVP (stages 0–1). It follows the planning doc _04 System Architecture_.
Decisions and their reasons are in `DECISIONS.md`.

## 1. Shape: modular monolith

One API process (`apps/api`) with modules per feature (`src/modules/<feature>`), one shared
PostgreSQL database, one admin SPA (`apps/web`), and a contract package (`packages/shared`).
We don't split into microservices; background work runs in-process until queues are needed (F12).

```
Browser (admin, Hebrew RTL / English LTR) ──► apps/web (Vite SPA; in prod served by the API, D-119)
            │  same-site cookie, JSON
            ▼
         apps/api (Fastify) ──► PostgreSQL (managed: Supabase/Neon; local: docker :5432)
            │        │
            │        ├─► StorageProvider (local disk, or Postgres via STORAGE_DRIVER)  [F05]
            │        ├─► EmailSender (SMTP→Mailpit local / Brevo over HTTPS / off)    [F01]
            │        ├─► WhatsApp + Messenger (Meta Cloud API, per-business tokens)    [F12, F23–F25]
            │        └─► AI provider (planned)                                         [F16]
            ▼
Visitors ──► public site server in the API (apps/api, port 4100) resolving the site by
             Host (`<sub>.lvh.me` locally) or by path (`/s/<name>` on the Render test host);
             published HTML is read from Postgres                                       [F06]
```

Today (test hosting, D-119): one Render service runs the API, the built web app and the customer
sites, with Neon Postgres, at `app.simplecatch.co.il`. The marketing page (`apps/landing`) is a
separate Cloudflare Worker at `simplecatch.co.il`. The target of S3/R2 object storage and a
Cloudflare Worker for sites is planned, not built (see `DEPLOYMENT.md`, D-010/D-011, F11).

## 2. Stack (pinned majors)

| Layer     | Choice                                                                                        |
| --------- | --------------------------------------------------------------------------------------------- |
| API       | Node 22+, Fastify 5, fastify-type-provider-zod, pino logging                                  |
| Data      | PostgreSQL 16, Prisma 6 (migrations via `prisma migrate`)                                     |
| Contracts | Zod 3 in `packages/shared` (Hebrew validation messages)                                       |
| Web       | React 18, Vite 6, React Router 6, TanStack Query 5, Tailwind 3 (logical utilities), Heebo     |
| Tests     | Vitest 3 (API against a real Postgres test DB; web with jsdom), Playwright (desktop + mobile) |
| CI        | GitHub Actions: lint → typecheck → test → build → e2e                                         |

## 3. Request pipeline (API)

1. Request id (`x-request-id`, generated if missing) → structured pino log with redaction.
2. Auth plugin (F01): session cookie → `req.auth` (user), or anonymous.
3. CSRF guard (F01): state-changing requests need an allowed `Origin` and `X-Requested-With`.
4. Tenant plugin (F02) for `/api/v1/businesses/:businessId/*`: resolve membership → `req.tenant`
   `{ businessId, role }`, or **404**.
5. Permission check (`requirePermission('x.y')`, from the shared matrix).
6. Zod-validated handler → service(ctx) → repository(ctx).
7. Error handler: shared error shape, Hebrew message, request id; no internals.

## 4. Tenant isolation

- Tenant = Business. Every tenant-owned table has a non-null `business_id` (denormalised on
  child tables too) and indexes that lead with it.
- `businessId` comes only from the route param, and only after membership is verified. Body or
  query values are ignored.
- Repositories take `TenantContext` and always filter by it; nothing queries tenant data without it.
- **Cross-tenant route walker test:** enumerates every registered tenant route and asserts that a
  member of business B gets 404 on business A. New routes are covered automatically.
- Files: object keys are prefixed with the business id, `{businessId}/{uuid}.webp` (F05). Cache keys, queue jobs
  and logs carry `businessId`.
- Postgres RLS is a planned second layer (DECISIONS D-007), not in the MVP.

## 5. Authentication

- Own implementation (D-001): argon2id hashes; a random 256-bit session token in an `httpOnly`,
  `Secure` (prod), `SameSite=Lax` cookie. Only the token's SHA-256 hash is stored. Sessions are
  revocable, with sliding expiry (30 days idle, 90 days absolute).
- Email verification: soft in the MVP (D-002, a banner until verified) and now **off by default**
  (D-133, `EMAIL_VERIFICATION`; the e2e turns it on); `email_verified_at` lets later features require it.
- Rate limits on auth endpoints; generic login errors; single-use, short-lived reset tokens.

## 6. Website publishing (F04–F06; proposal D-010)

Draft (JSON section tree in Postgres) → `renderPage()` (pure, shared by preview and publish) →
immutable HTML snapshot (today a `site_versions` row in Postgres, D-036; object storage is
planned, D-010) → atomic switch of `site.published_version_id`. A failed publish never moves the
pointer. Serving resolves Host (or path) → site → published version through a shared in-process
cache that publishing clears. "No DB query per page view" is the goal for the planned Worker + R2
serving, not today's behaviour.

## 7. Configuration and environments

- Env validated with Zod at boot (`apps/api/src/config/env.ts`); the app fails fast.
- Separate dev/test databases locally; dev/staging/prod with separate secrets later (doc 04).
- Secrets only in env or a secret manager; never in the repo or the browser.

## 8. Observability (baseline)

- `/health` (process) and `/health/db` (database).
- Structured JSON logs with request ids; sensitive paths redacted.
- Later (F15): error tracking, uptime, queue and cost dashboards, backup restore drills.
