"""D-202 phase 2: outgoing messages are queued, then sent in order per conversation by the
messaging worker, with retries for passing failures and `failed` for permanent ones."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text, update

import app.modules.outbound.service as outbound
from app.db import models
from app.integrations.email import MemoryEmailSender
from app.integrations.queue import ACK, INBOUND, OUTBOUND, MemoryMessageBus
from app.integrations.storage import LocalDiskStorage
from app.integrations.whatsapp import WhatsAppChoice, WhatsAppSendError
from app.main import create_app
from tests.conftest import make_settings, req
from tests.test_inbound import worker as inbound_worker
from tests.test_whatsapp import (
    BUSINESS_ID,
    PHONE_ID,
    SECRET,
    VERIFY,
    connected,
    customer,
    leads_of,
    post,
    text_event,
    thread_url,
)


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
    yield create_app(
        settings,
        email=MemoryEmailSender(),
        storage=LocalDiskStorage(str(tmp_path / "media")),
        message_bus=bus,
    )


@pytest.fixture
def wa(app):
    return app.state.whatsapp_sender


def sender(app):
    return lambda body: outbound.handle(app.state, body)


async def a_conversation(app, client, db, bus):
    """A customer wrote in (processed by the worker); returns the owner, the lead and the number."""
    owner = await connected(client, db)
    number = await customer(db)
    await post(client, text_event("972501112233", "היי"))
    from app.modules.inbound.service import publish_pending

    await publish_pending(app.state)
    await bus.drain(inbound_worker(app), INBOUND)
    (lead,) = await leads_of(client, owner["token"])
    return owner, lead, SimpleNamespace(id=number.id)  # survives the session expiring


async def queue(app, number, *bodies: str) -> list[uuid.UUID]:
    ids = []
    async with app.state.sessionmaker() as db:
        for body in bodies:
            row = outbound.queue_message(
                db,
                business_id=uuid.UUID(BUSINESS_ID),
                number_id=number.id,
                contact_id=None,
                lead_id=None,
                body=body,
                payload={"kind": "text", "text": body},
            )
            await db.commit()
            ids.append(row.id)
    return ids


async def statuses(db, ids):
    db.expire_all()
    rows = (
        await db.execute(select(models.WhatsAppMessage).where(models.WhatsAppMessage.id.in_(ids)))
    ).scalars()
    by_id = {r.id: r for r in rows}
    return [by_id[i].status for i in ids]


async def test_a_reply_is_queued_then_sent_by_the_worker(app, client, db, bus, wa):
    owner, lead, number = await a_conversation(app, client, db, bus)
    res = await req(
        client, "POST", thread_url(BUSINESS_ID, lead["id"]), owner["token"], {"text": "מתי נוח לך?"}
    )
    assert res.status_code == 201
    message = res.json()["message"]
    assert message["status"] == "queued" and message["sender"]["id"] == owner["user_id"]
    assert wa.sent == []  # nothing left the API
    assert bus.published[OUTBOUND] == [{"numberId": str(number.id)}]  # an id only

    await bus.drain(sender(app), OUTBOUND)
    assert [m.text for m in wa.sent] == ["מתי נוח לך?"]
    row = await db.get(models.WhatsAppMessage, uuid.UUID(message["id"]))
    await db.refresh(row)
    assert (row.status, row.wa_message_id, row.send_payload) == ("sent", wa.sent[0].id, None)
    thread = (await req(client, "GET", thread_url(BUSINESS_ID, lead["id"]), owner["token"])).json()
    assert thread["messages"][-1]["status"] == "sent"


async def test_one_conversation_is_sent_in_the_order_it_was_queued(app, client, db, bus, wa):
    _, _, number = await a_conversation(app, client, db, bus)
    ids = await queue(app, number, *[f"הודעה {i}" for i in range(6)])
    assert await outbound.flush_number(app.state, number.id) == ACK
    assert [m.text for m in wa.sent] == [f"הודעה {i}" for i in range(6)]
    assert await statuses(db, ids) == ["sent"] * 6


async def test_a_passing_failure_retries_and_holds_the_rest_back(app, client, db, bus, wa):
    _, _, number = await a_conversation(app, client, db, bus)
    ids = await queue(app, number, "ראשונה", "שנייה")
    wa.fail_with = WhatsAppSendError(503, None)
    outcome = await outbound.flush_number(app.state, number.id)
    assert outcome.kind == "retry" and outcome.delay_s == 2.0
    assert await statuses(db, ids) == ["queued", "queued"]  # the second waits for the first

    wa.fail_with = None
    assert await outbound.flush_number(app.state, number.id) == ACK
    assert [m.text for m in wa.sent] == ["ראשונה", "שנייה"]
    assert await statuses(db, ids) == ["sent", "sent"]


async def test_a_refused_message_fails_and_the_next_one_still_goes(app, client, db, bus, wa, monkeypatch):
    _, _, number = await a_conversation(app, client, db, bus)
    ids = await queue(app, number, "נדחית", "עוברת")
    real = wa.send_text

    async def refuse_first(to, body, preview=False):
        if body == "נדחית":
            raise WhatsAppSendError(400, 131047)
        return await real(to, body, preview)

    monkeypatch.setattr(wa, "send_text", refuse_first)
    assert await outbound.flush_number(app.state, number.id) == ACK
    assert await statuses(db, ids) == ["failed", "sent"]


async def test_after_the_last_attempt_the_message_fails(app, client, db, bus, wa):
    _, _, number = await a_conversation(app, client, db, bus)
    (mid,) = await queue(app, number, "שוב ושוב")
    wa.fail_with = ConnectionError()
    await bus.publish({"numberId": str(number.id)}, OUTBOUND)
    await bus.drain(sender(app), OUTBOUND)
    assert [delay for _, delay in bus.retries] == [2.0, 4.0, 8.0, 16.0]
    row = await db.get(models.WhatsAppMessage, mid)
    await db.refresh(row)
    assert (row.status, row.send_attempts, row.send_payload) == ("failed", outbound.MAX_ATTEMPTS, None)


async def test_a_conversation_being_sent_elsewhere_is_retried_shortly(app, client, db, bus, wa):
    _, _, number = await a_conversation(app, client, db, bus)
    await queue(app, number, "ממתינה")
    async with app.state.sessionmaker() as other:
        await other.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": outbound._lock_key(number.id)})
        outcome = await outbound.flush_number(app.state, number.id)
        assert outcome.kind == "retry" and outcome.delay_s == outbound.BUSY_RETRY_S
    assert wa.sent == []
    assert await outbound.flush_number(app.state, number.id) == ACK
    assert len(wa.sent) == 1


async def test_bot_messages_keep_their_kind_and_order(app, client, db, bus, wa):
    _, _, number = await a_conversation(app, client, db, bus)
    async with app.state.sessionmaker() as s:
        for body, payload in [
            ("שלום", {"kind": "text", "text": "שלום", "preview": True}),
            (
                "בחרו",
                {
                    "kind": "buttons",
                    "body": "בחרו",
                    "buttons": outbound.choices_payload([WhatsAppChoice("book", "לקבוע")]),
                },
            ),
        ]:
            outbound.queue_message(
                s,
                business_id=uuid.UUID(BUSINESS_ID),
                number_id=number.id,
                contact_id=None,
                lead_id=None,
                body=body,
                payload=payload,
            )
            await s.commit()
    await outbound.flush_number(app.state, number.id)
    assert [(m.text, m.choices) for m in wa.sent] == [
        ("שלום", None),
        ("בחרו", [WhatsAppChoice("book", "לקבוע")]),
    ]


async def test_an_echo_that_lands_first_is_replaced_by_our_row(app, client, db, bus, wa, monkeypatch):
    """Messenger can echo our message back before we record the provider's id."""
    _, _, number = await a_conversation(app, client, db, bus)
    (mid,) = await queue(app, number, "שלום")
    echo_id = uuid.uuid4()
    db.add(
        models.WhatsAppMessage(
            id=echo_id,
            business_id=uuid.UUID(BUSINESS_ID),
            number_id=number.id,
            direction=models.WhatsAppDirection.OUT,
            wa_message_id="wamid.fixed",
            body="שלום",
            status="sent",
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()

    async def fixed(to, body, preview=False):
        return {"id": "wamid.fixed"}

    monkeypatch.setattr(wa, "send_text", fixed)
    await outbound.flush_number(app.state, number.id)
    db.expire_all()
    rows = (
        (
            await db.execute(
                select(models.WhatsAppMessage).where(models.WhatsAppMessage.wa_message_id == "wamid.fixed")
            )
        )
        .scalars()
        .all()
    )
    assert [r.id for r in rows] == [mid]


async def test_stale_queues_are_published_again(app, client, db, bus, wa):
    _, _, number = await a_conversation(app, client, db, bus)
    (mid,) = await queue(app, number, "נשכחה")
    assert await outbound.republish_stale(app.state) == 0  # just queued: its dispatch is on its way
    await db.execute(
        update(models.WhatsAppMessage)
        .where(models.WhatsAppMessage.id == mid)
        .values(created_at=datetime.now(UTC) - timedelta(minutes=2))
    )
    await db.commit()
    assert await outbound.republish_stale(app.state) == 1
    assert bus.published[OUTBOUND][-1] == {"numberId": str(number.id)}


async def test_unknown_and_malformed_messages(app):
    assert await outbound.handle(app.state, {"numberId": "nope"}) == outbound.DEAD
    assert await outbound.handle(app.state, {"numberId": str(uuid.uuid4())}) == ACK


async def test_rabbitmq_round_trip(settings, tmp_path, client, db):
    """Queued in one place, sent by a consumer through a real RabbitMQ (docker compose); skipped
    when none is running."""
    import asyncio

    from app.integrations.queue import RabbitMessageBus, dead_letter_queue, retry_queue

    bus = RabbitMessageBus(settings.RABBITMQ_URL)
    try:
        channel = await asyncio.wait_for(bus._open(), 3)
    except Exception:
        pytest.skip("RabbitMQ is not running")
    for name in (OUTBOUND, retry_queue(OUTBOUND), dead_letter_queue(OUTBOUND)):
        await (await channel.get_queue(name)).purge()
    real = create_app(
        settings, email=MemoryEmailSender(), storage=LocalDiskStorage(str(tmp_path)), message_bus=bus
    )
    try:
        await connected(client, db)
        number = await customer(db)
        await bus.consume(lambda body: outbound.handle(real.state, body), OUTBOUND)
        await queue(real, number, "דרך הברוקר")
        await outbound.dispatch(real.state, number.id)
        wa = real.state.whatsapp_sender
        for _ in range(100):
            if wa.sent:
                break
            await asyncio.sleep(0.05)
        assert [m.text for m in wa.sent] == ["דרך הברוקר"]
    finally:
        await bus.close()
        await real.state.engine.dispose()
