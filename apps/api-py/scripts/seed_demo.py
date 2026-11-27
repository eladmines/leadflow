"""Sample data for one business, so a demo account looks lived-in: leads in every stage (website,
WhatsApp, manual) with history and notes, tasks, services and appointments, quotes, and WhatsApp
conversations. Everything it adds is tagged "דוגמה" and can be removed again.

    DATABASE_URL='postgresql://…' uv run python scripts/seed_demo.py --email ido@example.com
    DATABASE_URL='postgresql://…' uv run python scripts/seed_demo.py --email ido@example.com --remove

The database is never taken from .env: the address must be given in the environment of the command
(a real `DATABASE_URL`), so it is always a deliberate choice which database gets the data.
"""

import argparse
import asyncio
import os
import sys
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.getcwd())
_URL = os.environ.get("DATABASE_URL")

from sqlalchemy import delete, func, select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.core.security import generate_token  # noqa: E402
from app.core.timeutil import now_ms  # noqa: E402
from app.core.timezone import zoned_time_to_utc  # noqa: E402
from app.db import models as m  # noqa: E402
from app.modules.leads.service import ensure_stages  # noqa: E402

TAG = "דוגמה"
DAY = timedelta(days=1)
WEEKDAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")

EVENTS = ("events", "catering", "photo")
CONTENT = {
    "events": {
        "services": [("פגישת היכרות", 30, 0), ("חתונה — DJ מלא", 360, 6500), ("בר/בת מצווה", 240, 4200)],
        "asks": [
            "מחפשים DJ לחתונה ב־14.2, כ־250 אורחים",
            "בר מצווה באולם בחולון, אפשר הצעת מחיר?",
            "אירוע חברה לכ־120 עובדים בסוף החודש",
            "יום הולדת 40 בבית, משהו קטן וחם",
            "חינה ב־20.3, מוזיקה מזרחית בעיקר",
            "האם יש לכם גם תאורה ועשן?",
            "חתונה בגן אירועים בצפון, תאריך גמיש",
            "מסיבת רווקות, 30 בנות",
        ],
        "items": [
            ("DJ לאירוע — 6 שעות", 650000),
            ("תאורת רחבה", 120000),
            ("מכונת עשן כבד", 80000),
            ("הגברה לטקס חופה", 90000),
        ],
    },
    "beauty": {
        "services": [("תספורת נשים", 45, 180), ("צבע שורשים", 90, 320), ("החלקה", 150, 900)],
        "asks": [
            "תספורת + צבע ביום חמישי?",
            "כמה עולה החלקה אורגנית?",
            "תור לתספורת לבת שלי (8)",
            "יש תור פנוי מחר בבוקר?",
            "תסרוקת לחתונה ב־12.3, כולל ניסיון",
            "גוונים בלונד, שיער ארוך",
            "אני רוצה לשנות צבע לגמרי",
            "כמה זמן לוקח טיפול קרטין?",
        ],
        "items": [
            ("תסרוקת כלה כולל ניסיון", 120000),
            ("איפור כלה", 90000),
            ("תסרוקת מלווה", 35000),
            ("החלקה אורגנית", 90000),
        ],
    },
    "trades": {
        "services": [("ביקור ואבחון", 60, 250), ("תיקון תקלה", 90, 450), ("התקנה", 180, 1200)],
        "asks": [
            "נפל לי החשמל בחצי בית",
            "צריך להתקין מזגן בחדר שינה",
            "נזילה מתחת לכיור במטבח",
            "הצעת מחיר לשיפוץ חדר אמבטיה",
            "החלפת לוח חשמל ישן",
            "שקע שמתחמם, דחוף",
            "התקנת גוף תאורה בסלון",
            "בדיקה לפני קניית דירה",
        ],
        "items": [
            ("החלפת לוח חשמל", 280000),
            ("נקודת חשמל חדשה", 35000),
            ("עבודה — שעת טכנאי", 25000),
            ("חומרים", 60000),
        ],
    },
    "general": {
        "services": [("שיחת ייעוץ", 30, 0), ("פגישה", 60, 300), ("חבילה מורחבת", 120, 900)],
        "asks": [
            "אשמח לפרטים על השירות",
            "כמה זה עולה?",
            "אפשר לקבוע פגישה בשבוע הבא?",
            "ראיתי אתכם באינסטגרם, מתעניין",
            "יש לכם זמינות בסוף החודש?",
            "קיבלתי המלצה מחברה",
            "אפשר הצעת מחיר מסודרת?",
            "מה כולל השירות?",
        ],
        "items": [
            ("חבילה בסיסית", 150000),
            ("חבילה מורחבת", 290000),
            ("שעת ייעוץ", 30000),
            ("תוספת דחופה", 50000),
        ],
    },
}
PEOPLE = [
    ("נועה לוי", "noa.levi@example.com"),
    ("יוסי מזרחי", None),
    ("שירה כהן", "shira.c@example.com"),
    ("אבי פרץ", None),
    ("מיכל אברהם", "michal.a@example.com"),
    ("דניאל ביטון", None),
    ("רונית שמעוני", "ronit.sh@example.com"),
    ("עומר גבאי", None),
    ("תמר דהן", "tamar.d@example.com"),
    ("איתי פרידמן", None),
    ("ליאת אזולאי", "liat.az@example.com"),
    ("גיא חדד", None),
    ("הדר רוזן", "hadar.r@example.com"),
    ("יעל ששון", None),
    ("אלון קפלן", "alon.k@example.com"),
    ("מאיה שטרן", None),
    ("רועי ברק", "roi.b@example.com"),
    ("אורית נחום", None),
    ("עידן סלע", "idan.s@example.com"),
    ("קרן וקנין", None),
]
NOTES = [
    "דיברנו בטלפון, מחכה לאישור מבן/בת הזוג",
    "ביקש/ה לחזור אחרי החגים",
    "שלחתי פרטים בוואטסאפ",
    "לקוח/ה חוזר/ת, מאוד מרוצה",
]
TASKS = [
    ("להתקשר לחזור — לא ענה אתמול", -2, False),
    ("לשלוח הצעת מחיר מעודכנת", -1, False),
    ("לאשר תאריך מול הלקוח", 0, False),
    ("לבדוק זמינות ציוד", 0, False),
    ("שיחת מעקב אחרי הפגישה", 0, False),
    ("להזכיר על המקדמה", 2, False),
    ("לשלוח תמונות מהעבודות הקודמות", 4, False),
    ("שיחת היכרות", 6, False),
    ("להחזיר טלפון", -3, True),
]
SLOTS = [
    (-5, "10:00", "COMPLETED", "manual"),
    (-3, "12:30", "COMPLETED", "whatsapp"),
    (-1, "16:00", "COMPLETED", "website"),
    (0, "18:00", "CONFIRMED", "manual"),
    (1, "09:30", "CONFIRMED", "whatsapp"),
    (1, "13:00", "CONFIRMED", "website"),
    (2, "11:00", "CONFIRMED", "manual"),
    (3, "10:00", "REQUESTED", "website"),
    (3, "15:30", "CONFIRMED", "whatsapp"),
    (5, "12:00", "CONFIRMED", "manual"),
    (6, "17:00", "REQUESTED", "whatsapp"),
]
CHATS = [
    [("IN", "היי, ראיתי את האתר שלכם 🙂"), ("OUT", "היי! שמחים שפנית, איך אפשר לעזור?"), ("IN", None)],
    [
        ("IN", "שלום, יש זמינות בשבוע הבא?"),
        ("OUT", "בטח, איזה יום נוח לך?"),
        ("IN", "רביעי אחה״צ"),
        ("OUT", "מעולה, שריינתי 👍"),
    ],
    [("IN", "אפשר הצעת מחיר?"), ("OUT", "בשמחה, שולח עוד היום")],
]


def kind_of(industry: str) -> str:
    if industry in EVENTS:
        return "events"
    if industry in ("beauty", "studio"):
        return "beauty"
    if industry in ("trades", "auto"):
        return "trades"
    return "general"


def phone_of(i: int) -> str:
    return f"+97250000{100 + i:04d}"


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email")
    ap.add_argument("--remove", action="store_true")
    a = ap.parse_args()
    if not _URL:
        print("Set DATABASE_URL to the database to fill (it is not read from .env).")
        return 1
    if not a.email:
        print("Usage: seed_demo.py --email <the account's email> [--remove]")
        return 1
    url = _URL.replace("postgresql://", "postgresql+asyncpg://", 1).split("?")[0]
    engine = create_async_engine(url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            return await run(db, a.email.strip().lower(), a.remove)
    finally:
        await engine.dispose()


async def run(db, email: str, remove: bool) -> int:
    user = (await db.execute(select(m.User).where(m.User.email == email))).scalar_one_or_none()
    if not user:
        print(f"No account with the email {email}.")
        return 1
    business = (
        await db.execute(
            select(m.Business)
            .join(m.Membership, m.Membership.business_id == m.Business.id)
            .where(
                m.Membership.user_id == user.id,
                m.Membership.role == m.MembershipRole.OWNER,
                m.Membership.status == m.MembershipStatus.ACTIVE,
            )
            .order_by(m.Membership.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not business:
        print(f"{email} doesn't own a business yet (finish onboarding first).")
        return 1
    demo = (
        (
            await db.execute(
                select(m.Lead).where(m.Lead.business_id == business.id, m.Lead.tags.contains([TAG]))
            )
        )
        .scalars()
        .all()
    )

    if remove:
        phones = [phone_of(i) for i in range(len(PEOPLE))] + ["+972500009999"]
        lead_ids = [lead.id for lead in demo]
        await db.execute(
            delete(m.Task).where(m.Task.business_id == business.id, m.Task.lead_id.in_(lead_ids))
        )
        await db.execute(
            delete(m.WhatsAppNumber).where(
                m.WhatsAppNumber.business_id == business.id, m.WhatsAppNumber.phone.in_(phones)
            )
        )
        await db.execute(
            delete(m.Contact).where(
                m.Contact.business_id == business.id, m.Contact.id.in_([lead.contact_id for lead in demo])
            )
        )
        await db.commit()
        print(f'Removed the sample data from "{business.name}" ({len(demo)} leads).')
        return 0
    if demo:
        print(f'"{business.name}" already has sample data. Run with --remove first to start over.')
        return 0

    now = datetime.now(UTC)
    tz = business.timezone
    zone = ZoneInfo(tz)

    def day_in(days: int) -> str:
        return (now + days * DAY).astimezone(zone).strftime("%Y-%m-%d")

    def ago(days: float, hours: float = 0) -> datetime:
        return now - timedelta(days=days, hours=hours)

    hours = business.opening_hours if isinstance(business.opening_hours, dict) else {}

    def open_day(days: int) -> str:
        """The day `days` from today, moved forward past days the business is closed."""
        for d in range(days, days + 7):
            day = day_in(d)
            wd = WEEKDAYS[(date.fromisoformat(day).weekday() + 1) % 7]
            if (hours.get(wd) or {}).get("open") is not False:
                return day
        return day_in(days)

    content = CONTENT[kind_of(business.industry)]
    stages = await ensure_stages(db, business.id)
    open_stages = [s for s in stages if s.kind == m.StageKind.OPEN]
    won = next(s for s in stages if s.kind == m.StageKind.WON)
    lost = next(s for s in stages if s.kind == m.StageKind.LOST)
    stamp = now_ms()
    biz = business.id

    services = list(
        (
            await db.execute(
                select(m.Service).where(m.Service.business_id == biz, m.Service.active.is_(True))
            )
        ).scalars()
    )
    if not services:
        for name, duration, price in content["services"]:
            sv = m.Service(
                id=uuid.uuid4(),
                business_id=biz,
                name=name,
                duration_min=duration,
                price=price or None,
                created_at=stamp,
                updated_at=stamp,
            )
            db.add(sv)
            services.append(sv)
        await db.flush()

    leads = []
    for i, (name, mail) in enumerate(PEOPLE):
        stage = won if i % 10 == 3 else lost if i % 10 == 4 else open_stages[i % len(open_stages)]
        source = ("website_form", "whatsapp", "manual")[i % 3]
        created = ago(i * 1.4 + 0.2, (i * 7) % 11)
        contact = m.Contact(
            id=uuid.uuid4(),
            business_id=biz,
            name=name,
            phone=phone_of(i),
            email=mail,
            created_at=created,
            updated_at=created,
        )
        db.add(contact)
        await db.flush()
        lead = m.Lead(
            id=uuid.uuid4(),
            business_id=biz,
            contact_id=contact.id,
            stage_id=stage.id,
            owner_id=user.id,
            source=m.LeadSource(source),
            source_url="https://example.com/" if source == "website_form" else None,
            message=content["asks"][i % len(content["asks"])],
            tags=[TAG, "VIP"] if i % 7 == 2 else [TAG],
            created_at=created,
            updated_at=created,
        )
        db.add(lead)
        await db.flush()
        leads.append(
            {
                "id": lead.id,
                "contact_id": contact.id,
                "name": name,
                "phone": phone_of(i),
                "i": i,
                "source": source,
            }
        )
        db.add(
            m.Activity(
                id=uuid.uuid4(),
                business_id=biz,
                lead_id=lead.id,
                type="lead.created",
                data={"source": source, "contactReused": False},
                created_at=created,
            )
        )
        if stage.id != stages[0].id:
            db.add(
                m.Activity(
                    id=uuid.uuid4(),
                    business_id=biz,
                    lead_id=lead.id,
                    actor_id=user.id,
                    type="lead.stage_changed",
                    data={"from": stages[0].name, "to": stage.name, "toKind": stage.kind.value},
                    created_at=created + timedelta(hours=3),
                )
            )
        if i % 4 == 1:
            db.add(
                m.Activity(
                    id=uuid.uuid4(),
                    business_id=biz,
                    lead_id=lead.id,
                    actor_id=user.id,
                    type="lead.note",
                    data={"text": NOTES[i % 4]},
                    created_at=created + timedelta(hours=5),
                )
            )

    for k, (title, days, done) in enumerate(TASKS):
        db.add(
            m.Task(
                id=uuid.uuid4(),
                business_id=biz,
                title=title,
                due_at=zoned_time_to_utc(day_in(days), f"{10 + k % 6}:00", tz),
                status=m.TaskStatus.DONE if done else m.TaskStatus.OPEN,
                completed_at=ago(2) if done else None,
                assignee_id=user.id,
                lead_id=leads[k]["id"],
                remind=False,
                created_by_id=user.id,
                created_at=stamp,
                updated_at=stamp,
            )
        )

    for k, (days, time, status, source) in enumerate(SLOTS):
        service = services[k % len(services)]
        starts = zoned_time_to_utc(open_day(days), time, tz)
        lead = leads[(k + 3) % len(leads)]
        db.add(
            m.Appointment(
                id=uuid.uuid4(),
                business_id=biz,
                contact_id=lead["contact_id"],
                lead_id=lead["id"],
                service_id=service.id,
                staff_id=None if status == "REQUESTED" else user.id,
                starts_at=starts,
                ends_at=starts + timedelta(minutes=service.duration_min),
                status=m.AppointmentStatus(status),
                source=source,
                created_by_id=user.id if source == "manual" else None,
                created_at=stamp,
                updated_at=stamp,
            )
        )

    last = (await db.execute(select(func.max(m.Quote.number)).where(m.Quote.business_id == biz))).scalar_one()
    number = (last or 1000) + 1
    for k, status in enumerate(("DRAFT", "SENT", "ACCEPTED", "REJECTED")):
        lead = leads[[0, 5, 3, 4][k]]
        items = [
            {"description": d, "quantity": 2 if j == 3 else 1, "unitPrice": p}
            for j, (d, p) in enumerate(content["items"][: 2 + (k % 3)])
        ]
        db.add(
            m.Quote(
                id=uuid.uuid4(),
                business_id=biz,
                lead_id=lead["id"],
                number=number,
                title=f"הצעת מחיר עבור {lead['name']}",
                items=items,
                discount=20000 if k == 2 else 0,
                notes="המחיר כולל הגעה ואינו כולל מע״מ. בתוקף ל־14 יום.",
                valid_until=(now + 14 * DAY).date(),
                status=m.QuoteStatus(status),
                public_token=None if status == "DRAFT" else generate_token(),
                sent_at=None if status == "DRAFT" else ago(4 - k),
                decided_at=ago(1) if status in ("ACCEPTED", "REJECTED") else None,
                created_by_id=user.id,
                created_at=ago(5 - k),
                updated_at=stamp,
            )
        )
        number += 1

    wa_leads = [lead for lead in leads if lead["source"] == "whatsapp"][: len(CHATS)]
    for k, lead in enumerate(wa_leads):
        num = m.WhatsAppNumber(
            id=uuid.uuid4(),
            business_id=biz,
            phone=lead["phone"],
            channel="whatsapp",
            status=m.WhatsAppNumberStatus.BUSINESS,
            profile_name=lead["name"],
            classified_by_id=user.id,
            classified_at=ago(3 - k),
            created_at=stamp,
            updated_at=stamp,
        )
        db.add(num)
        await db.flush()
        for j, (direction, body) in enumerate(CHATS[k]):
            db.add(
                m.WhatsAppMessage(
                    id=uuid.uuid4(),
                    business_id=biz,
                    number_id=num.id,
                    contact_id=lead["contact_id"],
                    lead_id=lead["id"],
                    direction=m.WhatsAppDirection(direction),
                    wa_message_id=f"wamid.demo-{num.id}-{j}",
                    body=body or content["asks"][1],
                    status="received" if direction == "IN" else "read",
                    sender_id=user.id if direction == "OUT" else None,
                    created_at=ago(3 - k, 5 - j),
                )
            )
    inbox = m.WhatsAppNumber(
        id=uuid.uuid4(),
        business_id=biz,
        phone="+972500009999",
        channel="whatsapp",
        status=m.WhatsAppNumberStatus.UNCLASSIFIED,
        profile_name="אורן",
        created_at=stamp,
        updated_at=stamp,
    )
    db.add(inbox)
    await db.flush()
    for j, body in enumerate(["היי, קיבלתי את המספר שלכם מחבר", "אפשר לדבר מחר?"]):
        db.add(
            m.WhatsAppMessage(
                id=uuid.uuid4(),
                business_id=biz,
                number_id=inbox.id,
                direction=m.WhatsAppDirection.IN,
                wa_message_id=f"wamid.demo-{inbox.id}-{j}",
                body=body,
                status="received",
                created_at=ago(0, 2 - j),
            )
        )
    await db.commit()
    print(
        f'Added to "{business.name}": {len(leads)} leads, {len(TASKS)} tasks, {len(SLOTS)} appointments, 4 quotes, '
        f"{len(wa_leads) + 1} WhatsApp conversations, services: {', '.join(s.name for s in services)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
