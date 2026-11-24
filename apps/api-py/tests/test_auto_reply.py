"""Automatic replies, statuses and "when can we talk?" (D-123, D-165, D-166), ported from
auto-reply.test.ts."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select, update

from app.db import models
from app.integrations.whatsapp import sign_webhook_body
from app.shared import whatsapp as sw
from tests.conftest import HEADERS, add_member, business_url, cookie, make_settings, new_user, req

BUSINESS_ID = "11111111-2222-4333-8444-555555555555"
BID = uuid.UUID(BUSINESS_ID)
SECRET = "test-app-secret-0123456789"
PHONE_ID = "1234567890"
FROM = "972501112233"
WEBHOOK = "/api/v1/integrations/whatsapp/webhook"
AUTO = sw.auto_reply_default_for("he")
AUTO_EN = sw.auto_reply_default_for("en")
_seq = 0


def message(m, sender=FROM, name="נועה"):
    global _seq
    _seq += 1
    return {
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
                                    "id": f"wamid.ar-{_seq}-{time.time_ns()}",
                                    "timestamp": str(int(time.time())),
                                    **m,
                                }
                            ],
                        },
                    }
                ]
            }
        ],
    }


def text(body, sender=FROM):
    return message({"type": "text", "text": {"body": body}}, sender)


def tap_row(id_):
    return message(
        {
            "type": "interactive",
            "interactive": {"type": "list_reply", "list_reply": {"id": id_, "title": id_}},
        }
    )


def mp4(size=2048):
    return b"\x00\x00\x00\x18ftypmp42" + b"\x00" * (size - 12)


@pytest.fixture
def settings():
    return make_settings(
        WHATSAPP_BUSINESS_ID=BUSINESS_ID,
        WHATSAPP_APP_SECRET=SECRET,
        WHATSAPP_VERIFY_TOKEN="verify-me-please",
        WHATSAPP_PHONE_NUMBER_ID=PHONE_ID,
    )


@pytest.fixture
def wa(app):
    return app.state.whatsapp_sender


@pytest.fixture
def post(client):
    async def go(payload):
        raw = json.dumps(payload).encode()
        res = await client.post(
            WEBHOOK,
            content=raw,
            headers={
                "content-type": "application/json",
                "x-hub-signature-256": sign_webhook_body(raw, SECRET),
            },
        )
        assert res.status_code == 200

    return go


@pytest.fixture
def setup(client, db):
    async def go():
        token, user_id = await new_user(client, "ar-owner")
        # A new business: no mode chosen, so the default (automatic reply) applies.
        db.add(
            models.Business(
                id=BID,
                name="די ג׳יי רון",
                industry="events",
                status=models.BusinessStatus.ACTIVE,
                updated_at=datetime.now(UTC),
            )
        )
        await db.commit()
        await add_member(db, BUSINESS_ID, user_id, "OWNER")
        return {"token": token, "user_id": user_id}

    return go


def bot_url():
    return business_url(BID, "/whatsapp/bot")


def status_url():
    return business_url(BID, "/whatsapp/status")


def video_url():
    return business_url(BID, "/whatsapp/showcase/video")


@pytest.fixture
def settings_of(client):
    async def go(token):
        return (await req(client, "GET", bot_url(), token)).json()["settings"]

    return go


@pytest.fixture
def save(client, settings_of):
    async def go(token, **patch):
        s = await settings_of(token)
        body = {
            "mode": s["mode"],
            "autoReplyText": s["autoReplyText"],
            "enabled": s["enabled"],
            "autoConfirm": s["autoConfirm"],
            "holdDate": s["holdDate"],
            "texts": s["texts"],
            "showcase": {**s["showcase"], "text": s["showcase"].get("text")},
            **patch,
        }
        return await req(client, "PUT", bot_url(), token, body)

    return go


async def upload_video(client, token, body, url=None):
    return await client.put(
        url or video_url(), headers={**HEADERS, **cookie(token)}, files={"file": ("v.mp4", body, "video/mp4")}
    )


async def count(db, model, *where):
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_default_general_reply_and_team_told(setup, post, wa, db, settings_of):
    owner = await setup()
    s = await settings_of(owner["token"])
    assert s["mode"] == "auto_reply"
    assert [x["id"] for x in s["statuses"]] == ["event", "meeting", "vacation", "closed"]
    assert s["activeStatus"] is None
    await post(text("היי, אתה פנוי ב-14.2?"))
    assert len(wa.sent) == 1
    assert wa.sent[0].text == AUTO.replace("{business}", "די ג׳יי רון")
    assert (
        await count(
            db, models.WhatsAppMessage, models.WhatsAppMessage.direction == models.WhatsAppDirection.OUT
        )
        == 1
    )
    assert await count(db, models.Notification) > 0
    await post(text("עוד שאלה"))  # every message gets the full message with the time choices (D-166)
    assert len(wa.sent) == 2
    assert wa.sent[1].text == AUTO.replace("{business}", "די ג׳יי רון")
    assert "cb:other" in [c.id for c in wa.sent[1].choices]


async def test_peek_no_longer_follows_auto_reply(setup, post, wa, db):
    await setup()
    await db.execute(
        update(models.Business)
        .where(models.Business.id == BID)
        .values(
            whatsapp_bot_showcase={
                "enabled": True,
                "text": "בינתיים, תציצו 👇",
                "link": "https://example.com/work",
                "assetIds": [],
            }
        )
    )
    await db.commit()
    await post(text("היי"))
    assert [m.text for m in wa.sent] == [AUTO.replace("{business}", "די ג׳יי רון")]


async def test_english_business_replies_in_english(setup, post, wa, db, settings_of):
    owner = await setup()
    await db.execute(update(models.Business).where(models.Business.id == BID).values(language="en"))
    await db.commit()
    s = await settings_of(owner["token"])
    assert s["autoReplyDefault"] == AUTO_EN
    assert [x["label"] for x in s["statuses"]] == ["At an event", "In a meeting", "On vacation", "Closed now"]
    assert s["defaults"]["greeting"].startswith("Hi! This is {business}")
    await post(text("Hi, are you free on 14/2?"))
    assert wa.sent[0].text == AUTO_EN.replace("{business}", "די ג׳יי רון")


async def test_status_message_until_it_ends(setup, post, wa, db, client, settings_of):
    owner = await setup()
    until = (datetime.now(UTC) + timedelta(hours=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    on = await req(client, "PUT", status_url(), owner["token"], {"id": "event", "until": until})
    assert on.json()["settings"]["activeStatus"] == {"id": "event", "until": until}
    await post(text("היי"))
    assert len(wa.sent) == 1 and wa.sent[0].text.startswith("היי! כרגע אני באירוע 🎉")
    past = (
        (datetime.now(UTC) - timedelta(seconds=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )
    await db.execute(
        update(models.Business)
        .where(models.Business.id == BID)
        .values(whatsapp_active_status={"id": "event", "until": past})
    )
    await db.commit()
    assert (await settings_of(owner["token"]))["activeStatus"] is None
    wa.clear()
    await post(text("היי", "972509998877"))
    assert len(wa.sent) == 1 and "תודה שכתבת" in wa.sent[0].text


async def test_quiet_when_off_team_talking_paused_or_personal(setup, post, wa, db, save):
    owner = await setup()
    await save(owner["token"], mode="off", enabled=False)
    await post(text("היי"))
    assert wa.sent == []
    await save(owner["token"], mode="auto_reply", enabled=False)
    await db.execute(update(models.WhatsAppNumber).values(status=models.WhatsAppNumberStatus.PERSONAL))
    await db.commit()
    await post(text("היי שוב"))
    assert wa.sent == []
    now = datetime.now(UTC)
    number = models.WhatsAppNumber(
        id=uuid.uuid4(),
        business_id=BID,
        phone="+972507776655",
        channel="whatsapp",
        status=models.WhatsAppNumberStatus.BUSINESS,
        bot_paused=True,
        created_at=now,
        updated_at=now,
    )
    db.add(number)
    await db.commit()
    await post(text("היי", "972507776655"))
    assert wa.sent == []
    number.bot_paused = False
    await db.commit()
    db.add(
        models.WhatsAppMessage(
            id=uuid.uuid4(),
            business_id=BID,
            number_id=number.id,
            direction=models.WhatsAppDirection.OUT,
            wa_message_id="wamid.team-1",
            body="אני כאן",
            status="sent",
            sender_id=uuid.UUID(owner["user_id"]),
            created_at=now,
        )
    )
    await db.commit()
    await post(text("תודה", "972507776655"))
    assert wa.sent == []


async def test_own_wording_and_statuses_deleted_status_stops(setup, post, wa, client, save):
    owner = await setup()
    await req(client, "PUT", status_url(), owner["token"], {"id": "vacation", "until": None})
    saved = await save(
        owner["token"],
        autoReplyText="שלום מ{business}! נחזור בקרוב",
        statuses=[
            {"id": "event", "label": "באירוע", "text": "אני באירוע, אחזור אחרי 23:00"},
            {"id": "c-studio", "label": "באולפן", "text": "באולפן עד הערב 🎧"},
        ],
    )
    assert saved.status_code == 200, saved.text
    s = saved.json()["settings"]
    assert s["autoReplyText"] == "שלום מ{business}! נחזור בקרוב"
    assert s["statuses"] == [
        {"id": "event", "label": "באירוע", "text": "אני באירוע, אחזור אחרי 23:00", "preset": True},
        {"id": "c-studio", "label": "באולפן", "text": "באולפן עד הערב 🎧", "preset": False},
    ]
    assert s["activeStatus"] is None
    await post(text("היי"))
    assert wa.sent[0].text == "שלום מדי ג׳יי רון! נחזור בקרוב"


async def test_checks_statuses_and_permissions(setup, client, db):
    owner = await setup()
    assert (
        await req(client, "PUT", status_url(), owner["token"], {"id": "nope", "until": None})
    ).status_code == 404
    past = await req(
        client,
        "PUT",
        status_url(),
        owner["token"],
        {
            "id": "event",
            "until": (datetime.now(UTC) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
        },
    )
    assert past.status_code == 400 and past.json()["error"]["message"] == "הזמן שבחרתם כבר עבר"
    token, user_id = await new_user(client, "ar-emp")
    await add_member(db, BUSINESS_ID, user_id, "EMPLOYEE")
    assert (await req(client, "PUT", status_url(), token, {"id": "event", "until": None})).status_code == 403
    assert (await upload_video(client, token, mp4())).status_code == 403


async def test_showcase_video_upload_and_delete(setup, client):
    owner = await setup()
    up = await upload_video(client, owner["token"], mp4(4096))
    assert up.status_code == 200, up.text
    assert up.json()["settings"]["showcase"]["video"] == {"sizeBytes": 4096}
    got = await req(client, "GET", video_url(), owner["token"])
    assert got.status_code == 200 and got.headers["content-type"] == "video/mp4" and len(got.content) == 4096
    bad = await upload_video(client, owner["token"], b"not a video at all, definitely")
    assert bad.status_code == 400 and bad.json()["error"]["message"] == "אפשר להעלות רק סרטון MP4"
    removed = await req(client, "DELETE", video_url(), owner["token"])
    assert removed.json()["settings"]["showcase"]["video"] is None
    assert (await req(client, "GET", video_url(), owner["token"])).status_code == 404


async def test_when_to_talk_callback_task_and_peek(setup, post, wa, db):
    owner = await setup()
    await db.execute(
        update(models.Business)
        .where(models.Business.id == BID)
        .values(
            timezone="Asia/Jerusalem",
            whatsapp_bot_showcase={
                "enabled": True,
                "text": "בינתיים, תציצו 👇",
                "link": "https://example.com/work",
                "assetIds": [],
            },
        )
    )
    await db.commit()
    await post(text("היי"))
    assert len(wa.sent) == 1
    rows = wa.sent[0].choices
    assert (rows[-1].id, rows[-1].title) == ("cb:other", "זמן אחר")
    hours = rows[:-1]
    assert 0 < len(hours) <= 8
    import re

    for r in hours:
        assert re.fullmatch(r"cb:\d{4}-\d{2}-\d{2}T(09|1\d|20):00", r.id)
        assert re.fullmatch(r"(היום|מחר) ב־\d{2}:00", r.title)

    tomorrow = (datetime.now(ZoneInfo("Asia/Jerusalem")) + timedelta(days=1)).strftime("%Y-%m-%d")
    await post(tap_row(f"cb:{tomorrow}T09:00"))
    assert [m.text for m in wa.sent[1:]] == [
        "מעולה! נחזור אליכם מחר ב־09:00 🙏",
        "בינתיים, תציצו 👇\nhttps://example.com/work",
    ]
    lead = (await db.execute(select(models.Lead))).scalars().one()
    task = (await db.execute(select(models.Task).where(models.Task.title.like("לחזור%")))).scalars().one()
    assert task.title == "לחזור לנועה — מחר ב־09:00"
    assert str(task.assignee_id) == owner["user_id"] and task.lead_id == lead.id
    assert task.due_at.astimezone(ZoneInfo("Asia/Jerusalem")).strftime("%H:%M") == "09:00"
    assert task.due_at > datetime.now(UTC)
    callback = (
        (
            await db.execute(
                select(models.Appointment).where(models.Appointment.notes == "שיחה חוזרת (נקבעה בוואטסאפ)")
            )
        )
        .scalars()
        .one()
    )
    assert str(callback.staff_id) == owner["user_id"] and callback.lead_id == lead.id
    assert callback.status == models.AppointmentStatus.CONFIRMED and callback.source == "whatsapp"
    assert callback.starts_at == task.due_at and callback.ends_at - callback.starts_at == timedelta(
        minutes=15
    )
    await post(text("עוד משהו"))
    assert f"cb:{tomorrow}T09:00" not in [c.id for c in wa.sent[-1].choices]
    await post(tap_row(f"cb:{tomorrow}T14:00"))
    assert wa.sent[-1].text == "בינתיים, תציצו 👇\nhttps://example.com/work"
    tasks = await count(db, models.Task)
    await post(tap_row("cb:2020-01-01T09:00"))
    assert wa.sent[-1].text == "מתי נוח לכם? כתבו יום ושעה 🙂"
    assert await count(db, models.Task) == tasks


async def test_another_time_written_by_customer(setup, post, wa, db):
    await setup()
    await post(text("היי"))
    await post(tap_row("cb:other"))
    assert wa.sent[-1].text == "מתי נוח לכם? כתבו יום ושעה 🙂"
    await post(text("ביום חמישי אחרי 16:00"))
    assert wa.sent[-1].text == "תודה! נחזור אליכם בזמן שכתבתם 🙏"
    task = (await db.execute(select(models.Task))).scalars().one()
    assert task.title == "לחזור לנועה — ביום חמישי אחרי 16:00"
    assert await count(db, models.Appointment) == 0
