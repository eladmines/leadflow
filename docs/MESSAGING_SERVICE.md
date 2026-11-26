# Messaging service (D-202, _Accepted_ 2026-11-26)

**Status:** phases 0 and 1 done; phase 2 (outbound) next. Decisions are in §5.

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
- **Outbound (phase 2):** sends the bot makes and user-initiated sends go to `messaging.outbound`.
  The message row is written as `queued` and moves to `sent` / `failed`, with the same retry and DLQ.

### Code layout

Same Python package, different entrypoints (shared models and services, separate deployables):

- `app/workers/messaging.py`: the worker (`python -m app.workers.messaging`): jobs + consumer.
- `app/integrations/queue/`: `MessageBus` with `MemoryMessageBus` (tests) and `RabbitMessageBus`
  (rule 8), and the queue topology.
- `app/modules/inbound/`: `service.py` (store, relay, consumer, cleanup), `processor.py`.
- `app/jobs.py`: the scheduled jobs. `alembic/versions/0002_inbound_events.py`: the table.
- `docker-compose.yml`: `rabbitmq` (management UI on http://localhost:15672, guest/guest).

### Tenancy, security, privacy

- The business is still derived server-side from the receiving number, page or address, in the
  processor, never from anything else in the payload (rule 1). `inbound_events` has no
  `business_id` because the business is not known until processing; no tenant route reads it.
- Broker messages carry only the event id. Payloads (message text, phone numbers) stay in Postgres
  and are deleted 7 days after processing (30 days if never processed, long enough to look into a
  dead-lettered event). Logs and `last_error` hold the exception class, never its message.
- Phase 3: trace context on every event (OpenTelemetry), so one message can be followed from the
  webhook through the worker to the outbound send.

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
| 2     | Outbound: queued sends, retries/backoff, per-number rate limiting, `queued` status in UI                                                                      | —                                   | M    |
| 3     | Own DB role, OpenTelemetry tracing across API ↔ worker, queue depth / DLQ health checks                                                                       | collector (local: Jaeger container) | S–M  |

Each phase ships on its own and leaves the system working.

## 4. Testing

- The existing webhook suites run unchanged in inline mode.
- `tests/test_inbound.py` (broker mode with `MemoryMessageBus`): the webhook only stores; the relay
  publishes ids only; the worker processes; a repeated delivery and a double broker delivery are
  processed once; failures retry with backoff and dead-letter after 5 attempts; a later success
  processes the event; a row held by another consumer is skipped; old events are deleted.
- One test runs against a real RabbitMQ (docker compose locally, a service container in CI): retry
  through the TTL queue and dead-lettering into the DLQ. It is skipped when no broker is running.
- e2e runs inline, so Playwright needs no broker or worker.

## 5. Decisions (owner, 2026-11-26)

1. **Broker:** RabbitMQ (dead-letter queues, a well-known tool).
2. **Hosting:** self-hosted as a container; no paid managed plan.
3. **User-initiated sends:** queued too, shown `queued` → `sent` live.
4. **Dependencies:** `aio-pika` (added in phase 1); `opentelemetry-*` with phase 3.

### Running it

- Locally: `docker compose up -d` (now includes RabbitMQ), then `pnpm dev` runs the API and the
  worker with `MESSAGE_BUS=rabbitmq`. Queues are visible at http://localhost:15672.
- Production (`render.yaml`) is one free web service and Render's background workers are a paid
  plan, so it keeps the defaults: `MESSAGE_BUS=inline` and `RUN_BACKGROUND_JOBS` on. Moving to the
  worker means three changes together: a RabbitMQ the services can reach, a worker service
  (`python -m app.workers.messaging` with `MESSAGE_BUS=rabbitmq`), and on the API
  `MESSAGE_BUS=rabbitmq` + `RUN_BACKGROUND_JOBS=false`. Choosing that host is a deployment
  decision still to be made.

## 6. What it's not

- Not a split of leads / CRM / quotes / sites into services.
- Not a change to the public API contract in `packages/shared`, apart from a `queued`
  delivery status in phase 2.
