# Messaging service (D-202, _Accepted_ 2026-11-26)

**Status:** phases 0–2 done, phase 3 done except the worker's own DB role (postponed until the worker runs on its own host). Decisions are in §5.

WhatsApp / Messenger / Instagram / email message processing moves out of the API into its own
deployable **messaging worker**, connected through a transactional outbox and a message broker.
The rest of the product stays a modular monolith (D-004). This is a targeted extraction, not a
move to microservices everywhere.

## 1. Why (the problem)

- **Meta's webhook did all the work inside the request.** It verified the signature, then for
  every message called `WhatsAppService.receive` → the bot (`bot.py`, ~1.6k lines) → an outbound
  send through `CloudWhatsAppSender`, all before returning 200. A slow Graph API call or a bot
  error made the webhook slow or fail, so Meta retries and can eventually disable the subscription.
- **Background jobs ran inside the API process.** Task reminders, domain watch, Gmail sync and
  booking nudges started in every API instance (D-058), tying API scaling to job scaling.
- **Outbound sends have no retry.** A failed send to Meta is lost unless the user tries again.
- doc 04 already plans queues "with WhatsApp" (see D-058's rationale); this is that step.

## 2. Shape

```
Meta (WhatsApp, Messenger, Instagram) / inbound email
        │  signed webhook
        ▼
┌───────────────────┐   INSERT … ON CONFLICT DO NOTHING   ┌──────────────────┐
│ API (FastAPI)     │ ───────────────────────────────────▶│ Postgres         │
│ verify signature, │                                     │ inbound_events   │
│ store, 200 OK     │── wake ──┐                          │ (the outbox)     │
└───────────────────┘          ▼                          └────────┬─────────┘
                        outbox relay ◀── SKIP LOCKED claim ────────┘
                               │ {"eventId": …}
                               ▼
                     ┌──────────────────────┐
                     │ RabbitMQ             │ messaging.inbound
                     │                      │ messaging.inbound.retry (TTL → back)
                     └──────────┬───────────┘ messaging.inbound.dlq
                                ▼
                     ┌──────────────────────┐
                     │ messaging worker     │ lock row → receive → bot → send
                     │ python -m            │ retry 2/4/8/16 s, then DLQ
                     │ app.workers.messaging│ + scheduled jobs
                     └──────────────────────┘
```

- **Ingress (API, `app/modules/whatsapp/routes.py`):** the webhook checks the signature (and for
  email validates the mail), stores the payload in `inbound_events` and returns 200. One row per
  delivery: the row is keyed on the SHA-256 of provider + raw body, so Meta's retries of the same
  delivery are no-ops. The table is the outbox; there is no second write to keep in step.
- **Outbox relay (`start_outbox_relay`):** claims unpublished rows with `FOR UPDATE SKIP LOCKED`,
  publishes `{"eventId"}` and marks them published in the same transaction. A webhook wakes it
  at once; otherwise it polls every 2 s. It runs in every process that has a bus (API and
  worker); SKIP LOCKED keeps each row with one relay. If the broker is down, rows wait for the next
  run. Delivery is at least once.
- **Worker consumer (`handle` → `run_event`):** locks the event row (`SKIP LOCKED`: another
  consumer already has it → skip), runs the processor on a second session, marks it processed.
  Processing a processed event again is a no-op, and `whatsapp_messages.wa_message_id` stays unique
  underneath. On failure: `attempts` + error class are recorded, then the message waits in the
  retry queue (2, 4, 8, 16 s), and after 5 attempts it is rejected into the DLQ.
- **Processor (`app/modules/inbound/processor.py`):** the parsing that used to be in the routes,
  unchanged.
- **`MESSAGE_BUS=inline`** (default; tests, e2e, the deployed single service): the webhook
  stores the event and runs `run_event` in the request, as before. A failure answers 500, Meta
  retries, the stored row is found again and processed. No broker needed.
- **Scheduled jobs** run in the worker; the API runs with `RUN_BACKGROUND_JOBS=false` wherever the
  worker runs. The jobs include the hourly cleanup of old events.
- **Outbound (phase 2, `app/modules/outbound/service.py`):** every WhatsApp / Messenger / Instagram
  reply, from a team member or the bot, is stored as a `queued` `whatsapp_messages` row with what
  to send (`send_payload`: text, buttons, list, or a storage key for a photo/video, never the
  bytes) and a sequence number (`send_seq`). Then the conversation is dispatched: inline it is
  flushed at once; with a broker `{"numberId"}` goes on `messaging.outbound`. A flush takes a
  per-number advisory lock (busy → retry in 1 s) and sends the queued messages in `send_seq`
  order. A passing failure (network, 429, Meta 5xx) stops the flush and retries with backoff,
  holding the later messages back so the bot's text → list → photo never arrive out of order. A
  refusal (4xx), a disconnected channel or the 5th attempt marks the message `failed` and the
  flush goes on. Once sent, the row takes the provider's id; a Messenger echo that landed first is
  replaced by our row. A sweep in the worker republishes conversations with a message queued for
  over 30 s (a lost dispatch). The thread shows "Sending…" and polls every 2 s while something is
  queued. Email and Gmail replies are still sent directly.

### Code layout

Same Python package, different entrypoints (shared models and services, separate deployables):

- `app/workers/messaging.py`: the worker (`python -m app.workers.messaging`): jobs + consumer.
- `app/integrations/queue/`: `MessageBus` with `MemoryMessageBus` (tests) and `RabbitMessageBus`
  (rule 8), and the queue topology.
- `app/modules/inbound/`: `service.py` (store, relay, consumer, cleanup), `processor.py`.
- `app/modules/outbound/service.py`: queue, dispatch, ordered flush, sweep.
- `app/jobs.py`: the scheduled jobs. Migrations `0002_inbound_events.py`, `0003_queued_sends.py`.
- `app/core/tracing.py`: tracing setup and context helpers. `app/workers/health.py`: `/health`.
- `docker-compose.yml`: `rabbitmq` (management UI on http://localhost:15672, guest/guest) and
  `jaeger` (http://localhost:16686).

### Tenancy, security, privacy

- The business is still derived server-side from the receiving number, page or address, in the
  processor, never from anything else in the payload (rule 1). `inbound_events` has no
  `business_id` because the business is not known until processing; no tenant route reads it.
- Broker messages carry only the event id. Payloads (message text, phone numbers) stay in Postgres
  and are deleted 7 days after processing (30 days if never processed, long enough to look into a
  dead-lettered event). Logs and `last_error` hold the exception class, never its message.
- Traces carry ids, kinds and outcomes only; `/health` reports counts and ages only.

### Observability (phase 3)

- **Tracing** (`app/core/tracing.py`, OpenTelemetry): one incoming message is one trace across two
  services: `simplecatch-api` (HTTP request → `webhook accept` → `outbox publish`) and
  `simplecatch-worker` (`process inbound event`). A reply is another trace: `dispatch outbound` →
  `send queued messages` → `send message` → the HTTP call to Meta. The webhook's context is saved
  on `inbound_events.traceparent` (the relay runs later); broker messages carry a W3C
  `traceparent` next to the id. Exported over OTLP/HTTP only when `OTEL_EXPORTER_OTLP_ENDPOINT` is
  set; `pnpm dev` sends to the Jaeger in docker compose (http://localhost:16686).
- **Worker health** (`app/workers/health.py`): `GET http://localhost:4200/health`
  (`WORKER_HEALTH_PORT`, 0 = off). Reports database and broker reachability, inbound events waiting
  / their oldest age / given up, outbound messages queued / oldest age / failed in 24 h, and the
  depth of all six RabbitMQ queues. 503 only when the database or broker is unreachable (a restart
  helps); a backlog over 2 minutes or anything dead-lettered is 200 `"degraded"` with the reason.

### Database ownership

Phases 1–2 share the one Postgres database. In phase 3 the worker gets its own DB role, limited to
the messaging tables plus read access to the rest. A separate database per service is **not**
proposed: conversations join leads and businesses throughout the CRM, and splitting them would
mean distributed transactions for no product gain.

## 3. Phases

| Phase | Scope                                                                                                                                                         | New infrastructure                  | Size |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---- |
| 0 ✅  | Worker process runs the existing background jobs (`app/jobs.py`, `app/workers/messaging.py`); `pnpm dev` runs it and the API with `RUN_BACKGROUND_JOBS=false` | none                                | S    |
| 1 ✅  | Inbound: webhook → `inbound_events` (outbox) → relay → RabbitMQ → worker; row-locked idempotent consumer; retry queue and DLQ; `MESSAGE_BUS` switch           | RabbitMQ container                  | M    |
| 2 ✅  | Outbound: queued sends in order per conversation, retries/backoff, permanent vs passing failures, sweep, `queued` status in the UI                            | —                                   | M    |
| 3 ◐   | ✅ OpenTelemetry tracing across API ↔ worker; ✅ worker `/health` (depths, DLQ, ages); ⏸ own DB role                                                          | collector (local: Jaeger container) | S–M  |

Each phase ships on its own and leaves the system working.

## 4. Testing

- The existing webhook suites run unchanged in inline mode.
- `tests/test_inbound.py` (broker mode with `MemoryMessageBus`): the webhook only stores; the relay
  publishes ids only; the worker processes; a repeated delivery and a double broker delivery are
  processed once; failures retry with backoff and dead-letter after 5 attempts; a later success
  processes the event; a row held by another consumer is skipped; old events are deleted.
- One test runs against a real RabbitMQ (docker compose locally, a service container in CI): retry
  through the TTL queue and dead-lettering into the DLQ. It is skipped when no broker is running.
- `tests/test_outbound.py`: a reply is queued and sent by the worker; order is kept; a passing
  failure retries and holds the rest back; a refusal fails and the next one goes; the last attempt
  fails; a busy conversation is retried; bot buttons keep their kind; a Messenger echo is replaced;
  stale queues are republished; one round trip through a real RabbitMQ.
- `tests/test_tracing.py`: an incoming message and a reply are each one connected trace (parent →
  child across the stored row and the broker message); a failed send is an error span; no span
  holds message text or phone numbers. `tests/test_worker_health.py`: ok, degraded (backlog, given
  up, dead-lettered), down (no database, no broker), inline.
- e2e runs inline, so Playwright needs no broker or worker.

## 5. Decisions (owner, 2026-11-26)

1. **Broker:** RabbitMQ (dead-letter queues, a well-known tool).
2. **Hosting:** ~~self-hosted as a container~~ → free (owner, 2026-11-26): CloudAMQP's free plan,
   and the worker as a second process in the free Render instance (see "Running it").
3. **User-initiated sends:** queued too, shown `queued` → `sent` live.
4. **Dependencies:** `aio-pika` (phase 1); `opentelemetry-api`, `-sdk`, `-exporter-otlp-proto-http`,
   `-instrumentation-fastapi`, `-instrumentation-httpx` (phase 3).

### Running it

- Locally: `docker compose up -d` (Postgres, Mailpit, RabbitMQ, Jaeger), then `pnpm dev` runs the
  API and the worker with `MESSAGE_BUS=rabbitmq` and tracing on. Queues: http://localhost:15672 ·
  traces: http://localhost:16686 · worker health: http://localhost:4200/health.
- Production (`render.yaml`, free): `scripts/run_production.py` starts the API and, when
  `MESSAGE_BUS=rabbitmq` is set in the Render dashboard, the messaging worker next to it in the
  same instance, with `RUN_BACKGROUND_JOBS=false` for the API. If either process exits, both stop
  and Render restarts the service. RabbitMQ is CloudAMQP's free plan (`RABBITMQ_URL`). Without
  `MESSAGE_BUS` it runs inline exactly as before. Setup and checks: `docs/DEPLOY.md` step 6.
  Moving the worker to its own service later is configuration only.

## 6. What it's not

- Not a split of leads / CRM / quotes / sites into services.
- Not a change to the public API contract in `packages/shared`, apart from the `queued`
  delivery status (phase 2).
- Per-number rate limiting is not built: Meta's 429 is retried with backoff instead. Add it if
  volume ever needs it.
