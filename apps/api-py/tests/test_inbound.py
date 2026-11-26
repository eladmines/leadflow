"""D-202 phase 1: webhooks are stored first (transactional outbox), published by the relay and
processed by the messaging worker, with retries and a dead-letter queue."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

import app.modules.inbound.service as inbound
from app.db import models
from app.integrations.email import MemoryEmailSender
from app.integrations.queue import DLQ, INBOUND, RETRY, MemoryMessageBus, RabbitMessageBus, retry_in
from app.integrations.storage import LocalDiskStorage
from app.main import create_app
from tests.conftest import make_settings
from tests.test_whatsapp import BUSINESS_ID, PHONE_ID, SECRET, VERIFY, connected, customer, post, text_event


@pytest.fixture
def settings():
    return make_settings(
        WHATSAPP_BUSINESS_ID=BUSINESS_ID,
        WHATSAPP_APP_SECRET=SECRET,
        WHATSAPP_VERIFY_TOKEN=VERIFY,
        WHATSAPP_PHONE_NUMBER_ID=PHONE_ID,
        MESSAGE_BUS="rabbitmq",
    )


@pytest.fixture
def bus() -> MemoryMessageBus:
    return MemoryMessageBus()


@pytest.fixture
async def app(settings, bus, tmp_path):
    app = create_app(
        settings,
        email=MemoryEmailSender(),
        storage=LocalDiskStorage(str(tmp_path / "media")),
        message_bus=bus,
    )
    yield app


async def count(db, model):
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def events(db) -> list[models.InboundEvent]:
    db.expire_all()
    return list((await db.execute(select(models.InboundEvent))).scalars().all())


def worker(app):
    return lambda body: inbound.handle(app.state, body)


async def test_webhook_only_stores_then_the_worker_processes(app, client, db, bus):
    await connected(client, db)
    await customer(db)
    res = await post(client, text_event("972501112233", "היי, אפשר תור?"))
    assert res.status_code == 200

    (event,) = await events(db)
    assert event.provider == "whatsapp" and event.published_at is None and event.processed_at is None
    assert await count(db, models.WhatsAppMessage) == 0  # nothing processed inside the request

    assert await inbound.publish_pending(app.state) == 1
    assert bus.published == [{"eventId": str(event.id)}]  # ids only, no message text
    assert await inbound.publish_pending(app.state) == 0

    await bus.drain(worker(app))
    assert await count(db, models.WhatsAppMessage) == 1
    assert await count(db, models.Lead) == 1
    (event,) = await events(db)
    assert event.processed_at is not None and event.attempts == 0


async def test_a_repeated_delivery_is_stored_and_processed_once(app, client, db, bus):
    await connected(client, db)
    await customer(db)
    payload = text_event("972501112233", "שלום", id="wamid.same")
    await post(client, payload)
    await post(client, payload)
    assert len(await events(db)) == 1
    await inbound.publish_pending(app.state)
    bus.queued.append(bus.published[0])  # the broker delivers it twice (at least once)
    await bus.drain(worker(app))
    assert await count(db, models.WhatsAppMessage) == 1


async def test_failures_are_retried_with_backoff_then_dead_lettered(app, client, db, bus, monkeypatch):
    await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "שלום"))
    await inbound.publish_pending(app.state)

    async def broken(*_):
        raise RuntimeError("provider said no")

    monkeypatch.setattr(inbound, "process", broken)
    await bus.drain(worker(app))
    assert [delay for _, delay in bus.retries] == [2.0, 4.0, 8.0, 16.0]
    assert len(bus.dead) == 1
    (event,) = await events(db)
    assert event.attempts == inbound.MAX_ATTEMPTS and event.processed_at is None
    assert event.last_error == "RuntimeError"  # the class only, never the message


async def test_a_retry_that_succeeds_processes_the_event(app, client, db, bus, monkeypatch):
    await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "שלום"))
    await inbound.publish_pending(app.state)
    real, calls = inbound.process, []

    async def flaky(*args):
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionError
        await real(*args)

    monkeypatch.setattr(inbound, "process", flaky)
    await bus.drain(worker(app))
    assert len(bus.retries) == 1 and bus.dead == []
    assert await count(db, models.WhatsAppMessage) == 1


async def test_processed_unknown_and_malformed_messages(app, client, db, bus):
    assert await inbound.handle(app.state, {"eventId": "not-a-uuid"}) == inbound.DEAD
    assert await inbound.handle(app.state, {}) == inbound.DEAD
    assert await inbound.handle(app.state, {"eventId": str(uuid.uuid4())}) == inbound.ACK

    await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "שלום"))
    (event,) = await events(db)
    assert await inbound.handle(app.state, {"eventId": str(event.id)}) == inbound.ACK
    assert await inbound.handle(app.state, {"eventId": str(event.id)}) == inbound.ACK  # no second run
    assert await count(db, models.WhatsAppMessage) == 1


async def test_an_event_held_by_another_consumer_is_skipped(app, db):
    event, _ = await inbound.store(app.state, "whatsapp", b"{}", {})
    async with app.state.sessionmaker() as other:
        await other.execute(
            select(models.InboundEvent).where(models.InboundEvent.id == event.id).with_for_update()
        )
        assert await inbound.run_event(app.state, event.id) is False
    assert await inbound.run_event(app.state, event.id) is True


async def test_old_events_are_deleted(app, db):
    now = datetime.now(UTC)
    old_done, _ = await inbound.store(app.state, "whatsapp", b"1", {})
    new_done, _ = await inbound.store(app.state, "whatsapp", b"2", {})
    stuck, _ = await inbound.store(app.state, "whatsapp", b"3", {})
    await db.execute(
        update(models.InboundEvent)
        .where(models.InboundEvent.id == old_done.id)
        .values(processed_at=now - timedelta(days=8))
    )
    await db.execute(
        update(models.InboundEvent).where(models.InboundEvent.id == new_done.id).values(processed_at=now)
    )
    await db.execute(
        update(models.InboundEvent)
        .where(models.InboundEvent.id == stuck.id)
        .values(received_at=now - timedelta(days=31))
    )
    await db.commit()
    assert await inbound.delete_old_events(app.state) == 2
    assert [e.id for e in await events(db)] == [new_done.id]


async def _rabbit(url: str) -> RabbitMessageBus | None:
    bus = RabbitMessageBus(url)
    try:
        channel = await asyncio.wait_for(bus._open(), 3)
    except Exception:
        return None
    for name in (INBOUND, RETRY, DLQ):
        await (await channel.get_queue(name)).purge()
    return bus


async def test_rabbitmq_retries_then_dead_letters(settings):
    """Against a real RabbitMQ (docker compose); skipped when none is running."""
    bus = await _rabbit(settings.RABBITMQ_URL)
    if bus is None:
        pytest.skip("RabbitMQ is not running")
    seen: list[dict] = []
    done = asyncio.Event()

    async def handler(body):
        seen.append(body)
        if body["n"] == "ok-after-retry" and seen.count(body) == 1:
            return retry_in(0.2)
        if body["n"] == "poison":
            return inbound.DEAD
        if len(seen) >= 3:
            done.set()
        return inbound.ACK

    try:
        await bus.consume(handler)
        await bus.publish({"n": "ok-after-retry"})
        await bus.publish({"n": "poison"})
        await asyncio.wait_for(done.wait(), 10)
        assert [b["n"] for b in seen].count("ok-after-retry") == 2  # came back from the retry queue
        dlq = await (await bus._open()).get_queue(DLQ)
        message = await dlq.get(no_ack=True, fail=False)
        assert message is not None and b"poison" in message.body
    finally:
        await bus.close()
