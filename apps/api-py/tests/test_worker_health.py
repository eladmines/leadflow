"""D-202 phase 3: the messaging worker's GET /health: counts and ages, 503 only when the database
or the broker can't be reached."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

import app.modules.outbound.service as outbound
from app.db import models
from app.integrations.queue import DLQ, INBOUND, OUTBOUND
from app.modules.inbound.service import MAX_ATTEMPTS, store
from app.workers.health import health_app, snapshot
from tests.test_outbound import app, bus, queue, settings, wa  # noqa: F401 (fixtures: broker mode)
from tests.test_whatsapp import connected, customer


async def get_health(state):
    async with AsyncClient(transport=ASGITransport(app=health_app(state)), base_url="http://w") as c:
        return await c.get("/health")


async def test_an_idle_worker_is_ok(app):  # noqa: F811
    res = await get_health(app.state)
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    body = res.json()
    assert body["status"] == "ok" and body["database"] == "ok" and body["broker"] == "ok"
    assert body["inbound"] == {"waiting": 0, "oldestAgeSeconds": None, "gaveUp": 0}
    assert body["outbound"] == {"queued": 0, "oldestAgeSeconds": None, "failedLast24h": 0}
    assert body["queues"][INBOUND] == 0 and body["queues"][DLQ] == 0


async def test_a_backlog_and_given_up_events_are_degraded_not_down(app, client, db):  # noqa: F811
    await connected(client, db)
    number = await customer(db)
    (mid,) = await queue(app, number, "תקועה")
    await db.execute(
        update(models.WhatsAppMessage)
        .where(models.WhatsAppMessage.id == mid)
        .values(created_at=datetime.now(UTC) - timedelta(minutes=10))
    )
    event, _ = await store(app.state, "whatsapp", b"{}", {})
    await db.execute(
        update(models.InboundEvent).where(models.InboundEvent.id == event.id).values(attempts=MAX_ATTEMPTS)
    )
    await db.commit()

    status, body = await snapshot(app.state)
    assert status == 200 and body["status"] == "degraded"
    assert body["problems"] == ["outbound backlog", "inbound events gave up"]
    assert body["outbound"]["queued"] == 1 and body["outbound"]["oldestAgeSeconds"] >= 600
    assert body["inbound"] == {"waiting": 0, "oldestAgeSeconds": None, "gaveUp": 1}


async def test_dead_lettered_messages_are_degraded(app, bus):  # noqa: F811
    body = {"numberId": str(uuid.uuid4())}
    await bus.publish(body, OUTBOUND)
    await bus.drain(lambda _: outbound.handle(app.state, {"numberId": "broken"}), OUTBOUND)
    status, report = await snapshot(app.state)
    assert status == 200 and "dead-lettered messages" in report["problems"]
    assert report["queues"]["messaging.outbound.dlq"] == 1


async def test_no_broker_or_no_database_is_down(app):  # noqa: F811
    class Broken:
        async def depths(self):
            raise ConnectionError

    state = SimpleNamespace(sessionmaker=app.state.sessionmaker, bus=Broken())
    res = await get_health(state)
    assert res.status_code == 503 and res.json()["broker"] == "unreachable"

    def no_db():
        raise OSError("connection refused")

    res = await get_health(SimpleNamespace(sessionmaker=no_db, bus=None))
    assert res.status_code == 503 and res.json() == {"status": "down", "database": "unreachable"}


async def test_inline_mode_reports_the_broker_as_off(app):  # noqa: F811
    status, body = await snapshot(SimpleNamespace(sessionmaker=app.state.sessionmaker, bus=None))
    assert status == 200 and body["broker"] == "off" and "queues" not in body
