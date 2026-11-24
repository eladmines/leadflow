"""Email conversations (F27) and Gmail conversations (F29), ported from email.test.ts and
gmail.test.ts."""

import base64
import json
import re
import time
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, quote, urlsplit

import pytest
from sqlalchemy import func, select, update

from app.db import models
from app.integrations.gmail import GmailMessage, MemoryGmailApi, to_message
from app.integrations.whatsapp import sign_webhook_body
from app.modules.whatsapp.service import build_service
from tests.conftest import add_member, business_url, make_settings, new_user, owner_with_business, req

BUSINESS_ID = "22222222-3333-4444-8555-666666666666"
DOMAIN = "mail.simplecatch.test"
SECRET = "inbound-secret-0123456789"
INBOUND = "/api/v1/integrations/email/inbound"
SIGNATURE = "x-leadflow-signature"
GMAIL_CALLBACK = "/api/v1/integrations/gmail/callback"
_seq = 0


@pytest.fixture
def settings():
    return make_settings(
        EMAIL_INBOUND_DOMAIN=DOMAIN,
        EMAIL_INBOUND_SECRET=SECRET,
        EMAIL_TRANSPORT="memory",
        GOOGLE_CLIENT_ID="google-client-id-0123",
        GOOGLE_CLIENT_SECRET="google-client-secret-0123",
    )


def mail(to, **over):
    global _seq
    _seq += 1
    return {
        "to": to,
        "from": "dana@example.com",
        "fromName": "דנה כהן",
        "subject": "תור ליום חמישי",
        "text": "היי, אפשר תור ליום חמישי?",
        "messageId": f"<msg-{_seq}-{time.time_ns()}@example.com>",
        **over,
    }


async def count(db, model, *where):
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def setup_mail(client, db):
    token, user_id = await new_user(client, "mail-owner")
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
    res = await req(client, "POST", business_url(BUSINESS_ID, "/channels/email"), token)
    return {"token": token, "user_id": user_id}, res.json()["email"]["name"]


async def post_mail(client, payload, signature=None):
    raw = json.dumps(payload).encode()
    return await client.post(
        INBOUND,
        content=raw,
        headers={"content-type": "application/json", SIGNATURE: signature or sign_webhook_body(raw, SECRET)},
    )


async def leads_of(client, token, bid=BUSINESS_ID):
    return (await req(client, "GET", business_url(bid, "/leads"), token)).json()["leads"]


async def conversations(client, token, bid=BUSINESS_ID):
    return (await req(client, "GET", business_url(bid, "/conversations"), token)).json()


async def test_forwarding_address_once_owner_only(client, db):
    owner, address = await setup_mail(client, db)
    assert re.fullmatch(rf"[a-z0-9]{{10}}@{re.escape(DOMAIN)}", address)
    again = await req(client, "POST", business_url(BUSINESS_ID, "/channels/email"), owner["token"])
    assert again.json()["email"]["connected"] is True and again.json()["email"]["name"] == address
    assert again.json()["emailInbound"] is True
    token, user_id = await new_user(client, "mail-emp")
    await add_member(db, BUSINESS_ID, user_id, "EMPLOYEE")
    assert (await req(client, "POST", business_url(BUSINESS_ID, "/channels/email"), token)).status_code == 403


async def test_email_becomes_lead_and_next_joins_it(client, db):
    owner, address = await setup_mail(client, db)
    assert (await post_mail(client, mail(address))).status_code == 200
    assert (await post_mail(client, mail(address, subject="Re: תור", text="ובשעה 10?"))).status_code == 200
    leads = await leads_of(client, owner["token"])
    assert len(leads) == 1
    assert leads[0]["source"] == "email"
    assert (
        leads[0]["contact"]["name"] == "דנה כהן"
        and leads[0]["contact"]["email"] == "dana@example.com"
        and leads[0]["contact"]["phone"] is None
    )
    lst = await conversations(client, owner["token"])
    assert len(lst["conversations"]) == 1
    c = lst["conversations"][0]
    assert (c["channel"], c["email"], c["name"], c["status"], c["leadId"], c["unread"]) == (
        "email",
        "dana@example.com",
        "דנה כהן",
        "BUSINESS",
        leads[0]["id"],
        True,
    )
    detail = (
        await req(client, "GET", business_url(BUSINESS_ID, f"/conversations/{c['id']}"), owner["token"])
    ).json()
    assert [m["body"] for m in detail["messages"]] == ["היי, אפשר תור ליום חמישי?", "ובשעה 10?"]
    assert (
        detail["messages"][0]["channel"] == "email" and detail["messages"][0]["subject"] == "תור ליום חמישי"
    )
    note = (
        (
            await db.execute(
                select(models.Notification).where(
                    models.Notification.user_id == uuid.UUID(owner["user_id"]),
                    models.Notification.type == "lead.new",
                )
            )
        )
        .scalars()
        .first()
    )
    assert note.data["source"] == "email"


async def test_cuts_quotes_and_ignores_auto_loops_repeats_unknown(client, db):
    owner, address = await setup_mail(client, db)
    quoted = mail(address, text="תודה רבה!\n\nב-10.11.2026 כתבה מספרת שירן:\n> מחר ב-10:00\n> מתאים?")
    await post_mail(client, quoted)
    await post_mail(client, quoted)
    await post_mail(client, mail(address, autoSubmitted=True))
    await post_mail(client, mail(address, **{"from": f"loop@{DOMAIN}"}))
    await post_mail(client, mail("nobody@" + DOMAIN))
    (convo,) = (await conversations(client, owner["token"]))["conversations"]
    detail = (
        await req(client, "GET", business_url(BUSINESS_ID, f"/conversations/{convo['id']}"), owner["token"])
    ).json()
    assert [m["body"] for m in detail["messages"]] == ["תודה רבה!"]
    assert await count(db, models.Lead) == 1


async def test_rejects_unsigned_email_webhook(client, db):
    _, address = await setup_mail(client, db)
    assert (await post_mail(client, mail(address), "sha256=00")).status_code == 401
    no_header = await client.post(
        INBOUND, content=json.dumps(mail(address)), headers={"content-type": "application/json"}
    )
    assert no_header.status_code == 401
    assert await count(db, models.WhatsAppMessage) == 0


async def test_reply_goes_out_from_forwarding_address_threaded(client, db, email):
    owner, address = await setup_mail(client, db)
    await post_mail(client, mail(address, messageId="<abc123@example.com>"))
    (convo,) = (await conversations(client, owner["token"]))["conversations"]
    await db.execute(
        update(models.WhatsAppMessage).values(created_at=datetime.now(UTC) - timedelta(hours=72))
    )
    await db.commit()
    url = business_url(BUSINESS_ID, f"/conversations/{convo['id']}/messages")
    sent = await req(client, "POST", url, owner["token"], {"text": "בטח! מחר ב-10:00 <b>מתאים?</b>"})
    assert sent.status_code == 201, sent.text
    to_dana = lambda: email.to("dana@example.com")  # noqa: E731
    assert len(to_dana()) == 1
    m = to_dana()[0]
    assert (m.to, m.from_, m.reply_to, m.in_reply_to, m.subject, m.text) == (
        "dana@example.com",
        f"מספרת שירן <{address}>",
        address,
        "<abc123@example.com>",
        "Re: תור ליום חמישי",
        "בטח! מחר ב-10:00 <b>מתאים?</b>",
    )
    assert "&lt;b&gt;" in m.html

    await post_mail(client, mail(address, subject="Re: תור ליום חמישי", text="מצוין"))
    await req(client, "POST", url, owner["token"], {"text": "נתראה"})
    assert to_dana()[1].subject == "Re: תור ליום חמישי"
    (lead,) = await leads_of(client, owner["token"])
    from_lead = await req(
        client,
        "POST",
        business_url(BUSINESS_ID, f"/leads/{lead['id']}/whatsapp"),
        owner["token"],
        {"text": "עוד דבר קטן"},
    )
    assert from_lead.status_code == 201
    assert len(to_dana()) == 3


async def test_reply_refused_when_server_sends_no_email(client, db, email, app):
    owner, address = await setup_mail(client, db)
    await post_mail(client, mail(address))
    (convo,) = (await conversations(client, owner["token"]))["conversations"]
    url = business_url(BUSINESS_ID, f"/conversations/{convo['id']}/messages")
    app.state.settings.EMAIL_TRANSPORT = "disabled"
    try:
        res = await req(client, "POST", url, owner["token"], {"text": "שלום"})
        assert res.status_code == 409 and "שליחת מייל עוד לא הוגדרה" in res.json()["error"]["message"]
    finally:
        app.state.settings.EMAIL_TRANSPORT = "memory"
    email.fail_with = Exception("provider exploded: key=secret")
    failed = await req(client, "POST", url, owner["token"], {"text": "שלום"})
    assert failed.status_code == 500
    assert not re.search(r"exploded|secret", json.dumps(failed.json()))


# -- Gmail (F29) ----------------------------------------------------------------------------------------


def gmail_mail(**over):
    global _seq
    _seq += 1
    base = dict(
        id=f"g{_seq}",
        thread_id=f"t{_seq}",
        message_id=f"msg-{_seq}@example.com",
        from_="dana@example.com",
        from_name="דנה כהן",
        subject="תור ליום חמישי",
        text="היי, אפשר תור ליום חמישי?",
        received_at=int(time.time() * 1000) + _seq * 1000,
        skip=False,
    )
    return GmailMessage(**{**base, **over})


@pytest.fixture
def gmail(app):
    app.state.gmail_api = MemoryGmailApi()
    return app.state.gmail_api


@pytest.fixture
def sync(app, db, gmail):
    return build_service(app.state, db).sync_gmail


async def connect(client, label):
    o = await owner_with_business(client, label)
    start = (
        await req(client, "GET", business_url(o["business"]["id"], "/channels/gmail/start"), o["token"])
    ).json()
    state = parse_qs(urlsplit(start["url"]).query)["state"][0]
    back = await client.get(f"{GMAIL_CALLBACK}?code=good-code&state={quote(state)}")
    return o, back


async def test_gmail_connects_sealed_and_imports_nothing_old(client, db, gmail, sync):
    o = await owner_with_business(client, "gm-owner")
    bid = o["business"]["id"]
    before = (await req(client, "GET", business_url(bid, "/channels"), o["token"])).json()
    assert before["gmail"]["connected"] is False and before["gmailLogin"] is True
    gmail.inbox.append(gmail_mail(received_at=int(time.time() * 1000) - 60_000))
    start = (await req(client, "GET", business_url(bid, "/channels/gmail/start"), o["token"])).json()
    state = parse_qs(urlsplit(start["url"]).query)["state"][0]
    back = await client.get(f"{GMAIL_CALLBACK}?code=good-code&state={quote(state)}")
    assert back.status_code == 302
    loc = urlsplit(back.headers["location"])
    assert loc.path == f"/b/{bid}/settings" and parse_qs(loc.query)["gmail"] == ["connected"]
    after = (await req(client, "GET", business_url(bid, "/channels"), o["token"])).json()
    assert after["gmail"] == {
        "channel": "email",
        "connected": True,
        "name": "owner@gmail.com",
        "source": "business",
    }
    row = (
        await db.execute(select(models.ChannelConnection).where(models.ChannelConnection.channel == "gmail"))
    ).scalar_one()
    assert "refresh-token" not in row.token_encrypted
    assert "refresh-token" not in json.dumps(after)
    assert await sync() == 0
    assert await count(db, models.WhatsAppMessage) == 0


async def test_gmail_forged_failed_and_taken(client, db, gmail):
    o = await owner_with_business(client, "gm-forged")
    bid = o["business"]["id"]
    forged = await client.get(f"{GMAIL_CALLBACK}?code=good-code&state=eyJiIjoieCJ9.bad")
    assert urlsplit(forged.headers["location"]).path == "/app"
    start = (await req(client, "GET", business_url(bid, "/channels/gmail/start"), o["token"])).json()
    state = parse_qs(urlsplit(start["url"]).query)["state"][0]
    failed = await client.get(f"{GMAIL_CALLBACK}?code=bad-code&state={quote(state)}")
    assert parse_qs(urlsplit(failed.headers["location"]).query)["gmail"] == ["error"]
    assert await count(db, models.ChannelConnection) == 0

    await connect(client, "gm-first")
    second = await owner_with_business(client, "gm-second")
    s2 = (
        await req(
            client, "GET", business_url(second["business"]["id"], "/channels/gmail/start"), second["token"]
        )
    ).json()
    taken = await client.get(
        f"{GMAIL_CALLBACK}?code=good-code&state={quote(parse_qs(urlsplit(s2['url']).query)['state'][0])}"
    )
    assert parse_qs(urlsplit(taken.headers["location"]).query)["gmail"] == ["taken"]


async def test_gmail_only_owner_connects(client):
    o = await owner_with_business(client, "gm-perm")
    token, _ = await new_user(client, "gm-stranger")
    assert (
        await req(client, "GET", business_url(o["business"]["id"], "/channels/gmail/start"), token)
    ).status_code == 404


async def test_new_mail_waits_classification_skips_bulk_and_own(client, db, gmail, sync):
    o, _ = await connect(client, "gm-sync")
    t = int(time.time() * 1000)
    gmail.inbox.extend(
        [
            gmail_mail(received_at=t + 1000),
            gmail_mail(received_at=t + 2000, from_="news@shop.com", skip=True),
            gmail_mail(received_at=t + 3000, from_="owner@gmail.com"),
        ]
    )
    assert await sync() == 1
    assert await sync() == 0
    inbox = (
        await req(client, "GET", business_url(o["business"]["id"], "/whatsapp/inbox"), o["token"])
    ).json()
    assert len(inbox["numbers"]) == 1
    n = inbox["numbers"][0]
    assert n["channel"] == "email" and n["profileName"] == "דנה כהן"
    assert (
        n["messages"][0]["body"] == "היי, אפשר תור ליום חמישי?"
        and n["messages"][0]["subject"] == "תור ליום חמישי"
    )
    assert await count(db, models.Lead) == 0
    assert await count(db, models.Notification, models.Notification.type == "whatsapp.new_number") > 0


async def test_business_classification_lead_and_gmail_reply(client, db, gmail, sync, email):
    o, _ = await connect(client, "gm-lead")
    bid = o["business"]["id"]
    gmail.inbox.append(gmail_mail(received_at=int(time.time() * 1000) + 1000))
    await sync()
    number = (await db.execute(select(models.WhatsAppNumber))).scalars().one()
    res = await req(
        client,
        "POST",
        business_url(bid, f"/whatsapp/numbers/{number.id}/classify"),
        o["token"],
        {"as": "BUSINESS"},
    )
    assert res.status_code == 200
    lead = (await db.execute(select(models.Lead))).scalars().one()
    assert lead.source == models.LeadSource.EMAIL

    gmail.inbox.append(gmail_mail(received_at=int(time.time() * 1000) + 5000, text="ועוד שאלה"))
    await sync()
    assert await count(db, models.Lead) == 1
    assert await count(db, models.WhatsAppMessage, models.WhatsAppMessage.lead_id == lead.id) == 2

    reply = await req(
        client,
        "POST",
        business_url(bid, f"/leads/{lead.id}/whatsapp"),
        o["token"],
        {"text": "בטח, ביום חמישי ב־10:00"},
    )
    assert reply.status_code == 201, reply.text
    assert len(gmail.sent) == 1
    out, _ = gmail.sent[0]
    assert (out.from_, out.to, out.subject, out.text) == (
        "owner@gmail.com",
        "dana@example.com",
        "Re: תור ליום חמישי",
        "בטח, ביום חמישי ב־10:00",
    )
    assert re.fullmatch(r"msg-\d+@example\.com", out.in_reply_to)
    assert email.to("dana@example.com") == []


async def test_gmail_personal_sender_ignored(client, db, gmail, sync):
    o, _ = await connect(client, "gm-personal")
    gmail.inbox.append(gmail_mail(received_at=int(time.time() * 1000) + 1000))
    await sync()
    number = (await db.execute(select(models.WhatsAppNumber))).scalars().one()
    await req(
        client,
        "POST",
        business_url(o["business"]["id"], f"/whatsapp/numbers/{number.id}/classify"),
        o["token"],
        {"as": "PERSONAL"},
    )
    gmail.inbox.append(gmail_mail(received_at=int(time.time() * 1000) + 9000, text="עוד אחת"))
    await sync()
    assert await count(db, models.WhatsAppMessage) == 0
    assert await count(db, models.Lead) == 0


async def test_revoked_grant_skipped_and_disconnect_revokes(client, db, gmail, sync):
    o, _ = await connect(client, "gm-revoked")
    gmail.inbox.append(gmail_mail(received_at=int(time.time() * 1000) + 1000))
    gmail.reject_token = True
    assert await sync() == 0
    gmail.reject_token = False
    assert await sync() == 1
    off = await req(client, "DELETE", business_url(o["business"]["id"], "/channels/gmail"), o["token"])
    assert off.json()["gmail"]["connected"] is False
    assert gmail.revoked == ["refresh-token"]
    assert await count(db, models.ChannelConnection) == 0


def _b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def raw_mail(headers, **over):
    return {
        "id": "x1",
        "threadId": "t1",
        "internalDate": "1700000000000",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [{"name": k, "value": v} for k, v in headers.items()],
            "parts": [
                {"mimeType": "text/plain", "body": {"data": _b64("שלום עולם")}},
                {"mimeType": "text/html", "body": {"data": _b64("<p>שלום</p>")}},
            ],
        },
        **over,
    }


def test_gmail_message_parsing():
    m = to_message(
        raw_mail({"From": '"Dana Cohen" <Dana@Example.com>', "Subject": "היי", "Message-ID": "<a@b>"})
    )
    assert (m.from_, m.from_name, m.subject, m.text, m.message_id, m.received_at, m.skip) == (
        "dana@example.com",
        "Dana Cohen",
        "היי",
        "שלום עולם",
        "a@b",
        1700000000000,
        False,
    )


def test_gmail_skips_bulk_auto_and_promotions():
    assert to_message(raw_mail({"From": "a@b.com", "List-Unsubscribe": "<x>"})).skip is True
    assert to_message(raw_mail({"From": "a@b.com", "Precedence": "bulk"})).skip is True
    assert to_message(raw_mail({"From": "a@b.com", "Auto-Submitted": "auto-replied"})).skip is True
    assert to_message(raw_mail({"From": "No-Reply <noreply@b.com>"})).skip is True
    assert to_message(raw_mail({"From": "a@b.com"}, labelIds=["CATEGORY_PROMOTIONS"])).skip is True
    assert to_message(raw_mail({"From": "a@b.com", "Auto-Submitted": "no"})).skip is False
