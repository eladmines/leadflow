# Backend migration: Node (Fastify) to Python (FastAPI)

Strategy: **strangler, module by module.** `apps/api-py` (FastAPI, SQLAlchemy 2 async, Alembic,
Pydantic v2) grows beside `apps/api`. Each module is ported with its tests, then its routes are
served by Python and removed from Node. Node is deleted when the last module moves.

Decisions: SQLAlchemy 2 + Alembic for the data layer; Pydantic is the source of truth for
schemas, and the web app's TypeScript types are generated from FastAPI's OpenAPI document.

## Rules of the port
- Same URLs, status codes, cookies and `{ error: { code, message, fields?, requestId } }` body, so
  the web app does not change while modules move.
- Same database. Models are generated from the live schema (`sqlacodegen`); Prisma stays the
  migration tool until the cutover, then the schema is baselined into one Alembic revision.
- Every Node test file has a Python counterpart before its module is switched over.

## Status
| Step | State |
|---|---|
| Scaffold, settings, error shape, request id, CSRF guard | done |
| SQLAlchemy models (29 tables, 13 enums) | done |
| Session auth, tenant scope (404 for outsiders), permission matrix | done |
| `/health`, `/health/db` | done |
| auth: register, login, logout, me, verify email, password reset, profile, change password; audit log, argon2 (Node hashes verify unchanged), rate limit, email senders (memory/SMTP/Brevo/disabled) + account templates | done (57 tests) |
| businesses (create with one-owned-business rule, onboarding, members, notification prefs); shared phone, industries, validators (phone port diff-tested against the TS original) | done (21 tests) |
| team: invitations (invite, re-invite, resend, revoke), preview/accept, role change, removal; invite email template | done (8 tests) |
| notifications (notify helper, list, mark read); tasks (CRUD, visibility rules, lead links + activity, reminder job with timezone-aware Hebrew/English dates) | done (24 tests) |
| leads (+ customers import/export, reports) | next |
| leads, customers import/export, reports | |
| appointments, quotes, media | |
| sites (render/publish), public site server, embed | |
| whatsapp (bot, webhooks), channels, conversations, domain | |
| email, storage, Meta/Gmail integrations | |
| Alembic baseline, Docker/Render config, retire `apps/api`, generate web types from OpenAPI | |

## Running it
```
cd apps/api-py
uv sync
uv run pytest            # uses TEST_DATABASE_URL, or apps/api/.env
uv run uvicorn app.main:create_app --factory --reload --port 4001
```
