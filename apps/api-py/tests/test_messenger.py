"""Facebook Messenger → leads (F23), ported from messenger.test.ts."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.db import models
from app.integrations.whatsapp import sign_webhook_body
from tests.conftest import add_member, business_url, make_settings, new_user, req

BUSINESS_ID = "22222222-3333-4444-8555-666666666666"
SECRET = "test-app-secret-0123456789"
PAGE_ID = "1122334455"
PSID = "7766554433221100"
HOOK = "/api/v1/integrations/messenger/webhook"
_seq = 0


def fb_text(text, psid=PSID, **extra):
    global _seq
    _seq += 1
    message = {"mid": f"m_test-{_seq}-{time.time_ns()}", **extra}
    if text is not None:
        message["text"] = text
    return {
        "object": "page",
        "entry": [
            {
                "id": PAGE_ID,
                "messaging": [
                    {
                        "sender": {"id": psid},
                        "recipient": {"id": PAGE_ID},
                        "timestamp": int(time.time() * 1000),
                        "message": message,
                    }
                ],
            }
        ],
    }


@pytest.fixture
def settings():
    return make_settings(
        MESSENGER_BUSINESS_ID=BUSINESS_ID,
        MESSENGER_PAGE_ID=PAGE_ID,
        WHATSAPP_APP_SECRET=SECRET,
        WHATSAPP_VERIFY_TOKEN="verify-me-please",
    )


@pytest.fixture
def messenger(app):
    return app.state.messenger_sender


async def setup(client, db):
    token, user_id = await new_user(client, "fb-owner")
    db.add(
        models.Business(
            id=uuid.UUID(BUSINESS_ID),
            name="מספרת שירן",
            industry="beauty",
            status=models.BusinessStatus.ACTIVE,
            updated_at=datetime.now(UTC),
        )
    )
    await db.commit()
    await add_member(db, BUSINESS_ID, user_id, "OWNER")
    return {"token": token, "user_id": user_id}


async def post(client, payload, signature=None):
    raw = json.dumps(payload).encode()
    return await client.post(
        HOOK,
        content=raw,
        headers={
            "content-type": "application/json",
            "x-hub-signature-256": signature or sign_webhook_body(raw, SECRET),
        },
    )


async def count(db, model, *where):
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


def thread_url(lead_id):
    return business_url(BUSINESS_ID, f"/leads/{lead_id}/whatsapp")


async def test_handshake(client):
    ok = await client.get(f"{HOOK}?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=42")
    assert ok.text == "42"
    assert (
        await client.get(f"{HOOK}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42")
    ).status_code == 403


async def test_new_sender_is_facebook_lead_with_their_name(client, db, messenger):
    owner = await setup(client, db)
    # F34: a required custom field never blocks a lead from a channel.
    field = {"label": "דגם", "type": "text", "required": True}
    assert (
        await req(client, "POST", business_url(BUSINESS_ID, "/lead-fields"), owner["token"], field)
    ).status_code == 201
    messenger.names[PSID] = "דנה כהן"
    assert (await post(client, fb_text("היי, יש תור למחר?"))).status_code == 200
    again = fb_text("x")
    assert (await post(client, again)).status_code == 200
    assert (await post(client, again)).status_code == 200  # stored once

    inbox = (await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/inbox"), owner["token"])).json()
    assert inbox["numbers"] == []
    lead = (await db.execute(select(models.Lead))).scalars().one()
    contact = (await db.execute(select(models.Contact))).scalars().one()
    assert lead.source == models.LeadSource.FACEBOOK
    assert lead.custom_fields == {}
    assert contact.name == "דנה כהן" and contact.phone is None

    await post(client, fb_text("ומה המחיר?"))
    assert await count(db, models.Lead) == 1
    thread = (await req(client, "GET", thread_url(lead.id), owner["token"])).json()
    assert thread["channel"] == "messenger"
    assert [m["body"] for m in thread["messages"]] == ["היי, יש תור למחר?", "x", "ומה המחיר?"]
    assert all(m.get("channel") == "messenger" for m in thread["messages"])


async def test_reply_through_messenger_within_24_hours(client, db, messenger):
    owner = await setup(client, db)
    await post(client, fb_text("היי"))
    number = (await db.execute(select(models.WhatsAppNumber))).scalars().one()
    await req(
        client,
        "POST",
        business_url(BUSINESS_ID, f"/whatsapp/numbers/{number.id}/classify"),
        owner["token"],
        {"as": "BUSINESS"},
    )
    lead = (await db.execute(select(models.Lead))).scalars().one()
    assert (await db.execute(select(models.Contact))).scalars().one().name == "משתמש/ת פייסבוק"

    sent = await req(client, "POST", thread_url(lead.id), owner["token"], {"text": "שלום! יש מחר ב-10:00"})
    assert sent.status_code == 201
    assert [(m.to, m.text) for m in messenger.sent] == [(PSID, "שלום! יש מחר ב-10:00")]

    await db.execute(
        update(models.WhatsAppMessage)
        .where(models.WhatsAppMessage.direction == models.WhatsAppDirection.IN)
        .values(created_at=datetime.now(UTC) - timedelta(hours=25))
    )
    await db.commit()
    late = await req(client, "POST", thread_url(lead.id), owner["token"], {"text": "עדיין רלוונטי?"})
    assert late.status_code == 409
    assert "בפייסבוק רק עד 24 שעות" in late.json()["error"]["message"]


async def test_personal_sender_stays_ignored(client, db):
    owner = await setup(client, db)
    now = datetime.now(UTC)
    db.add(
        models.WhatsAppNumber(
            id=uuid.uuid4(),
            business_id=uuid.UUID(BUSINESS_ID),
            channel="messenger",
            phone=f"fb:{PSID}",
            status=models.WhatsAppNumberStatus.PERSONAL,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await post(client, fb_text("עוד משהו"))
    assert await count(db, models.WhatsAppMessage) == 0
    personal = (
        await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/personal"), owner["token"])
    ).json()
    assert personal["numbers"][0]["channel"] == "messenger"


async def test_unsigned_echo_and_other_pages(client, db):
    await setup(client, db)
    assert (await post(client, fb_text("hi"), "sha256=00")).status_code == 401
    await post(client, fb_text("from the page", is_echo=True))
    other = fb_text("hi")
    other["entry"][0]["messaging"][0]["recipient"]["id"] = "999"
    await post(client, other)
    assert await count(db, models.WhatsAppMessage) == 0
    await post(client, fb_text(None, attachments=[{"type": "image"}]))
    assert (await db.execute(select(models.WhatsAppMessage))).scalars().one().body == "[תמונה]"


async def test_page_echo_shows_what_the_business_wrote(client, db):
    owner = await setup(client, db)
    await post(client, fb_text("היי"))

    def echo(mid, text, recipient=PSID):
        return {
            "object": "page",
            "entry": [
                {
                    "id": PAGE_ID,
                    "messaging": [
                        {
                            "sender": {"id": PAGE_ID},
                            "recipient": {"id": recipient},
                            "timestamp": int(time.time() * 1000),
                            "message": {"mid": mid, "text": text, "is_echo": True},
                        }
                    ],
                }
            ],
        }

    await post(client, echo("m_echo-1", "שלום, כאן העסק"))
    await post(client, echo("m_echo-1", "שלום, כאן העסק"))  # Meta's retry adds nothing
    out = (
        (
            await db.execute(
                select(models.WhatsAppMessage).where(
                    models.WhatsAppMessage.direction == models.WhatsAppDirection.OUT
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(out) == 1
    assert out[0].body == "שלום, כאן העסק" and out[0].sender_id is None and out[0].lead_id is not None
    lead = (await db.execute(select(models.Lead))).scalars().one()
    thread = (await req(client, "GET", thread_url(lead.id), owner["token"])).json()
    assert [m["body"] for m in thread["messages"]] == ["היי", "שלום, כאן העסק"]
    await post(client, echo("m_echo-2", "hello", "5550001"))  # someone who never wrote
    assert (
        await count(
            db, models.WhatsAppMessage, models.WhatsAppMessage.direction == models.WhatsAppDirection.OUT
        )
        == 1
    )


async def test_inbox_is_for_owners_and_managers(client, db):
    await setup(client, db)
    await post(client, fb_text("היי"))
    token, user_id = await new_user(client, "fb-emp")
    await add_member(db, BUSINESS_ID, user_id, "EMPLOYEE")
    assert (await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/inbox"), token)).status_code == 403
