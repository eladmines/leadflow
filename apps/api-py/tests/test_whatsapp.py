"""WhatsApp (F12 POC): webhook, leads from messages, replies, inbox and classification
(ported from apps/api/src/modules/whatsapp/whatsapp.test.ts)."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.db import models
from app.integrations.whatsapp import (
    CloudWhatsAppSender,
    MemoryWhatsAppSender,
    WhatsAppSendError,
    sign_webhook_body,
)
from app.modules.whatsapp.schemas import MESSAGES as WM
from tests.conftest import add_member, business_url, make_settings, new_user, owner_with_business, req

BUSINESS_ID = "11111111-2222-4333-8444-555555555555"
SECRET = "test-app-secret-0123456789"
VERIFY = "verify-me-please"
PHONE_ID = "1234567890"
WEBHOOK = "/api/v1/integrations/whatsapp/webhook"

_seq = 0


def text_event(sender, text, name="דנה כהן", id=None, at=None, phone_id=PHONE_ID):
    global _seq
    _seq += 1
    at = at or datetime.now(UTC)
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "waba",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {"display_phone_number": "15550001111", "phone_number_id": phone_id},
                            "contacts": [{"wa_id": sender, "profile": {"name": name}}],
                            "messages": [
                                {
                                    "from": sender,
                                    "id": id or f"wamid.test-{_seq}-{time.time_ns()}",
                                    "timestamp": str(int(at.timestamp())),
                                    "type": "text",
                                    "text": {"body": text},
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


def status_event(id, status):
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {"phone_number_id": PHONE_ID},
                            "statuses": [{"id": id, "status": status}],
                        },
                    }
                ]
            }
        ],
    }


@pytest.fixture
def settings():
    return make_settings(
        WHATSAPP_BUSINESS_ID=BUSINESS_ID,
        WHATSAPP_APP_SECRET=SECRET,
        WHATSAPP_VERIFY_TOKEN=VERIFY,
        WHATSAPP_PHONE_NUMBER_ID=PHONE_ID,
    )


@pytest.fixture
def wa(app) -> MemoryWhatsAppSender:
    return app.state.whatsapp_sender


async def connected(client, db):
    """The connected business (fixed id) with its owner."""
    token, user_id = await new_user(client, "wa-owner")
    now = datetime.now(UTC)
    db.add(
        models.Business(
            id=uuid.UUID(BUSINESS_ID),
            name="עיצוב שיער סיגלית",
            industry="beauty",
            status=models.BusinessStatus.ACTIVE,
            updated_at=now,
            whatsapp_reply_mode="off",
        )
    )
    await db.commit()
    await add_member(db, BUSINESS_ID, user_id, "OWNER")
    return {"token": token, "user_id": user_id}


async def customer(db, phone="+972501112233", status="BUSINESS"):
    now = datetime.now(UTC)
    n = models.WhatsAppNumber(
        id=uuid.uuid4(),
        business_id=uuid.UUID(BUSINESS_ID),
        phone=phone,
        channel="whatsapp",
        status=models.WhatsAppNumberStatus(status),
        created_at=now,
        updated_at=now,
    )
    db.add(n)
    await db.commit()
    return n


async def post(client, payload, signature=""):
    raw = json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if signature is not None:
        headers["x-hub-signature-256"] = signature or sign_webhook_body(raw, SECRET)
    return await client.post(WEBHOOK, content=raw, headers=headers)


async def leads_of(client, token):
    return (await req(client, "GET", business_url(BUSINESS_ID, "/leads"), token)).json()["leads"]


def thread_url(bid, lead_id):
    return business_url(bid, f"/leads/{lead_id}/whatsapp")


async def count(db, model, *where):
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_handshake_needs_the_right_token(client, connected_=None):
    ok = await client.get(f"{WEBHOOK}?hub.mode=subscribe&hub.verify_token={VERIFY}&hub.challenge=12345")
    assert ok.status_code == 200 and ok.text == "12345"
    bad = await client.get(f"{WEBHOOK}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345")
    assert bad.status_code == 403


async def test_rejects_unsigned_events(client, db):
    await connected(client, db)
    assert (await post(client, text_event("972501112233", "היי"), None)).status_code == 401
    assert (await post(client, text_event("972501112233", "היי"), "sha256=00ff")).status_code == 401
    assert await count(db, models.WhatsAppMessage) == 0
    assert await count(db, models.Lead) == 0


async def test_business_number_becomes_lead_with_conversation(client, db):
    owner = await connected(client, db)
    await customer(db)
    res = await post(client, text_event("972501112233", "היי, אפשר לקבוע תספורת לשבוע הבא?"))
    assert res.status_code == 200
    (lead,) = await leads_of(client, owner["token"])
    assert lead["source"] == "whatsapp"
    assert lead["message"] == "היי, אפשר לקבוע תספורת לשבוע הבא?"
    assert lead["contact"]["name"] == "דנה כהן" and lead["contact"]["phone"] == "+972501112233"
    assert lead["stage"]["name"] == "חדש"
    assert lead["lastWhatsApp"]["direction"] == "IN"
    thread = (await req(client, "GET", thread_url(BUSINESS_ID, lead["id"]), owner["token"])).json()
    assert thread["connected"] is True
    assert [(m["direction"], m["body"], m["status"]) for m in thread["messages"]] == [
        ("IN", "היי, אפשר לקבוע תספורת לשבוע הבא?", "received")
    ]
    until = datetime.fromisoformat(thread["replyUntil"].replace("Z", "+00:00"))
    assert until > datetime.now(UTC) + timedelta(hours=23)


async def test_ignores_retries(client, db):
    owner = await connected(client, db)
    await customer(db)
    event = text_event("972501112233", "שלום", id="wamid.same")
    await post(client, event)
    await post(client, event)
    assert await count(db, models.WhatsAppMessage) == 1
    assert len(await leads_of(client, owner["token"])) == 1


async def test_open_lead_reuse_then_new_after_close(client, db):
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי"))
    await post(client, text_event("972501112233", "עוד שאלה"))
    leads = await leads_of(client, owner["token"])
    assert len(leads) == 1
    notes = (
        (await db.execute(select(models.Notification).order_by(models.Notification.created_at)))
        .scalars()
        .all()
    )
    assert [n.type for n in notes] == ["lead.new", "whatsapp.message"]
    assert notes[1].data["leadId"] == leads[0]["id"] and notes[1].data["preview"] == "עוד שאלה"

    won = (
        (
            await db.execute(
                select(models.PipelineStage).where(
                    models.PipelineStage.business_id == uuid.UUID(BUSINESS_ID),
                    models.PipelineStage.kind == models.StageKind.WON,
                )
            )
        )
        .scalars()
        .first()
    )
    await req(
        client,
        "PATCH",
        business_url(BUSINESS_ID, f"/leads/{leads[0]['id']}"),
        owner["token"],
        {"stageId": str(won.id)},
    )
    await post(client, text_event("972501112233", "רוצה לקבוע שוב"))
    assert len(await leads_of(client, owner["token"])) == 2
    thread = (await req(client, "GET", thread_url(BUSINESS_ID, leads[0]["id"]), owner["token"])).json()
    assert len(thread["messages"]) == 3


async def test_reuses_existing_contact_by_phone(client, db):
    owner = await connected(client, db)
    await req(
        client,
        "POST",
        business_url(BUSINESS_ID, "/leads"),
        owner["token"],
        {"name": "מיכל לוי", "phone": "050-1112233"},
    )
    manual = (await leads_of(client, owner["token"]))[0]
    lost = (
        (
            await db.execute(
                select(models.PipelineStage).where(
                    models.PipelineStage.business_id == uuid.UUID(BUSINESS_ID),
                    models.PipelineStage.kind == models.StageKind.LOST,
                )
            )
        )
        .scalars()
        .first()
    )
    await req(
        client,
        "PATCH",
        business_url(BUSINESS_ID, f"/leads/{manual['id']}"),
        owner["token"],
        {"stageId": str(lost.id)},
    )
    await post(client, text_event("972501112233", "היי", name="Michal"))
    leads = await leads_of(client, owner["token"])
    assert len(leads) == 2
    assert leads[0]["contact"]["id"] == manual["contact"]["id"] and leads[0]["contact"]["name"] == "מיכל לוי"
    assert await count(db, models.Contact) == 1


async def test_reply_in_window_and_delivery_tracking(client, db, wa):
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי"))
    (lead,) = await leads_of(client, owner["token"])
    res = await req(
        client,
        "POST",
        thread_url(BUSINESS_ID, lead["id"]),
        owner["token"],
        {"text": "היי דנה! יש מקום ביום שלישי ב-10:00"},
    )
    assert res.status_code == 201, res.text
    assert [(m.to, m.text) for m in wa.sent] == [("+972501112233", "היי דנה! יש מקום ביום שלישי ב-10:00")]
    sent_id = wa.sent[0].id
    msg = res.json()["message"]
    assert msg["direction"] == "OUT" and msg["status"] == "sent" and msg["sender"]["id"] == owner["user_id"]

    await post(client, status_event(sent_id, "read"))
    await post(client, status_event(sent_id, "delivered"))  # a late receipt must not move it back
    thread = (await req(client, "GET", thread_url(BUSINESS_ID, lead["id"]), owner["token"])).json()
    assert [m["status"] for m in thread["messages"]] == ["received", "read"]
    last = (await leads_of(client, owner["token"]))[0]["lastWhatsApp"]
    assert last["direction"] == "OUT" and last["body"] == "היי דנה! יש מקום ביום שלישי ב-10:00"


async def test_window_closed(client, db, wa):
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי", at=datetime.now(UTC) - timedelta(hours=25)))
    (lead,) = await leads_of(client, owner["token"])
    thread = (await req(client, "GET", thread_url(BUSINESS_ID, lead["id"]), owner["token"])).json()
    assert thread["replyUntil"] is None
    res = await req(client, "POST", thread_url(BUSINESS_ID, lead["id"]), owner["token"], {"text": "היי"})
    assert res.status_code == 409 and res.json()["error"]["message"] == WM["windowClosed"]
    assert wa.sent == []


async def test_failed_send_not_stored_or_leaked(client, db, wa):
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי"))
    (lead,) = await leads_of(client, owner["token"])
    wa.fail_with = WhatsAppSendError(400, 131047)
    res = await req(client, "POST", thread_url(BUSINESS_ID, lead["id"]), owner["token"], {"text": "היי"})
    assert res.status_code == 500
    assert res.json()["error"]["message"] == WM["sendFailed"]
    assert "131047" not in res.text
    assert (
        await count(
            db, models.WhatsAppMessage, models.WhatsAppMessage.direction == models.WhatsAppDirection.OUT
        )
        == 0
    )


async def test_validates_reply_text(client, db):
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי"))
    (lead,) = await leads_of(client, owner["token"])
    res = await req(client, "POST", thread_url(BUSINESS_ID, lead["id"]), owner["token"], {"text": "  "})
    assert res.status_code == 400
    assert res.json()["error"]["fields"]["text"] == WM["textRequired"]


async def test_ignores_other_phone_number(client, db):
    await connected(client, db)
    await post(client, text_event("972501112233", "היי", phone_id="999"))
    assert await count(db, models.WhatsAppMessage) == 0


async def test_employees_see_only_assigned_conversations(client, db):
    owner = await connected(client, db)
    await customer(db)
    emp_token, emp_id = await new_user(client, "wa-emp")
    await add_member(db, BUSINESS_ID, emp_id, "EMPLOYEE")
    await post(client, text_event("972501112233", "היי"))
    (lead,) = await leads_of(client, owner["token"])
    url = thread_url(BUSINESS_ID, lead["id"])
    assert (await req(client, "GET", url, emp_token)).status_code == 404
    assert (await req(client, "POST", url, emp_token, {"text": "היי"})).status_code == 404
    await req(
        client,
        "PATCH",
        business_url(BUSINESS_ID, f"/leads/{lead['id']}"),
        owner["token"],
        {"ownerId": emp_id},
    )
    assert (await req(client, "GET", url, emp_token)).status_code == 200
    assert (await req(client, "POST", url, emp_token, {"text": "היי"})).status_code == 201


# -- one business number (D-176) --------------------------------------------------------------------


async def inbox_of(client, token):
    return (await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/inbox"), token)).json()


async def test_new_number_is_customer_right_away(client, db):
    owner = await connected(client, db)
    await post(client, text_event("972541234567", "היי, יש תור מחר?", name="נועה"))
    await post(client, text_event("972541234567", "בבוקר אם אפשר", name="נועה"))
    leads = await leads_of(client, owner["token"])
    assert len(leads) == 1
    assert leads[0]["source"] == "whatsapp" and leads[0]["contact"]["name"] == "נועה"
    thread = (await req(client, "GET", thread_url(BUSINESS_ID, leads[0]["id"]), owner["token"])).json()
    assert len(thread["messages"]) == 2
    assert (await inbox_of(client, owner["token"]))["numbers"] == []


async def test_waiting_number_joins_lead_with_next_message(client, db):
    owner = await connected(client, db)
    waiting = await customer(db, "+972541234567", "UNCLASSIFIED")
    db.add(
        models.WhatsAppMessage(
            id=uuid.uuid4(),
            business_id=uuid.UUID(BUSINESS_ID),
            number_id=waiting.id,
            direction=models.WhatsAppDirection.IN,
            wa_message_id="wamid.waiting",
            body="הודעה ישנה",
            status="received",
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    await post(client, text_event("972541234567", "עכשיו אני רוצה תור"))
    leads = await leads_of(client, owner["token"])
    assert len(leads) == 1
    assert (
        await count(db, models.WhatsAppMessage, models.WhatsAppMessage.lead_id == uuid.UUID(leads[0]["id"]))
        == 2
    )
    assert (await inbox_of(client, owner["token"]))["numbers"] == []


async def test_personal_number_ignored_and_can_be_forgotten(client, db):
    owner = await connected(client, db)
    number = await customer(db, "+972541234567", "PERSONAL")
    await post(client, text_event("972541234567", "מתי אתה בא לארוחה?"))
    assert await count(db, models.WhatsAppMessage) == 0
    assert await leads_of(client, owner["token"]) == []
    personal = (
        await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/personal"), owner["token"])
    ).json()
    assert [n["id"] for n in personal["numbers"]] == [str(number.id)]
    gone = await req(
        client, "DELETE", business_url(BUSINESS_ID, f"/whatsapp/numbers/{number.id}"), owner["token"]
    )
    assert gone.status_code == 204
    await post(client, text_event("972541234567", "עכשיו אני רוצה תור"))
    assert len(await leads_of(client, owner["token"])) == 1


async def test_customer_not_personal_and_only_personal_forgotten(client, db):
    owner = await connected(client, db)
    number = await customer(db)
    res = await req(
        client,
        "POST",
        business_url(BUSINESS_ID, f"/whatsapp/numbers/{number.id}/classify"),
        owner["token"],
        {"as": "PERSONAL"},
    )
    assert res.status_code == 409 and res.json()["error"]["message"] == WM["alreadyCustomer"]
    gone = await req(
        client, "DELETE", business_url(BUSINESS_ID, f"/whatsapp/numbers/{number.id}"), owner["token"]
    )
    assert gone.status_code == 409 and gone.json()["error"]["message"] == WM["notPersonal"]


async def test_classify_waiting_number(client, db):
    owner = await connected(client, db)
    waiting = await customer(db, "+972541234567", "UNCLASSIFIED")
    db.add(
        models.WhatsAppMessage(
            id=uuid.uuid4(),
            business_id=uuid.UUID(BUSINESS_ID),
            number_id=waiting.id,
            direction=models.WhatsAppDirection.IN,
            wa_message_id="wamid.w2",
            body="שלום",
            status="received",
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    inbox = await inbox_of(client, owner["token"])
    assert [n["id"] for n in inbox["numbers"]] == [str(waiting.id)]
    res = await req(
        client,
        "POST",
        business_url(BUSINESS_ID, f"/whatsapp/numbers/{waiting.id}/classify"),
        owner["token"],
        {"as": "BUSINESS"},
    )
    assert res.status_code == 200 and res.json()["status"] == "BUSINESS" and res.json()["leadId"]
    assert (await inbox_of(client, owner["token"]))["numbers"] == []


async def test_deleting_lead_forgets_number_and_messages(client, db):
    owner = await connected(client, db)
    await customer(db)
    await post(client, text_event("972501112233", "היי"))
    (lead,) = await leads_of(client, owner["token"])
    await req(client, "DELETE", business_url(BUSINESS_ID, f"/leads/{lead['id']}"), owner["token"])
    assert await count(db, models.WhatsAppNumber) == 0
    assert await count(db, models.WhatsAppMessage) == 0


async def test_numbers_endpoints_permissions(client, db):
    await connected(client, db)
    mgr_token, mgr_id = await new_user(client, "wa-mgr")
    emp_token, emp_id = await new_user(client, "wa-emp2")
    await add_member(db, BUSINESS_ID, mgr_id, "MANAGER")
    await add_member(db, BUSINESS_ID, emp_id, "EMPLOYEE")
    number = await customer(db, "+972541234567", "UNCLASSIFIED")
    classify = business_url(BUSINESS_ID, f"/whatsapp/numbers/{number.id}/classify")
    assert (
        await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/inbox"), emp_token)
    ).status_code == 403
    assert (await req(client, "POST", classify, emp_token, {"as": "BUSINESS"})).status_code == 403
    assert (
        await req(client, "GET", business_url(BUSINESS_ID, "/whatsapp/inbox"), mgr_token)
    ).status_code == 200
    other = await owner_with_business(client, "wa-other")
    foreign = await req(
        client,
        "POST",
        business_url(other["business"]["id"], f"/whatsapp/numbers/{number.id}/classify"),
        other["token"],
        {"as": "PERSONAL"},
    )
    assert foreign.status_code == 404


async def test_business_without_whatsapp_is_not_connected(client, db):
    await connected(client, db)
    other = await owner_with_business(client, "other")
    bid = other["business"]["id"]
    lead = (
        await req(
            client,
            "POST",
            business_url(bid, "/leads"),
            other["token"],
            {"name": "רון", "phone": "052-1112233"},
        )
    ).json()["lead"]
    thread = (await req(client, "GET", thread_url(bid, lead["id"]), other["token"])).json()
    assert thread["connected"] is False and thread["messages"] == [] and thread["replyUntil"] is None
    res = await req(client, "POST", thread_url(bid, lead["id"]), other["token"], {"text": "היי"})
    assert res.status_code == 409 and res.json()["error"]["message"] == WM["notConnected"]


# -- not configured, config rules, and the Cloud API adapter ------------------------------------------


@pytest.mark.parametrize("unconfigured", [True])
async def test_webhook_not_configured(unconfigured):
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app(make_settings())
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            assert (await c.post(WEBHOOK, json={})).status_code == 404
            assert (
                await c.get(f"{WEBHOOK}?hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=1")
            ).status_code == 403
    finally:
        await app.state.engine.dispose()


def test_config_requires_secrets_once_connected():
    with pytest.raises(ValidationError, match="WHATSAPP_APP_SECRET"):
        make_settings(WHATSAPP_BUSINESS_ID=BUSINESS_ID)
    with pytest.raises(ValidationError, match="WHATSAPP_PHONE_NUMBER_ID"):
        make_settings(
            WHATSAPP_BUSINESS_ID=BUSINESS_ID,
            WHATSAPP_APP_SECRET=SECRET,
            WHATSAPP_VERIFY_TOKEN=VERIFY,
            WHATSAPP_PROVIDER="cloud",
        )


async def test_cloud_sender_sends_text():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"messages": [{"id": "wamid.abc"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        sender = CloudWhatsAppSender(PHONE_ID, "tok", "v21.0", http)
        assert await sender.send_text("+972501112233", "היי") == {"id": "wamid.abc"}
    assert str(calls[0].url) == f"https://graph.facebook.com/v21.0/{PHONE_ID}/messages"
    assert calls[0].headers["authorization"] == "Bearer tok"
    body = json.loads(calls[0].content)
    assert body["messaging_product"] == "whatsapp" and body["to"] == "972501112233"
    assert body["type"] == "text" and body["text"]["body"] == "היי"


async def test_cloud_sender_error_carries_only_the_code():
    def handler(request):
        return httpx.Response(
            400, json={"error": {"code": 131047, "message": "Re-engagement message for +972…"}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        sender = CloudWhatsAppSender(PHONE_ID, "tok", "v21.0", http)
        with pytest.raises(WhatsAppSendError) as err:
            await sender.send_text("+972501112233", "היי")
    assert err.value.status == 400 and err.value.code == 131047
    assert "972" not in str(err.value)
