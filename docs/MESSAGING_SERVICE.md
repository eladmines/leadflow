# Messaging service (D-202, _Accepted_ 2026-11-26)

**Status:** phase 0 done; phase 1 next. The open questions are answered in §5.

Pull WhatsApp / Messenger / Instagram / email message processing out of the API into its own
deployable **messaging worker**, connected through a transactional outbox and a message broker.
The rest of the product stays a modular monolith (D-004). This is a targeted extraction, not a
move to microservices everywhere.

## 1. Why (the problem today)

- **Meta's webhook does all the work inside the request.** `POST /webhooks/whatsapp`
  (`app/modules/whatsapp/routes.py`) verifies the signature, then for every message calls
  `WhatsAppService.receive` → the bot (`bot.py`, ~1.6k lines) → an outbound send through
  `CloudWhatsAppSender`, all before returning 200. A slow Graph API call or a bot error makes the
  webhook slow or fail, so Meta retries and can eventually disable the subscription.
- **Background jobs run inside the API process.** `lifespan` in `app/main.py` starts task
  reminders, domain watch, Gmail sync and booking nudges in every API instance (guarded only by
  `RUN_BACKGROUND_JOBS` and per-row claiming, D-058). API scaling and job scaling are tied together.
- **Outbound sends have no retry.** A failed send to Meta is lost unless the user tries again.
- doc 04 already plans queues "with WhatsApp" (see D-058's rationale); this is that step.

## 2. Target shape

```
Meta / Gmail / inbound email
        │  (signed webhook)
        ▼
┌──────────────┐  one DB transaction   ┌───────────────┐
│ API (FastAPI)│ ─────────────────────▶│ Postgres      │
│ verify, store│  inbound_events row   │ outbox table  │
│ raw, 200 OK  │  + outbox row         └──────┬────────┘
└──────────────┘                              │ relay (polls, SKIP LOCKED)
                                              ▼
                                     ┌──────────────────┐
                                     │ Broker           │  messaging.inbound
                                     │ (RabbitMQ)       │  messaging.outbound
                                     └──────┬───────────┘  + .dlq for each
                                            ▼
                                  ┌────────────────────┐
                                  │ messaging worker   │ receive → bot → send
                                  │ (separate process, │ retries with backoff
                                  │  own container)    │ scheduled jobs
                                  └────────────────────┘
```

- **Ingress (API):** the webhook only verifies the signature, stores the raw payload in
  `inbound_events` (unique on provider + event id, so Meta's retries are no-ops), writes an outbox
  row in the same transaction, and returns 200. Target: p99 < 100 ms.
- **Outbox relay:** a small loop claims unpublished outbox rows (`FOR UPDATE SKIP LOCKED`, the
  same claiming pattern as D-058), publishes them to the broker, and marks them sent. Delivery is
  at least once, never lost when the broker is down.
- **Messaging worker:** consumes `messaging.inbound`, parses the payload (the parsing that's now in
  the route moves here), calls the existing `WhatsAppService.receive` / bot code. Consumers are
  idempotent: `whatsapp_messages.wa_message_id` is already unique, and `inbound_events` records
  the processed state.
- **Outbound:** sends the bot makes and user-initiated sends go to `messaging.outbound`. The
  message row is written as `queued` and moves to `sent` / `failed` (the UI already shows
  delivery status). Retries use exponential backoff (5 tries); then the message goes to the dead-letter queue (DLQ) and is marked `failed`.
- **Scheduled jobs** (reminders, domain watch, Gmail sync, nudges) run in the worker;
  the API runs with `RUN_BACKGROUND_JOBS=false`.

### Code layout

Same Python package, different entrypoints (shared models and services, separate deployables):

- `apps/api-py/app/workers/messaging.py` — worker entrypoint (`python -m app.workers.messaging`).
- `apps/api-py/app/integrations/queue/` — `MessageBus` interface with `MemoryMessageBus`
  (tests, local) and `RabbitMessageBus` (rule 8: integrations behind an interface with a local adapter).
- `apps/api-py/app/modules/outbox/` — outbox write helper and relay.
- `docker-compose.yml` — `rabbitmq` (management UI on :15672) and `messaging-worker` services.

### Tenancy and security

- The business is still derived server-side from the receiving number id (`phone_number_id`),
  in the worker, never from anything else in the payload (rule 1).
- Queue messages carry ids, not message bodies, where possible. Raw payloads stay in Postgres.
  No tokens or phone numbers in broker headers or logs (rule 5; extend logger redaction).
- Every event carries `requestId` / trace context, so one inbound message can be followed from
  the webhook through the worker to the outbound send (OpenTelemetry).

### Database ownership

Phase 1–2 share the one Postgres database. In phase 3 the worker gets its own DB role,
limited to the messaging tables plus read access to the rest. A separate database per service is
**not** proposed: conversations join leads and businesses throughout the CRM, and splitting them
would mean distributed transactions for no product gain.

## 3. Phases

| Phase | Scope                                                                                                                                                         | New infrastructure                  | Size |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---- |
| 0 ✅  | Worker process runs the existing background jobs (`app/jobs.py`, `app/workers/messaging.py`); `pnpm dev` runs it and the API with `RUN_BACKGROUND_JOBS=false` | none                                | S    |
| 1     | Inbound: webhook → `inbound_events` + outbox → broker → worker; idempotent consumer; DLQ                                                                      | RabbitMQ container                  | M    |
| 2     | Outbound: queued sends, retries/backoff, per-number rate limiting, `queued` status in UI                                                                      | —                                   | M    |
| 3     | Own DB role, OpenTelemetry tracing across API ↔ worker, queue depth / DLQ health checks                                                                       | collector (local: Jaeger container) | S–M  |

Each phase ships on its own and leaves the system working.

## 4. Testing

- Unit/integration tests run with `MemoryMessageBus` and drain it synchronously, so the existing
  pytest suite keeps its behaviour. The route tests assert "event stored + 200", and worker tests
  assert "event → message + reply".
- New tests: duplicate webhook delivery is processed once; broker down → outbox keeps rows and
  publishes after recovery; poison message → DLQ after N tries, message marked `failed`; tenant
  walker still covers every tenant route.
- One integration test runs against a real RabbitMQ in docker compose (CI service container).
- e2e: Playwright starts the worker alongside the API.

## 5. Decisions (owner, 2026-11-26)

1. **Broker:** RabbitMQ (dead-letter queues, a well-known tool).
2. **Hosting:** self-hosted as a container; no paid managed plan.
3. **User-initiated sends:** queued too, shown `queued` → `sent` live.
4. **Dependencies** (orchestrator): `aio-pika` with phase 1; `opentelemetry-*` with phase 3.

### Deployment note

The production setup (`render.yaml`) is one free web service, and Render's background workers are a
paid plan. So `RUN_BACKGROUND_JOBS` stays **on** by default and the deployed API keeps running the
jobs. Deploying the worker means two steps together: start `python -m app.workers.messaging` as
its own service and set `RUN_BACKGROUND_JOBS=false` on the API. Phase 1 needs a host that can run
RabbitMQ; choosing it is a deployment decision still to be made.

## 6. What it's not

- Not a split of leads / CRM / quotes / sites into services.
- Not a change to the public API contract in `packages/shared`, apart from a `queued`
  delivery status in phase 2.
