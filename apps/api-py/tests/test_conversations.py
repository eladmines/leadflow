"""Unified inbox (F24), ported from conversations.test.ts."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.db import models
from app.integrations.whatsapp import sign_webhook_body
from app.modules.conversations.service import CONVERSATIONS_PAGE
from tests.conftest import add_member, business_url, make_settings, new_user, req

BUSINESS_ID = "33333333-4444-4555-8666-777777777777"
SECRET = "test-app-secret-0123456789"
PHONE_ID = "1234567890"
PAGE_ID = "1122334455"
WA_HOOK = "/api/v1/integrations/whatsapp/webhook"
FB_HOOK = "/api/v1/integrations/messenger/webhook"
_seq = 0


def whatsapp_text(body, sender="972501112233", name="נועה", later=0):
    global _seq
    _seq += 1
    return WA_HOOK, {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {"phone_number_id": PHONE_ID},
                            "contacts": [{"wa_id": sender, "profile": {"name": name}}],
                            "messages": [
                                {
                                    "from": sender,
                                    "id": f"wamid.inbox-{_seq}-{time.time_ns()}",
                                    "timestamp": str(int(time.time()) + later),
                                    "type": "text",
                                    "text": {"body": body},
                                }
                            ],
                        },
                    }
                ]
            }
        ],
    }


def facebook_text(text, psid="7766554433"):
    global _seq
    _seq += 1
    return FB_HOOK, {
        "object": "page",
        "entry": [
            {
                "id": PAGE_ID,
                "messaging": [
                    {
                        "sender": {"id": psid},
                        "recipient": {"id": PAGE_ID},
                        "timestamp": int(time.time() * 1000),
                        "message": {"mid": f"m_inbox-{_seq}-{time.time_ns()}", "text": text},
                    }
                ],
            }
        ],
    }


@pytest.fixture
def settings():
    return make_settings(
        WHATSAPP_BUSINESS_ID=BUSINESS_ID,
        WHATSAPP_PHONE_NUMBER_ID=PHONE_ID,
        MESSENGER_BUSINESS_ID=BUSINESS_ID,
        MESSENGER_PAGE_ID=PAGE_ID,
        WHATSAPP_APP_SECRET=SECRET,
        WHATSAPP_VERIFY_TOKEN="verify-me-please",
    )


async def setup(client, db):
    token, user_id = await new_user(client, "inbox-owner")
    db.add(
        models.Business(
            id=uuid.UUID(BUSINESS_ID),
            name="מספרת שירן",
            industry="beauty",
            status=models.BusinessStatus.ACTIVE,
            updated_at=datetime.now(UTC),
            whatsapp_reply_mode="off",
        )
    )
    await db.commit()
    await add_member(db, BUSINESS_ID, user_id, "OWNER")
    return {"token": token, "user_id": user_id}


async def post(client, event):
    url, payload = event
    raw = json.dumps(payload).encode()
    res = await client.post(
        url,
        content=raw,
        headers={"content-type": "application/json", "x-hub-signature-256": sign_webhook_body(raw, SECRET)},
    )
    assert res.status_code == 200


def cp(tail=""):
    return business_url(BUSINESS_ID, f"/conversations{tail}")


async def list_(client, token, query=""):
    return (await req(client, "GET", f"{cp()}{query}", token)).json()


async def test_lists_both_channels_newest_first_with_filters(client, db, app):
    owner = await setup(client, db)
    app.state.messenger_sender.names["7766554433"] = "יוסי לוי"
    await post(client, whatsapp_text("היי, יש תור?"))
    await post(client, facebook_text("כמה עולה צבע?"))
    now = datetime.now(UTC)
    db.add(
        models.WhatsAppNumber(
            id=uuid.uuid4(),
            business_id=uuid.UUID(BUSINESS_ID),
            channel="whatsapp",
            phone="+972509998877",
            status=models.WhatsAppNumberStatus.PERSONAL,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await post(client, whatsapp_text("מה נשמע", "972509998877", "אמא"))

    all_ = await list_(client, owner["token"])
    assert all_["connected"] is True and all_["unreadCount"] == 2
    assert [(c["name"], c["channel"]) for c in all_["conversations"]] == [
        ("יוסי לוי", "messenger"),
        ("נועה", "whatsapp"),
    ]
    first = all_["conversations"][0]
    assert (
        first["status"] == "BUSINESS"
        and first["phone"] is None
        and first["unread"] is True
        and first["leadId"]
    )
    assert first["lastMessage"]["body"] == "כמה עולה צבע?" and first["lastMessage"]["direction"] == "IN"
    assert all_["conversations"][1]["phone"] == "+972501112233"

    assert len((await list_(client, owner["token"], "?channel=whatsapp"))["conversations"]) == 1
    assert (await list_(client, owner["token"], "?filter=new"))["conversations"] == []
    wa_id = all_["conversations"][1]["id"]
    assert (await req(client, "POST", cp(f"/{wa_id}/read"), owner["token"])).status_code == 204
    unread = await list_(client, owner["token"], "?filter=unread")
    assert wa_id not in [c["id"] for c in unread["conversations"]] and unread["unreadCount"] == 1
    assert (await req(client, "GET", cp("/unread"), owner["token"])).json()["unreadCount"] == 1

    await post(client, whatsapp_text("עוד שאלה", later=5))
    after = await list_(client, owner["token"])
    assert after["conversations"][0]["id"] == wa_id and after["conversations"][0]["unread"] is True


async def test_open_conversation_and_reply_makes_customer(client, db, app):
    owner = await setup(client, db)
    await post(client, facebook_text("היי, אפשר לקבוע?"))
    (convo,) = (await list_(client, owner["token"]))["conversations"]
    detail = (await req(client, "GET", cp(f"/{convo['id']}"), owner["token"])).json()
    assert [m["body"] for m in detail["messages"]] == ["היי, אפשר לקבוע?"]
    assert detail["replyUntil"] is not None

    sent = await req(
        client, "POST", cp(f"/{convo['id']}/messages"), owner["token"], {"text": "בטח! מחר ב-10:00?"}
    )
    assert sent.status_code == 201, sent.text
    assert [(m.to, m.text) for m in app.state.messenger_sender.sent] == [("7766554433", "בטח! מחר ב-10:00?")]
    lead = (await db.execute(select(models.Lead))).scalars().one()
    assert lead.source == models.LeadSource.FACEBOOK
    again = (await req(client, "GET", cp(f"/{convo['id']}"), owner["token"])).json()
    assert again["conversation"]["status"] == "BUSINESS" and again["conversation"]["leadId"] == str(lead.id)
    assert again["conversation"]["unread"] is False
    assert [m["direction"] for m in again["messages"]] == ["IN", "OUT"]


async def test_whatsapp_reply_window(client, db, app):
    owner = await setup(client, db)
    await post(client, whatsapp_text("היי"))
    (convo,) = (await list_(client, owner["token"]))["conversations"]
    ok = await req(client, "POST", cp(f"/{convo['id']}/messages"), owner["token"], {"text": "שלום!"})
    assert ok.status_code == 201
    last = app.state.whatsapp_sender.sent[-1]
    assert (last.to, last.text) == ("+972501112233", "שלום!")
    await db.execute(
        update(models.WhatsAppMessage)
        .where(models.WhatsAppMessage.direction == models.WhatsAppDirection.IN)
        .values(created_at=datetime.now(UTC) - timedelta(hours=25))
    )
    await db.commit()
    late = await req(
        client, "POST", cp(f"/{convo['id']}/messages"), owner["token"], {"text": "עדיין רלוונטי?"}
    )
    assert late.status_code == 409


async def test_pages_through_long_inboxes(client, db):
    owner = await setup(client, db)
    for i in range(CONVERSATIONS_PAGE + 2):
        await post(client, whatsapp_text(f"הודעה {i}", f"9725010000{i:02d}", f"לקוח {i}"))
    first = await list_(client, owner["token"])
    assert len(first["conversations"]) == CONVERSATIONS_PAGE and first["nextCursor"]
    second = await list_(client, owner["token"], f"?cursor={first['nextCursor']}")
    assert len(second["conversations"]) == 2 and second["nextCursor"] is None
    ids = {c["id"] for c in first["conversations"] + second["conversations"]}
    assert len(ids) == CONVERSATIONS_PAGE + 2


async def test_permissions_and_unknown_ids(client, db):
    owner = await setup(client, db)
    token, user_id = await new_user(client, "inbox-emp")
    await add_member(db, BUSINESS_ID, user_id, "EMPLOYEE")
    assert (await req(client, "GET", cp(), token)).status_code == 403
    missing = await req(client, "GET", cp("/00000000-0000-4000-8000-000000000000"), owner["token"])
    assert missing.status_code == 404
