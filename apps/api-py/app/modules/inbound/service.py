"""Inbound events: the transactional outbox between the webhooks and the messaging worker (D-202).

1. `store`: the webhook saves the signed payload (one row per delivery; Meta's retries of the same
   body are the same row) and answers 200.
2. `publish_pending` (outbox relay): unpublished rows are published to the bus as `{"eventId"}`
   and marked published in the same transaction that claimed them, so delivery is at least once.
3. `handle` (worker): processes an event once, under a row lock; failures are counted and
   retried with backoff, and after `MAX_ATTEMPTS` the message goes to the dead-letter queue.

With `MESSAGE_BUS=inline` step 2 and 3 are replaced by `run_event` inside the request.
"""

import asyncio
import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from opentelemetry import trace as trace_api
from opentelemetry.trace import SpanKind
from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.tracing import carrier_of, context_of, current_traceparent, tracer
from app.db.models import InboundEvent
from app.integrations.queue import ACK, DEAD, Outcome, retry_in
from app.modules.inbound.processor import PROCESSORS, process
from app.modules.whatsapp.service import build_service

log = logging.getLogger("simplecatch")

MAX_ATTEMPTS = 5
RELAY_BATCH = 100
KEEP_PROCESSED = timedelta(days=7)  # payloads hold message text and phone numbers
KEEP_UNPROCESSED = timedelta(days=30)  # long enough to look into a dead-lettered event


class EventFailed(Exception):
    def __init__(self, attempts: int) -> None:
        super().__init__(f"processing failed ({attempts} attempts)")
        self.attempts = attempts


def dedupe_key(provider: str, raw: bytes) -> str:
    return hashlib.sha256(provider.encode() + b"\0" + raw).hexdigest()


async def store(state: Any, provider: str, raw: bytes, payload: Any) -> tuple[InboundEvent, bool]:
    """Saves a delivery; returns the row and whether it is new (False for a repeated delivery)."""
    assert provider in PROCESSORS
    key = dedupe_key(provider, raw)
    async with state.sessionmaker() as db:
        new_id = (
            await db.execute(
                pg_insert(InboundEvent)
                .values(
                    id=uuid.uuid4(),
                    provider=provider,
                    dedupe_key=key,
                    payload=payload,
                    traceparent=current_traceparent(),
                )
                .on_conflict_do_nothing(index_elements=["dedupe_key"])
                .returning(InboundEvent.id)
            )
        ).scalar_one_or_none()
        await db.commit()
        event = (await db.execute(select(InboundEvent).where(InboundEvent.dedupe_key == key))).scalar_one()
        return event, new_id is not None


async def run_event(state: Any, event_id: uuid.UUID) -> bool:
    """Processes one event unless it is done or another process holds it; True when it ran.

    The row stays locked (`FOR UPDATE SKIP LOCKED`) while the work runs on a second session, so two
    consumers never process the same event at once. Raises `EventFailed` after recording the failure.
    """
    async with state.sessionmaker() as lock_db:
        event = (
            await lock_db.execute(
                select(InboundEvent).where(InboundEvent.id == event_id).with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if event is None or event.processed_at is not None:
            return False
        span = trace_api.get_current_span()
        span.set_attribute("messaging.provider", event.provider)
        span.set_attribute("inbound.attempt", event.attempts + 1)
        try:
            async with state.sessionmaker() as db:
                await process(build_service(state, db), event.provider, event.payload)
        except Exception as err:
            await lock_db.rollback()
            attempts = (
                await lock_db.execute(
                    update(InboundEvent)
                    .where(InboundEvent.id == event_id)
                    .values(attempts=InboundEvent.attempts + 1, last_error=type(err).__name__[:200])
                    .returning(InboundEvent.attempts)
                )
            ).scalar_one()
            await lock_db.commit()
            log.error(
                "inbound event failed",
                extra={"eventId": str(event_id), "attempts": attempts, "errName": type(err).__name__},
            )
            raise EventFailed(attempts) from err
        event.processed_at = datetime.now(UTC)
        event.last_error = None
        await lock_db.commit()
        return True


def backoff_s(attempts: int) -> float:
    """2, 4, 8, 16 … seconds, at most a minute."""
    return float(min(2**attempts, 60))


async def handle(state: Any, body: dict[str, Any]) -> Outcome:
    """The worker's consumer: what to do with one `{"eventId"}` message."""
    try:
        event_id = uuid.UUID(str(body.get("eventId")))
    except ValueError:
        return DEAD
    with tracer.start_as_current_span(
        "process inbound event",
        context=context_of(body.get("trace")),
        kind=SpanKind.CONSUMER,
        attributes={"inbound.event_id": str(event_id)},
    ) as span:
        try:
            ran = await run_event(state, event_id)
        except EventFailed as failed:
            span.set_attribute("inbound.attempts", failed.attempts)
            span.set_status(trace_api.StatusCode.ERROR)
            return DEAD if failed.attempts >= MAX_ATTEMPTS else retry_in(backoff_s(failed.attempts))
        span.set_attribute("inbound.skipped", not ran)
        return ACK


async def publish_pending(state: Any, limit: int = RELAY_BATCH) -> int:
    """The outbox relay: publishes a batch of unpublished events; returns how many."""
    async with state.sessionmaker() as db:
        rows = (
            await db.execute(
                select(InboundEvent.id, InboundEvent.traceparent)
                .where(InboundEvent.published_at.is_(None), InboundEvent.processed_at.is_(None))
                .order_by(InboundEvent.received_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()
        ids = [event_id for event_id, _ in rows]
        for event_id, traceparent in rows:
            # A child of the webhook's span, though it runs later (maybe in another process).
            with tracer.start_as_current_span(
                "outbox publish",
                context=context_of(traceparent),
                kind=SpanKind.PRODUCER,
                attributes={"inbound.event_id": str(event_id)},
            ):
                await state.bus.publish({"eventId": str(event_id), "trace": carrier_of()})
        if ids:
            await db.execute(
                update(InboundEvent).where(InboundEvent.id.in_(ids)).values(published_at=datetime.now(UTC))
            )
        await db.commit()
        return len(ids)


def start_outbox_relay(app: Any, interval_s: float = 2.0) -> "asyncio.Task[None]":
    """Publishes new events as soon as a webhook signals (`app.state.relay_wake`), and every few
    seconds anyway. Safe in several processes at once (rows are claimed with SKIP LOCKED)."""
    wake = asyncio.Event()
    app.state.relay_wake = wake

    async def loop() -> None:
        while True:
            try:
                await asyncio.wait_for(wake.wait(), interval_s)
            except TimeoutError:
                pass
            wake.clear()
            try:
                while await publish_pending(app.state) == RELAY_BATCH:
                    pass
            except Exception as err:  # broker or database down: the rows wait for the next run
                log.error("outbox relay run failed", extra={"errName": type(err).__name__})

    return asyncio.create_task(loop())


async def delete_old_events(state: Any, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    async with state.sessionmaker() as db:
        result = await db.execute(
            delete(InboundEvent).where(
                or_(
                    InboundEvent.processed_at < now - KEEP_PROCESSED,
                    InboundEvent.received_at < now - KEEP_UNPROCESSED,
                )
            )
        )
        await db.commit()
        return result.rowcount or 0


def start_inbound_cleanup(app: Any, interval_s: float = 3600) -> "asyncio.Task[None]":
    async def loop() -> None:
        while True:
            await asyncio.sleep(interval_s)
            try:
                await delete_old_events(app.state)
            except Exception as err:
                log.error("inbound cleanup failed", extra={"errName": type(err).__name__})

    return asyncio.create_task(loop())
