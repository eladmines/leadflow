"""WhatsApp booking bot (D-102), ported from bot.test.ts."""

import io
import json
import re
import time
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from PIL import Image
from sqlalchemy import func, select, update
from sqlalchemy import text as sql

from app.core.timezone import zoned_time_to_utc
from app.db import models
from app.integrations.whatsapp import sign_webhook_body
from app.modules.whatsapp.bot import parse_event_date, with_hebrew_layout
from app.modules.whatsapp.service import build_service
from app.shared.business import WEEKDAYS
from tests.conftest import add_member, business_url, make_settings, new_user, req

BUSINESS_ID = "11111111-2222-4333-8444-555555555555"
SECRET = "test-app-secret-0123456789"
PHONE_ID = "1234567890"
TZ = "Asia/Jerusalem"
FROM = "972501112233"
WEBHOOK = "/api/v1/integrations/whatsapp/webhook"
ALL_DAY = {d: {"open": True, "from": "00:00", "to": "23:30"} for d in WEEKDAYS}
BID = uuid.UUID(BUSINESS_ID)
_seq = 0


def event(message, sender=FROM):
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
                            "contacts": [{"wa_id": sender, "profile": {"name": "נועה לוי"}}],
                            "messages": [
                                {
                                    "from": sender,
                                    "id": f"wamid.bot-{_seq}-{time.time_ns()}",
                                    "timestamp": str(int(time.time())),
                                    **message,
                                }
                            ],
                        },
                    }
                ]
            }
        ],
    }


def text(body, sender=FROM):
    return event({"type": "text", "text": {"body": body}}, sender)


def tap(id_, title=None):
    title = title or id_
    kind = "button_reply" if id_.startswith("ok") or id_ in ("cancel", "other_time") else "list_reply"
    return event({"type": "interactive", "interactive": {"type": kind, kind: {"id": id_, "title": title}}})


def tap_as(id_, sender, kind):
    return event(
        {"type": "interactive", "interactive": {"type": kind, kind: {"id": id_, "title": "x"}}}, sender
    )


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
    async def go(
        enabled=True,
        auto_confirm=True,
        services=2,
        industry="beauty",
        name="עיצוב שיער סיגלית",
        language="he",
    ):
        token, user_id = await new_user(client, "bot-owner")
        now = datetime.now(UTC)
        db.add(
            models.Business(
                id=BID,
                name=name,
                industry=industry,
                status=models.BusinessStatus.ACTIVE,
                timezone=TZ,
                opening_hours=ALL_DAY,
                whatsapp_bot_enabled=enabled,
                whatsapp_reply_mode="booking" if enabled else "off",
                whatsapp_bot_auto_confirm=auto_confirm,
                language=language,
                updated_at=now,
            )
        )
        await db.commit()
        await add_member(db, BUSINESS_ID, user_id, "OWNER")
        created = []
        for i, nm in enumerate(["תספורת נשים", "צבע"][:services]):
            sv = models.Service(
                id=uuid.uuid4(),
                business_id=BID,
                name=nm,
                duration_min=30 + i * 30,
                price=150,
                created_at=now,
                updated_at=now,
            )
            db.add(sv)
            created.append(sv)
        await db.commit()
        return {"owner": {"token": token, "user_id": user_id}, "services": [s.id for s in created]}

    return go


def bot_url(tail=""):
    return business_url(BID, f"/whatsapp/bot{tail}")


async def count(db, model, *where):
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


def ids(m):
    return [c.id for c in m.choices]


def titles(m):
    return [c.title for c in m.choices]


async def test_silent_while_switched_off(setup, post, wa):
    await setup(enabled=False)
    await post(text("היי, אפשר לקבוע תור?"))
    assert wa.sent == []


async def test_status_on_shows_message_with_book_now(setup, post, wa, db):
    await setup()
    await db.execute(
        update(models.Business)
        .where(models.Business.id == BID)
        .values(whatsapp_active_status={"id": "closed", "until": None})
    )
    await db.commit()
    await post(text("היי, אפשר לקבוע תור?"))
    assert "סגורים כרגע" in wa.sent[-1].text
    assert "book" in ids(wa.sent[-1])
    await post(tap("book"))
    assert "עיצוב שיער סיגלית" in wa.sent[-1].text
    assert any(i.startswith("svc:") for i in ids(wa.sent[-1]))


async def test_books_new_customer_end_to_end(setup, post, wa, db, client):
    s = await setup()
    owner = s["owner"]
    await post(text("היי, אפשר לקבוע תור?"))
    assert "עיצוב שיער סיגלית" in wa.sent[-1].text
    assert titles(wa.sent[-1]) == ["צבע", "תספורת נשים", "דברו עם הצוות"]
    haircut = next(
        sv
        for sv in (
            await db.execute(select(models.Service).where(models.Service.name == "תספורת נשים"))
        ).scalars()
    )
    await post(tap(f"svc:{haircut.id}"))
    assert wa.sent[-1].text == "באיזה יום נוח לכם?"
    day = wa.sent[-1].choices[0]
    assert re.fullmatch(r"day:\d{4}-\d{2}-\d{2}", day.id)
    assert re.search(r"זמנים פנויים|זמן פנוי אחד", day.description)
    await post(tap(day.id))
    times = wa.sent[-1].choices
    assert len(times) <= 10 and (times[-1].id, times[-1].title) == ("other_day", "יום אחר")
    t = times[0]
    await post(tap(t.id))
    assert re.fullmatch(r"לקבוע לכם תספורת נשים ב.* בשעה \d{2}:\d{2}\?", wa.sent[-1].text, re.S)
    assert ids(wa.sent[-1]) == ["ok", "other_time", "cancel"]
    await post(tap("ok"))
    assert wa.sent[-1].text.startswith("מעולה! קבענו לכם תספורת נשים ל")

    appt = (await db.execute(select(models.Appointment))).scalars().one()
    assert appt.status == models.AppointmentStatus.CONFIRMED and appt.source == "whatsapp"
    assert str(appt.staff_id) == owner["user_id"] and appt.service_id == haircut.id
    assert appt.starts_at == zoned_time_to_utc(day.id[4:], t.title, TZ)
    assert appt.ends_at - appt.starts_at == timedelta(minutes=30)

    number = (await db.execute(select(models.WhatsAppNumber))).scalars().one()
    assert number.status == models.WhatsAppNumberStatus.BUSINESS
    lead = (await db.execute(select(models.Lead))).scalars().one()
    assert lead.source == models.LeadSource.WHATSAPP and lead.id == appt.lead_id
    contact = (await db.execute(select(models.Contact))).scalars().one()
    assert contact.name == "נועה לוי" and contact.phone == f"+{FROM}"
    thread = (
        await req(client, "GET", business_url(BID, f"/leads/{lead.id}/whatsapp"), owner["token"])
    ).json()
    assert len(thread["messages"]) == 10
    assert thread["messages"][-1]["direction"] == "OUT" and thread["messages"][-1]["sender"] is None
    assert await count(db, models.WhatsAppBotSession) == 0

    notes = (
        (
            await db.execute(
                select(models.Notification).where(models.Notification.user_id == uuid.UUID(owner["user_id"]))
            )
        )
        .scalars()
        .all()
    )
    assert sorted(n.type for n in notes) == ["appointment.booked", "lead.new"]
    task = (await db.execute(select(models.Task))).scalars().one()
    assert str(task.assignee_id) == owner["user_id"] and task.lead_id == lead.id
    assert task.status.value == "OPEN" and task.remind is False
    # D-216 (2): the D-152 notice is the confirm task, linked to the appointment.
    assert re.match(r"^לאשר את התור: נועה לוי · תספורת נשים · ", task.title)
    assert task.auto_kind == "appointment_confirm" and task.appointment_id is not None
    assert abs((task.due_at - datetime.now(UTC)).total_seconds()) < 60


async def test_english_business_books_in_english(setup, post, wa, db):
    s = await setup(language="en", name="Sigal Hair")
    await post(text("Hi, can I book an appointment?"))
    assert re.match(r"^Hello! This is Sigal Hair 👋", wa.sent[-1].text)
    assert wa.sent[-1].choices[-1].title == "Talk to the team"
    await post(tap(f"svc:{s['services'][0]}"))
    assert wa.sent[-1].text == "Which day suits you?"
    day = wa.sent[-1].choices[0]
    assert "free time" in day.description
    await post(tap(day.id))
    assert (wa.sent[-1].choices[-1].id, wa.sent[-1].choices[-1].title) == ("other_day", "Another day")
    await post(tap(wa.sent[-1].choices[0].id))
    assert re.fullmatch(r"Book תספורת נשים on .* at \d{2}:\d{2}\?", wa.sent[-1].text, re.S)
    await post(tap("ok"))
    assert re.match(r"^Great! You're booked for תספורת נשים on ", wa.sent[-1].text)


async def test_cancel_booked_appointment(setup, post, wa, db):
    s = await setup()
    owner = s["owner"]
    await post(text("היי, אפשר לקבוע תור?"))
    await post(tap("cancel"))
    await post(text("אני רוצה לבטל"))
    assert wa.sent[-1].text == "לא מצאנו תור קרוב לבטל 🙂 רוצים לקבוע תור?"
    await post(text("אפשר לקבוע תור?"))
    haircut = next(
        sv
        for sv in (
            await db.execute(select(models.Service).where(models.Service.name == "תספורת נשים"))
        ).scalars()
    )
    await post(tap(f"svc:{haircut.id}"))
    await post(tap(wa.sent[-1].choices[0].id))
    await post(tap(wa.sent[-1].choices[0].id))
    await post(tap("ok"))
    appt = (await db.execute(select(models.Appointment))).scalars().one()
    assert appt.status == models.AppointmentStatus.CONFIRMED

    await post(text("אני רוצה לבטל את התור"))
    assert re.fullmatch(r"לבטל את התור לתספורת נשים ב.* בשעה \d{2}:\d{2}\?", wa.sent[-1].text, re.S)
    assert titles(wa.sent[-1]) == ["כן, לבטל", "לא, להשאיר"]
    await post(tap("xcl_no"))
    assert wa.sent[-1].text == "מעולה, התור נשאר 👍"
    await db.refresh(appt)
    assert appt.status == models.AppointmentStatus.CONFIRMED
    await post(text("ביטול"))
    await post(tap(f"xcl:{appt.id}"))
    assert wa.sent[-1].text.startswith("התור בוטל ✅")
    await db.refresh(appt)
    assert appt.status == models.AppointmentStatus.CANCELLED
    note = (
        (
            await db.execute(
                select(models.Notification).where(
                    models.Notification.user_id == uuid.UUID(owner["user_id"]),
                    models.Notification.type == "appointment.cancelled",
                )
            )
        )
        .scalars()
        .first()
    )
    assert note is not None
    tasks = (await db.execute(select(models.Task).order_by(models.Task.created_at))).scalars().all()
    assert re.match(r"^תור בוטל: נועה לוי · תספורת נשים · ", tasks[-1].title)
    await post(tap(f"xcl:{appt.id}"))
    assert wa.sent[-1].text == "לא מצאנו תור קרוב לבטל 🙂 רוצים לקבוע תור?"


async def test_every_message_answered_with_talk_times(setup, post, wa):
    await setup()
    await post(text("היי"))
    assert re.match(r"^היי! תודה שכתבת לעיצוב שיער סיגלית", wa.sent[-1].text)
    assert ids(wa.sent[-1])[-2:] == ["cb:other", "book"]
    assert re.fullmatch(r"cb:\d{4}-\d{2}-\d{2}T\d{2}:00", ids(wa.sent[-1])[0])
    await post(text("כמה עולה צבע?"))
    assert "cb:other" in ids(wa.sent[-1])
    await post(tap("book"))
    assert "רוצים לקבוע תור?" in wa.sent[-1].text


async def test_single_service_skips_to_days_and_pending_books_request(setup, post, wa, db):
    await setup(services=1, auto_confirm=False)
    await post(text("תור בבקשה"))
    assert wa.sent[-1].text == "באיזה יום נוח לכם?"
    await post(tap(wa.sent[-1].choices[0].id))
    await post(tap(wa.sent[-1].choices[0].id))
    await post(tap("ok"))
    assert wa.sent[-1].text.startswith("קיבלנו את הבקשה")
    assert (
        await db.execute(select(models.Appointment))
    ).scalars().one().status == models.AppointmentStatus.REQUESTED


async def test_taken_time_offers_others(setup, post, wa, db):
    s = await setup(services=1)
    await post(text("אפשר תור?"))
    day = next(
        c for c in wa.sent[-1].choices if c.id.startswith("day:") and not c.title.startswith("היום")
    ).id[4:]
    await post(tap(f"day:{day}"))
    t = wa.sent[-1].choices[0].title
    await post(tap(f"time:{t}"))
    now = datetime.now(UTC)
    contact = models.Contact(
        id=uuid.uuid4(),
        business_id=BID,
        name="מישהי אחרת",
        phone="+972509999999",
        created_at=now,
        updated_at=now,
    )
    db.add(contact)
    await db.commit()
    starts = zoned_time_to_utc(day, t, TZ)
    db.add(
        models.Appointment(
            id=uuid.uuid4(),
            business_id=BID,
            contact_id=contact.id,
            staff_id=uuid.UUID(s["owner"]["user_id"]),
            starts_at=starts,
            ends_at=starts + timedelta(minutes=30),
            status=models.AppointmentStatus.CONFIRMED,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await post(tap("ok"))
    assert wa.sent[-1].text.startswith("אופס, השעה הזו נתפסה הרגע")
    assert t not in titles(wa.sent[-1])
    assert await count(db, models.Appointment) == 1


async def test_after_talk_to_team_next_message_answered(setup, post, wa):
    await setup()
    await post(text("תור"))
    await post(tap("human"))
    assert wa.sent[-1].text.startswith("בסדר! העברנו את השיחה לצוות")
    await post(text("vhh ,ur"))  # "היי תור" typed with the keyboard on English
    assert wa.sent[-1].text.startswith("שלום! כאן עיצוב שיער סיגלית")


def test_hebrew_layout():
    assert with_hebrew_layout("vhh ,ur") == "vhh ,ur היי תור"
    assert with_hebrew_layout("היי") == "היי"
    assert "book please" in with_hebrew_layout("book please")


async def test_unknown_message_repeats_and_cancel_ends(setup, post, wa, db):
    await setup()
    await post(text("תור"))
    await post(text("מה?"))
    assert wa.sent[-1].text.startswith("לא הבנתי")
    assert wa.sent[-1].choices[-1].id == "human"
    await post(text("ביטול"))
    assert wa.sent[-1].text.startswith("בוטל")
    assert await count(db, models.WhatsAppBotSession) == 0


async def test_never_answers_personal_or_team_chat(setup, post, wa, db):
    s = await setup()
    now = datetime.now(UTC)
    db.add(
        models.WhatsAppNumber(
            id=uuid.uuid4(),
            business_id=BID,
            phone="+972507770000",
            channel="whatsapp",
            status=models.WhatsAppNumberStatus.PERSONAL,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await post(text("בא לך לקבוע תור לקפה?", "972507770000"))
    assert wa.sent == []
    number = models.WhatsAppNumber(
        id=uuid.uuid4(),
        business_id=BID,
        phone=f"+{FROM}",
        channel="whatsapp",
        status=models.WhatsAppNumberStatus.BUSINESS,
        created_at=now,
        updated_at=now,
    )
    db.add(number)
    await db.commit()
    db.add(
        models.WhatsAppMessage(
            id=uuid.uuid4(),
            business_id=BID,
            number_id=number.id,
            direction=models.WhatsAppDirection.OUT,
            wa_message_id="wamid.owner-1",
            body="היי! מה שלומך?",
            status="sent",
            sender_id=uuid.UUID(s["owner"]["user_id"]),
            created_at=now,
        )
    )
    await db.commit()
    await post(text("אפשר תור למחר?"))
    assert wa.sent == []


async def test_own_messages_with_placeholders(setup, post, wa, client):
    s = await setup(services=1)
    owner = s["owner"]
    put = await req(
        client,
        "PUT",
        bot_url(),
        owner["token"],
        {
            "enabled": True,
            "autoConfirm": True,
            "texts": {
                "greeting": "היי מ{business}! בחרו שירות:",
                "confirmed": "  נקבע: {service}, {time}. החניה מאחורי הבניין 🚗  ",
                "handoff": "",
            },
        },
    )
    assert put.status_code == 200, put.text
    assert put.json()["settings"]["texts"] == {
        "greeting": "היי מ{business}! בחרו שירות:",
        "confirmed": "נקבע: {service}, {time}. החניה מאחורי הבניין 🚗",
    }
    await post(text("תור"))
    await post(tap(wa.sent[-1].choices[0].id))
    await post(tap(wa.sent[-1].choices[0].id))
    await post(tap("ok"))
    assert re.fullmatch(
        r"נקבע: תספורת נשים, יום .* בשעה \d{2}:\d{2}\. החניה מאחורי הבניין 🚗", wa.sent[-1].text, re.S
    )

    bad = await req(
        client,
        "PUT",
        bot_url(),
        owner["token"],
        {"enabled": True, "autoConfirm": True, "texts": {"greeting": "שלום {name}", "pending": "א" * 601}},
    )
    assert bad.status_code == 400
    f = bad.json()["error"]["fields"]
    assert (
        f["texts.greeting"]
        == "אי אפשר להשתמש בסוגריים מסולסלים { }. כדי להוסיף פרטים, השתמשו בכפתורי ההוספה."
    )
    assert f["texts.pending"] == "ההודעה ארוכה מדי (עד 600 תווים)"


# -- "in the meantime, take a look" (D-106) ----------------------------------------------------------


@pytest.fixture
def with_showcase(setup, client, db, app):
    async def go(**over):
        s = await setup()
        key = f"{BUSINESS_ID}/{uuid.uuid4()}.webp"
        buf = io.BytesIO()
        Image.new("RGB", (40, 30), "#2c837d").save(buf, "WEBP")
        await app.state.storage.put(key, buf.getvalue(), "image/webp")
        now = datetime.now(UTC)
        asset = models.Asset(
            id=uuid.uuid4(),
            business_id=BID,
            key=key,
            mime="image/webp",
            size_bytes=len(buf.getvalue()),
            width=40,
            height=30,
            created_at=now,
        )
        db.add(asset)
        await db.commit()
        showcase = {
            "enabled": True,
            "link": "https://instagram.com/sigalit.hair",
            "assetIds": [str(asset.id)],
            **over,
        }
        put = await req(
            client,
            "PUT",
            bot_url(),
            s["owner"]["token"],
            {"enabled": True, "autoConfirm": True, "showcase": showcase},
        )
        assert put.status_code == 200, put.text
        return {**s, "asset": asset}

    return go


async def test_showcase_after_cancel_once_a_day(with_showcase, post, wa, db):
    await with_showcase()
    await post(text("תור"))
    cs = ids(wa.sent[-1])
    assert re.match(r"svc:", cs[0]) and re.match(r"svc:", cs[1]) and cs[2:] == ["showcase", "human"]
    wa.clear()
    await post(text("ביטול"))
    assert [m.text for m in wa.sent] == [
        'בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂',
        "בינתיים, הנה הצצה לעבודות שלנו ✂️\nhttps://instagram.com/sigalit.hair",
        "",
        "כשתרצו, אפשר לקבוע תור כאן 👇",
    ]
    assert wa.sent[2].image_bytes > 0
    assert [(c.id, c.title) for c in wa.sent[-1].choices] == [("book", "📅 לקביעת תור")]
    number = (await db.execute(select(models.WhatsAppNumber))).scalars().one()
    assert number.bot_showcase_at is not None
    await post(tap("book"))
    assert "רוצים לקבוע תור?" in wa.sent[-1].text
    wa.clear()
    await post(text("ביטול"))
    assert [m.text for m in wa.sent] == ['בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂']


async def test_peek_after_choosing_a_time(with_showcase, post, wa):
    await with_showcase()
    await post(text("היי"))
    hour = next(c for c in wa.sent[-1].choices if c.id.startswith("cb:2"))
    wa.clear()
    await post(tap(hour.id, hour.title))
    texts = [m.text for m in wa.sent]
    assert texts[0].startswith("מעולה! נחזור אליכם")
    assert texts[1] == "בינתיים, הנה הצצה לעבודות שלנו ✂️\nhttps://instagram.com/sigalit.hair"
    assert wa.sent[-1].image_bytes > 0
    assert "כשתרצו, אפשר לקבוע תור כאן 👇" not in texts


async def test_see_our_work_on_request(with_showcase, post, wa, db):
    await with_showcase(text="הצצה ל[שם העסק]: {business} 🎧", link=None)
    now = datetime.now(UTC)
    db.add(
        models.WhatsAppNumber(
            id=uuid.uuid4(),
            business_id=BID,
            phone=f"+{FROM}",
            channel="whatsapp",
            status=models.WhatsAppNumberStatus.BUSINESS,
            bot_showcase_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await post(text("תור"))
    wa.clear()
    await post(tap("showcase"))
    assert wa.sent[0].text == "הצצה ל[שם העסק]: עיצוב שיער סיגלית 🎧"
    assert wa.sent[-1].choices[0].id == "book"


async def test_talk_to_team_gets_showcase_and_book_reopens(with_showcase, post, wa):
    await with_showcase()
    await post(text("תור"))
    wa.clear()
    await post(tap("human"))
    assert wa.sent[0].text.startswith("בסדר! העברנו את השיחה לצוות")
    assert wa.sent[-1].choices[0].id == "book"
    await post(tap("book"))
    assert "רוצים לקבוע תור?" in wa.sent[-1].text


async def test_abandoned_conversation_nudged_once(with_showcase, post, wa, db, app):
    s = await with_showcase()
    await post(text("תור"))
    await post(tap(wa.sent[-1].choices[0].id))
    await db.execute(sql("UPDATE whatsapp_bot_sessions SET updated_at = now() - interval '40 minutes'"))
    await db.commit()
    wa.clear()
    service = build_service(app.state, db)
    assert await service.nudge_abandoned_bookings() == 1
    assert wa.sent[0].text.startswith("בינתיים, הנה הצצה לעבודות שלנו")
    assert await count(db, models.WhatsAppBotSession) == 0
    assert await service.nudge_abandoned_bookings() == 0

    number = (await db.execute(select(models.WhatsAppNumber))).scalars().one()
    await db.execute(
        update(models.WhatsAppNumber)
        .where(models.WhatsAppNumber.id == number.id)
        .values(bot_showcase_at=None)
    )
    await db.commit()
    await post(text("תור"))
    db.add(
        models.WhatsAppMessage(
            id=uuid.uuid4(),
            business_id=BID,
            number_id=number.id,
            direction=models.WhatsAppDirection.OUT,
            wa_message_id="wamid.owner-x",
            body="אני כאן!",
            status="sent",
            sender_id=uuid.UUID(s["owner"]["user_id"]),
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    await db.execute(sql("UPDATE whatsapp_bot_sessions SET updated_at = now() - interval '40 minutes'"))
    await db.commit()
    assert await service.nudge_abandoned_bookings() == 0


async def test_showcase_default_off_and_validation(setup, client, db):
    s = await setup()
    owner = s["owner"]
    get = await req(client, "GET", bot_url(), owner["token"])
    assert get.json()["settings"]["showcase"] == {
        "enabled": False,
        "defaultText": "בינתיים, הנה הצצה לעבודות שלנו ✂️",
        "link": None,
        "assetIds": [],
        "video": None,
    }

    async def bad(showcase):
        return await req(
            client,
            "PUT",
            bot_url(),
            owner["token"],
            {"enabled": True, "autoConfirm": True, "showcase": showcase},
        )

    link = await bad({"enabled": True, "link": "instagram.com/x"})
    assert link.status_code == 400
    assert link.json()["error"]["fields"]["showcase.link"] == "יש להזין קישור מלא שמתחיל ב־https://"
    now = datetime.now(UTC)
    other = models.Business(id=uuid.uuid4(), name="אחר", industry="beauty", updated_at=now)
    db.add(other)
    await db.commit()
    foreign = models.Asset(
        id=uuid.uuid4(),
        business_id=other.id,
        key=f"{other.id}/{uuid.uuid4()}.webp",
        mime="image/webp",
        size_bytes=1,
        width=1,
        height=1,
        created_at=now,
    )
    db.add(foreign)
    await db.commit()
    img = await bad({"enabled": True, "assetIds": [str(foreign.id)]})
    assert img.status_code == 400
    assert "כבר לא קיימת" in img.json()["error"]["fields"]["showcase.assetIds"]


# -- event requests (D-107) ---------------------------------------------------------------------------


def in_months(n):
    d = date.today()
    total = d.year * 12 + (d.month - 1) + n
    y, m = divmod(total, 12)
    return date(y, m + 1, 1) + timedelta(days=d.day - 1)  # rolls over like JavaScript's setMonth


def typed(d):
    return f"{d.day}.{d.month}.{d.year}"


async def test_dj_event_request_flow(setup, post, wa, db, client):
    s = await setup(industry="events", services=0, name="DJ רון")
    owner = s["owner"]
    await post(text("היי, אפשר לבדוק תאריך לחתונה?"))
    assert wa.sent[-1].text == "היי! כאן DJ רון 🎧\nאיך אפשר לעזור?"
    assert ids(wa.sent[-1]) == ["ev_start", "human"]
    await post(tap("ev_start"))
    assert wa.sent[-1].text == "איזה אירוע אתם מתכננים? בחרו:"
    assert titles(wa.sent[-1]) == [
        "חתונה",
        "בר/בת מצווה",
        "יום הולדת",
        "אירוע חברה",
        "מסיבה פרטית",
        "אחר",
        "דברו עם הצוות",
    ]
    await post(tap("evt:t0"))
    assert re.match(r"^חתונה, מעולה! 🎉\nלאיזה תאריך\?", wa.sent[-1].text)
    await post(text("מתי שנוח"))
    assert wa.sent[-1].text.startswith("לא הצלחתי להבין את התאריך")
    day = in_months(4)
    await post(text(f"בתאריך {typed(day)} בערב"))
    assert re.search(r"התאריך פנוי 👍\nבאיזה חלק של היום\?$", wa.sent[-1].text)
    assert ids(wa.sent[-1]) == ["part:day", "part:evening", "part:unknown"]
    await post(tap("part:evening"))
    assert wa.sent[-1].text == "כמה אורחים בערך?"
    await post(tap("guests:2"))
    assert wa.sent[-1].text == "ובאיזה אזור או עיר?"
    await post(text("  ראשון   לציון "))
    assert re.fullmatch(
        r"לסיכום:\n• חתונה\n• .*, ערב\n• אורחים: 150–300\n• אזור: ראשון לציון\n\nלשלוח את הבקשה\?",
        wa.sent[-1].text,
        re.S,
    )
    await post(tap("ev_send"))
    assert re.fullmatch(
        r"תודה! קיבלנו את הפרטים לחתונה ב.* 🙏\nנחזור אליכם בהקדם עם הצעה מסודרת\.", wa.sent[-1].text, re.S
    )

    appt = (await db.execute(select(models.Appointment))).scalars().one()
    assert (
        appt.status == models.AppointmentStatus.REQUESTED
        and appt.source == "whatsapp"
        and appt.staff_id is None
    )
    task = (await db.execute(select(models.Task))).scalars().one()
    assert task.title.startswith("לאשר את התור: ") and task.appointment_id == appt.id  # D-216 (2)
    assert appt.starts_at == zoned_time_to_utc(day.isoformat(), "19:00", TZ)
    assert re.match(r"^בקשה מוואטסאפ · חתונה · ", appt.notes)
    assert "אורחים: 150–300 · אזור: ראשון לציון" in appt.notes
    requests = await req(client, "GET", business_url(BID, "/appointments/requests"), owner["token"])
    assert len(requests.json()["appointments"]) == 1
    lead = (await db.execute(select(models.Lead))).scalars().one()
    assert appt.lead_id == lead.id


async def test_taken_date_offers_another(setup, post, wa, db):
    s = await setup(industry="events", services=0)
    day = in_months(3)
    now = datetime.now(UTC)
    contact = models.Contact(
        id=uuid.uuid4(), business_id=BID, name="אחר", phone="+972509999999", created_at=now, updated_at=now
    )
    db.add(contact)
    await db.commit()
    db.add(
        models.Appointment(
            id=uuid.uuid4(),
            business_id=BID,
            contact_id=contact.id,
            staff_id=uuid.UUID(s["owner"]["user_id"]),
            starts_at=zoned_time_to_utc(day.isoformat(), "19:00", TZ),
            ends_at=zoned_time_to_utc(day.isoformat(), "23:00", TZ),
            status=models.AppointmentStatus.CONFIRMED,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await post(text("אירוע"))
    await post(tap("ev_start"))
    await post(tap("evt:t3"))
    await post(text(typed(day)))
    assert wa.sent[-1].text == "התאריך הזה כבר תפוס אצלנו 😕 רוצים לבדוק תאריך אחר?"
    assert ids(wa.sent[-1]) == ["other_date", "human"]
    await post(text(typed(in_months(5))))
    assert "התאריך פנוי" in wa.sent[-1].text


async def test_photographer_skips_guests(setup, post, wa):
    await setup(industry="photo", services=2, name="סטודיו אור")
    await post(text("הזמנה לצילום"))
    assert wa.sent[-1].text == "היי! כאן סטודיו אור 📸\nאיך אפשר לעזור?"
    await post(tap("ev_start"))
    assert wa.sent[-1].text == "מה מצלמים? בחרו:"
    await post(tap(wa.sent[-1].choices[0].id))
    await post(text(typed(in_months(2))))
    await post(tap("part:day"))
    assert wa.sent[-1].text == "ובאיזה אזור או עיר?"


async def test_owner_questions_follow_status_message(setup, post, wa, db):
    s = await setup(enabled=False, industry="events", name="DJ רון")
    await db.execute(
        update(models.Business)
        .where(models.Business.id == BID)
        .values(
            whatsapp_reply_mode="auto_reply",
            whatsapp_questions=[
                {"id": "q1", "text": "📅 מה תאריך האירוע?"},
                {"id": "q2", "text": "👥 כמה מוזמנים צפויים?"},
            ],
        )
    )
    await db.commit()
    await post(text("היי"))
    assert wa.sent[-1].text == "📅 מה תאריך האירוע?"
    assert wa.sent[-1].choices is None
    await post(tap("ok"))  # a button tapped meanwhile repeats the question
    assert wa.sent[-1].text == "📅 מה תאריך האירוע?"
    await post(text("14.2.2027"))
    assert wa.sent[-1].text == "👥 כמה מוזמנים צפויים?"
    await post(text("בערך 120"))
    assert wa.sent[-1].text.startswith("תודה רבה על כל התשובות")
    assert "cb:other" in ids(wa.sent[-1])
    task = (await db.execute(select(models.Task).where(models.Task.business_id == BID))).scalars().one()
    assert str(task.assignee_id) == s["owner"]["user_id"]
    assert task.notes == "📅 מה תאריך האירוע?\n14.2.2027\n👥 כמה מוזמנים צפויים?\nבערך 120"
    note = (
        (await db.execute(select(models.Activity).where(models.Activity.type == "lead.note"))).scalars().one()
    )
    assert "בערך 120" in json.dumps(note.data, ensure_ascii=False)
    assert await count(db, models.WhatsAppBotSession) == 0


async def test_questions_switch_d198(setup, post, wa, db, client):
    s = await setup(enabled=False, industry="events", name="DJ רון")
    owner = s["owner"]
    await db.execute(
        update(models.Business)
        .where(models.Business.id == BID)
        .values(
            whatsapp_reply_mode="auto_reply", whatsapp_questions=[{"id": "q1", "text": "📅 מה תאריך האירוע?"}]
        )
    )
    await db.commit()
    saved = lambda: req(client, "GET", bot_url(), owner["token"])  # noqa: E731
    assert (await saved()).json()["settings"]["questionsEnabled"] is True
    off = await req(
        client,
        "PUT",
        bot_url(),
        owner["token"],
        {"mode": "auto_reply", "enabled": False, "autoConfirm": True, "questionsEnabled": False},
    )
    st = off.json()["settings"]
    assert st["questionsEnabled"] is False and st["questions"] == [
        {"id": "q1", "text": "📅 מה תאריך האירוע?"}
    ]
    await post(text("היי"))
    assert "מה תאריך האירוע" not in wa.sent[-1].text
    assert "cb:other" in ids(wa.sent[-1])
    sent_while_off = len(wa.sent)
    await db.execute(sql("DELETE FROM whatsapp_bot_sessions"))
    await db.execute(
        update(models.Business).where(models.Business.id == BID).values(whatsapp_questions_enabled=True)
    )
    await db.commit()
    await post(text("שלום שוב"))
    assert len(wa.sent) > sent_while_off
    assert wa.sent[-1].text == "📅 מה תאריך האירוע?"


async def test_switch_flow_either_way(setup, post, wa, db, client):
    s = await setup(industry="beauty")
    owner = s["owner"]
    get = (await req(client, "GET", bot_url(), owner["token"])).json()
    assert get["settings"]["flow"] == "appointment" and get["settings"]["flowIsDefault"] is True
    assert get["settings"]["defaults"]["greeting"] == "שלום! כאן {business} 👋\nרוצים לקבוע תור? בחרו שירות:"
    put = await req(
        client, "PUT", bot_url(), owner["token"], {"enabled": True, "autoConfirm": True, "flow": "event"}
    )
    assert put.json()["settings"]["flow"] == "event" and put.json()["settings"]["flowIsDefault"] is False
    await post(text("תור"))
    await post(tap("ev_start"))
    first = (await db.execute(select(models.Service).order_by(models.Service.name))).scalars().first()
    assert f"evt:svc:{first.id}" in ids(wa.sent[-1])


# -- a personal touch (D-108) --------------------------------------------------------------------------


async def test_talk_about_wedding_goes_straight_to_owner(setup, post, wa):
    await setup(industry="events", services=0, name="DJ רון")
    await post(text("היי, אפשר לדבר איתך על החתונה שלי?"))
    assert [m.text for m in wa.sent] == ["בסדר! העברנו את השיחה לצוות, נחזור אליכם כאן בהקדם 🙂"]
    assert wa.sent[-1].choices is None
    await post(text("אז מה, יש תאריך?"))
    assert len(wa.sent) == 2


async def test_personal_chat_on_first_reply(setup, post, wa):
    await setup(industry="events", services=0)
    await post(text("היי"))
    await post(tap("human"))
    assert wa.sent[-1].text.startswith("בסדר! העברנו את השיחה לצוות")


async def test_two_misses_hand_over(setup, post, wa):
    await setup()
    await post(text("תור"))
    await post(text("מה?"))
    assert wa.sent[-1].text.startswith("לא הבנתי")
    await post(text("לא ברור לי"))
    assert wa.sent[-1].text.startswith("בסדר! העברנו את השיחה לצוות")
    await post(text("הלו?"))
    assert "cb:other" in ids(wa.sent[-1])


async def test_event_request_hold_date_setting(setup, post, wa, db, client):
    s = await setup(industry="events", services=0)
    day = typed(in_months(4))

    async def request(sender):
        await post(text("אירוע", sender))
        await post(tap_as("ev_start", sender, "button_reply"))
        await post(tap_as("evt:t0", sender, "list_reply"))
        await post(text(day, sender))

    await request(FROM)
    await post(tap("part:evening"))
    await post(tap("guests:1"))
    await post(text("חיפה"))
    await post(tap("ev_send"))
    assert (
        await count(db, models.Appointment, models.Appointment.status == models.AppointmentStatus.REQUESTED)
        == 1
    )
    await request("972502223344")  # the owner decides, so the date is still offered
    assert "התאריך פנוי" in wa.sent[-1].text
    await req(
        client,
        "PUT",
        bot_url(),
        s["owner"]["token"],
        {"enabled": True, "autoConfirm": True, "holdDate": True},
    )
    await request("972503334455")
    assert wa.sent[-1].text == "התאריך הזה כבר תפוס אצלנו 😕 רוצים לבדוק תאריך אחר?"


async def test_owner_pauses_bot_for_one_customer(setup, post, wa, db, client):
    s = await setup()
    owner = s["owner"]
    await post(text("תור"))
    lead = (
        await req(
            client,
            "POST",
            business_url(BID, "/leads"),
            owner["token"],
            {"name": "נועה לוי", "phone": "050-1112233"},
        )
    ).json()["lead"]
    pause = await req(
        client,
        "PUT",
        business_url(BID, f"/leads/{lead['id']}/whatsapp/bot"),
        owner["token"],
        {"paused": True},
    )
    assert pause.status_code == 204
    assert await count(db, models.WhatsAppBotSession) == 0
    thread = (
        await req(client, "GET", business_url(BID, f"/leads/{lead['id']}/whatsapp"), owner["token"])
    ).json()
    assert thread["botPaused"] is True
    before = len(wa.sent)
    await post(text("אפשר תור למחר?"))
    assert len(wa.sent) == before
    await req(
        client,
        "PUT",
        business_url(BID, f"/leads/{lead['id']}/whatsapp/bot"),
        owner["token"],
        {"paused": False},
    )
    await post(text("אפשר תור למחר?"))
    assert len(wa.sent) > before


def test_typed_dates():
    assert parse_event_date("14.2.2027", "2026-11-03") == "2027-02-14"
    assert parse_event_date("ב-14/2/27 בערב", "2026-11-03") == "2027-02-14"
    assert parse_event_date("14-02", "2026-11-03") == "2027-02-14"
    assert parse_event_date("20.11", "2026-11-03") == "2026-11-20"
    assert parse_event_date("31.2.2027", "2026-11-03") is None
    assert parse_event_date("1.1.2026", "2026-11-03") is None
    assert parse_event_date("1.1.2030", "2026-11-03") is None
    assert parse_event_date("מחר", "2026-11-03") is None


async def test_settings_permissions(setup, client, db):
    s = await setup(enabled=False)
    owner = s["owner"]
    get = await req(client, "GET", bot_url(), owner["token"])
    body = get.json()
    assert body["connected"] is True
    assert (
        body["settings"]["enabled"] is False
        and body["settings"]["autoConfirm"] is True
        and body["settings"]["texts"] == {}
    )
    put = await req(client, "PUT", bot_url(), owner["token"], {"enabled": True, "autoConfirm": False})
    st = put.json()["settings"]
    assert st["enabled"] is True and st["autoConfirm"] is False and st["texts"] == {}
    token, user_id = await new_user(client, "bot-employee")
    await add_member(db, BUSINESS_ID, user_id, "EMPLOYEE")
    assert (await req(client, "GET", bot_url(), token)).status_code == 403
    assert (
        await req(client, "PUT", bot_url(), token, {"enabled": False, "autoConfirm": True})
    ).status_code == 403
