"""WhatsApp booking bot (D-102). A button conversation: service → day → time → confirm → booked.
Every message starts it (D-154), never on a personal number, and stays quiet once a team member
has written in the chat or the customer asked for a person. Texts to customers are in the
business's language (D-143). A customer who doesn't book gets the business's showcase
("in the meantime, take a look", D-106). Event businesses (DJ, catering, photography) use the
event-request flow instead (D-107): event type → date (typed) → part of day → guests → area → a
request the team confirms.

Port of apps/api/src/modules/whatsapp/bot.ts. The conversation state lives in plain dataclasses
(not ORM rows), so a rollback never leaves the bot holding expired objects.
"""

import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from datetime import date as _date
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.timeutil import now_ms
from app.core.timezone import add_days_to, date_in_zone, zoned_time_to_utc
from app.db.models import (
    Activity,
    Appointment,
    AppointmentStatus,
    Asset,
    Business,
    Contact,
    Lead,
    Membership,
    MembershipRole,
    MembershipStatus,
    Service,
    Task,
    WhatsAppBotSession,
    WhatsAppDirection,
    WhatsAppMessage,
    WhatsAppNumber,
    WhatsAppNumberStatus,
)
from app.errors import AppError
from app.integrations.storage import StorageProvider
from app.integrations.whatsapp import WhatsAppChoice, WhatsAppSender
from app.modules.appointments.availability import BusinessInfo, free_times, today_in
from app.modules.appointments.service import CALL_BACK_MINUTES, AppointmentService
from app.modules.notifications.service import MANAGERS, notify_safe
from app.modules.outbound.service import Dispatch, choices_payload, queue_message
from app.modules.whatsapp import auto_reply as ar
from app.modules.whatsapp.bot_words import WORDS, Words, event_day, long_day, short_day
from app.shared import whatsapp as sw

log = logging.getLogger("simplecatch")

SESSION_MS = 30 * 60_000
HANDOFF_MS = 12 * 60 * 60_000
DAYS_AHEAD = 14
MAX_ROWS = 9  # WhatsApp lists hold 10 rows; one is kept for "talk to the team" / "another day"
DEFAULT_DURATION = 30
SHOWCASE_EVERY_MS = 24 * 60 * 60_000
ABANDONED_AFTER_MS = 30 * 60_000
ABANDONED_UNTIL_MS = 20 * 60 * 60_000
MAX_MISSES = 2

CHOICE = re.compile(
    r"(svc:[0-9a-f-]{36}|day:\d{4}-\d{2}-\d{2}|time:\d{2}:\d{2}|evt:(svc:[0-9a-f-]{36}|t\d{1,2})"
    r"|part:(day|evening|unknown)|guests:\d|xcl:[0-9a-f-]{36}|xpick:[0-9a-f-]{36}|xcl_no|ok|other_time"
    r"|other_day|other_date|ev_send|ev_edit|ev_start|cancel|human|showcase|book"
    r"|cb:(other|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}))",
    re.ASCII,
)
OPEN_STEPS = (
    "service",
    "day",
    "time",
    "confirm",
    "ev_type",
    "ev_date",
    "ev_part",
    "ev_guests",
    "ev_area",
    "ev_confirm",
    "ev_q",
)
PARTS = {
    "day": ("12:00", "16:00"),
    "evening": ("19:00", "23:00"),
    "unknown": ("19:00", "23:00"),
}
BOOK_TEXT = re.compile(r"פגישה|תור|לקבוע|להזמין|הזמנה|אירוע|תאריך|book|appointment|event", re.I)
CANCEL_TEXT = re.compile(r"בטל|ביטול|cancel", re.I)
HUMAN_TEXT = re.compile(
    r"נציג|לדבר|להתקשר|תתקשר|תתקשרי|תחזור|תחזרי|שיחה|שאלה|בן אדם|אדם אמיתי|human|agent|call me|talk to", re.I
)
CALLBACK = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$", re.ASCII)
CALLBACK_FIRST_HOUR, CALLBACK_LAST_HOUR, CALLBACK_SLOTS = 9, 20, 8

_QWERTY = "qwertyuiopasdfghjkl;zxcvbnm,./'"
_HEB = "/'קראטוןםפשדגכעיחלךףזסבהנמצתץ.,"
HEBREW_KEYS = dict(zip(_QWERTY, _HEB, strict=False))


def with_hebrew_layout(body: str) -> str:
    """The message plus, when it has no Hebrew letters, how it reads on the Hebrew layout."""
    if re.search(r"[֐-׿]", body) or not re.search(r"[a-z]", body, re.I):
        return body
    return f"{body} {''.join(HEBREW_KEYS.get(ch, ch) for ch in body.lower())}"


def parse_event_date(text: str, today: str) -> str | None:
    """A date the customer typed ("14.2.2027", "14/2/27", "14-02" = the next 14 February) as
    YYYY-MM-DD, from today up to two years ahead; None if it isn't one."""
    m = re.search(r"(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{2,4}))?", text, re.ASCII)
    if not m:
        return None
    d, mo = int(m[1]), int(m[2])
    y = int(m[3]) if m[3] else int(today.split("-")[0])
    if y < 100:
        y += 2000

    def iso(yy: int) -> str | None:
        try:
            return _date(yy, mo, d).isoformat()
        except ValueError:
            return None

    out = iso(y)
    if out and not m[3] and out < today:
        out = iso(y + 1)
    if not out or out < today or out > add_days_to(today, 730):
        return None
    return out


def spread(items: list[Any], max_: int) -> list[Any]:
    """Up to `max_` items spread evenly over the list (first and last kept)."""
    if len(items) <= max_:
        return items
    idx = sorted({(2 * i * (len(items) - 1) + (max_ - 1)) // (2 * (max_ - 1)) for i in range(max_)})
    return [items[i] for i in idx]


@dataclass
class BotMessage:
    from_: str
    body: str
    reply_id: str | None = None


@dataclass
class Sess:
    id: uuid.UUID
    step: str
    service_id: uuid.UUID | None
    date: str | None
    time: str | None
    data: dict[str, Any]
    expires_at: datetime
    updated_at: datetime


@dataclass
class BotBusiness:
    id: uuid.UUID
    name: str
    industry: str
    language: str
    timezone: str
    opening_hours: Any
    auto_confirm: bool
    texts: dict[str, str]
    showcase: dict[str, Any]
    showcase_video: str | None
    flow: str
    hold_date: bool
    questions: list[dict[str, str]]


@dataclass
class Chat:
    business: BotBusiness
    sender: WhatsAppSender
    number_id: uuid.UUID
    phone: str
    showcase_at: datetime | None
    link: dict[str, uuid.UUID | None]
    session: Sess | None
    now: datetime
    words: Words = field(init=False)

    def __post_init__(self) -> None:
        self.words = WORDS[self.business.language]


EnsureCustomer = Callable[[uuid.UUID, uuid.UUID], Awaitable[tuple[uuid.UUID, uuid.UUID]]]
Senders = Callable[[uuid.UUID], Awaitable[WhatsAppSender | None]]


def _when(w: Words, day: str, time: str) -> str:
    return w.at(long_day(w.lang, day), time)


def _callback_label(w: Words, today: str, day: str, time: str) -> str:
    return w.todayAt(time) if day == today else w.tomorrowAt(time)


class BookingBot:
    def __init__(
        self,
        db: AsyncSession,
        senders: Senders,
        storage: StorageProvider,
        ensure_customer: EnsureCustomer,
        dispatch: Dispatch,
    ) -> None:
        self.db, self.senders, self.storage, self.ensure_customer = db, senders, storage, ensure_customer
        self.dispatch = dispatch
        self.appointments = AppointmentService(db)

    # ------------------------------------------------------------------ entry

    async def handle(self, business_id: uuid.UUID, msg: BotMessage, now: datetime | None = None) -> str:
        now = now or datetime.now(UTC)
        number = (
            await self.db.execute(
                select(WhatsAppNumber)
                .where(WhatsAppNumber.business_id == business_id, WhatsAppNumber.phone == msg.from_)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        # Personal numbers, and customers the owner paused the bot for, never get an automatic reply.
        if not number or number.status == WhatsAppNumberStatus.PERSONAL or number.bot_paused:
            return "none"
        b = (
            await self.db.execute(
                select(Business).where(Business.id == business_id).execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if not b:
            return "none"
        replies = {
            "name": b.name,
            "auto_reply_text": b.whatsapp_auto_reply_text,
            "statuses": b.whatsapp_statuses,
            "active": b.whatsapp_active_status,
            "language": b.language,
        }
        mode = ar.mode_of(b.whatsapp_reply_mode)
        if mode == "off":
            return "none"
        chat = await self._chat_for(business_id, number, now, any_mode=True)
        if not chat:
            return "none"
        choice = msg.reply_id if msg.reply_id and CHOICE.fullmatch(msg.reply_id) else None
        text = with_hebrew_layout(msg.body)

        session = chat.session
        if session and session.expires_at <= now:
            await self._drop_session(chat.number_id)
            session = chat.session = None
        # D-165, both modes: the customer chose when to talk, or wrote it after "another time".
        if choice and choice.startswith("cb:"):
            return await self._on_callback_choice(chat, choice[3:], now)
        if session and session.step == "callback" and not choice and msg.body.strip():
            return await self._call_back(chat, msg.body.strip()[:80], now, False)

        # D-166: one automatic answer.
        if mode == "auto_reply":
            if await self._team_is_talking(chat.number_id, now):
                return "none"
            if session and session.step == "ev_q":
                return await (self._repeat_question(chat) if choice else self._on_answer(chat, msg.body))
            await self._answer(chat, replies, now, False)
            return "none"
        # D-154: every message gets an answer, also after "talk to the team".
        if (
            session
            and session.step == "handoff"
            and (choice == "book" or not await self._team_is_talking(chat.number_id, now))
        ):
            await self._drop_session(chat.number_id)
            session = chat.session = None
        # D-153: the customer cancels a booked appointment.
        if choice and (choice.startswith("xcl") or choice.startswith("xpick")):
            return await self._on_cancel_choice(chat, choice, now)
        if (not session or session.step == "handoff") and not choice and CANCEL_TEXT.search(text):
            if await self._team_is_talking(chat.number_id, now):
                return "none"
            return await self._ask_cancel(chat, now)
        if session and session.step == "handoff":
            return "none"
        if choice == "showcase":
            await self._showcase(chat, force=True, offer_booking=True)
            return "handled"
        if choice == "book":
            return await self._start(chat, now)

        if not session:
            if await self._team_is_talking(chat.number_id, now):
                return "none"
            if choice == "human" or (not choice and HUMAN_TEXT.search(text)):
                return await self._handoff(chat, now, self._text(chat, "handoff"))
            status_on = (
                ar.active_of(
                    replies["active"],
                    ar.statuses_of(replies["statuses"], ar.language_of(replies["language"])),
                    now,
                )
                is not None
            )
            if not choice and not status_on and BOOK_TEXT.search(text):
                return await self._start(chat, now)
            return await self._answer(chat, replies, now, True)

        if choice == "human" or (not choice and HUMAN_TEXT.search(text)):
            return await self._handoff(chat, now, self._text(chat, "handoff"))
        if choice == "cancel" or (not choice and CANCEL_TEXT.search(text)):
            await self._drop_session(chat.number_id)
            await self._say(
                chat, chat.words.cancelledEvent if chat.business.flow == "event" else chat.words.cancelled
            )
            await self._showcase(chat, offer_booking=True)
            return "handled"
        if session.step == "ev_q":
            return await (self._repeat_question(chat) if choice else self._on_answer(chat, msg.body))
        if chat.business.flow == "event":
            return await self._on_event(chat, choice, msg.body, now)
        if choice and choice.startswith("svc:"):
            return await self._pick_service(chat, choice[4:], now)
        if choice and choice.startswith("day:"):
            return await self._ask_time(chat, choice[4:], now)
        if choice and choice.startswith("time:") and session.date:
            return await self._ask_confirm(chat, session.date, choice[5:])
        if choice == "other_day":
            return await self._ask_day(chat, session.service_id, now)
        if choice == "other_time" and session.date:
            return await self._ask_time(chat, session.date, now)
        if choice == "ok" and session.step == "confirm" and session.date and session.time:
            return await self._book(chat, session.date, session.time, now)
        return await self._repeat(chat, now)

    # ------------------------------------------------------------- when to talk (D-165)

    async def _answer(self, chat: Chat, replies: dict[str, Any], now: datetime, with_booking: bool) -> str:
        """The automatic answer (D-165, D-166): every message gets the status's or the general
        message with "when can we talk?" (and "Book now" when customers book)."""
        text = ar.reply_text_of(
            replies["name"],
            replies["auto_reply_text"],
            replies["statuses"],
            replies["active"],
            replies["language"],
            now,
        )
        if chat.business.questions:
            await self._say(chat, text)
            return await self._ask_question(chat, [])
        await self._say(chat, text, choices=await self._talk_choices(chat, now, with_booking))
        return "handled"

    async def _talk_choices(self, chat: Chat, now: datetime, with_booking: bool) -> dict[str, Any]:
        """ "When can we talk?" without hours the owner is already busy (D-171)."""
        owner = await self._owner_of(chat.business.id)
        busy: list[tuple[datetime, datetime]] = []
        if owner:
            rows = await self.db.execute(
                select(Appointment.starts_at, Appointment.ends_at).where(
                    Appointment.business_id == chat.business.id,
                    Appointment.staff_id == owner,
                    Appointment.status.in_([AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED]),
                    Appointment.starts_at < now + timedelta(days=3),
                    Appointment.ends_at > now,
                )
            )
            busy = [(r[0], r[1]) for r in rows]
        today, slots = self._callback_slots(chat.business.timezone, now, busy)
        w = chat.words
        return {
            "button": w.talkButton,
            "rows": [
                *(WhatsAppChoice(f"cb:{d}T{t}", _callback_label(w, today, d, t)) for d, t, _ in slots),
                WhatsAppChoice("cb:other", w.anotherTime),
                *([WhatsAppChoice("book", w.bookButton)] if with_booking else []),
            ],
        }

    @staticmethod
    def _callback_slots(tz: str, now: datetime, busy: list[tuple[datetime, datetime]]):
        """The next whole hours from an hour from now, within the window, today and tomorrow."""
        today = today_in(tz, now)
        slots: list[tuple[str, str, datetime]] = []
        for day in (today, add_days_to(today, 1)):
            for h in range(CALLBACK_FIRST_HOUR, CALLBACK_LAST_HOUR + 1):
                time = f"{h:02d}:00"
                at = zoned_time_to_utc(day, time, tz)
                if (at - now).total_seconds() < 3600:
                    continue
                end = at + timedelta(minutes=CALL_BACK_MINUTES)
                if any(s < end and e > at for s, e in busy):
                    continue  # the owner already has something then (D-171)
                slots.append((day, time, at))
                if len(slots) == CALLBACK_SLOTS:
                    return today, slots
        return today, slots

    async def _owner_of(self, business_id: uuid.UUID) -> uuid.UUID | None:
        return (
            await self.db.execute(
                select(Membership.user_id)
                .where(
                    Membership.business_id == business_id,
                    Membership.role == MembershipRole.OWNER,
                    Membership.status == MembershipStatus.ACTIVE,
                )
                .order_by(Membership.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _on_callback_choice(self, chat: Chat, slot: str, now: datetime) -> str:
        if slot == "other":
            await self._set_session(chat, "callback")
            await self._say(chat, chat.words.askOtherTime)
            return "handled"
        m = CALLBACK.match(slot)
        tz = chat.business.timezone
        at = zoned_time_to_utc(m[1], m[2], tz) if m else None
        # An old list tapped later: a time that has passed is asked again.
        if not m or at is None or at <= now:
            await self._say(chat, chat.words.askOtherTime)
            await self._set_session(chat, "callback")
            return "handled"
        when = _callback_label(chat.words, today_in(tz, now), m[1], m[2])
        return await self._call_back(chat, when, at, True)

    async def _call_back(self, chat: Chat, when: str, due_at: datetime, chosen: bool) -> str:
        """Files the customer, gives the owner a task to call back at that time, confirms, then
        sends "A peek at the business"."""
        w = chat.words
        try:
            contact_id, lead_id = await self.ensure_customer(chat.business.id, chat.number_id)
            name = (
                await self.db.execute(select(Contact.name).where(Contact.id == contact_id))
            ).scalar_one_or_none()
            owner = await self._owner_of(chat.business.id)
            if owner:
                if chosen:  # a chosen hour goes into the calendar too (D-171)
                    await self.appointments.call_back_from_whatsapp(
                        chat.business.id, contact_id, lead_id, owner, due_at, w.callbackNote
                    )
                now = now_ms()
                self.db.add(
                    Task(
                        id=uuid.uuid4(),
                        business_id=chat.business.id,
                        title=w.callbackTask(name or chat.phone, when)[:200],
                        due_at=due_at,
                        assignee_id=owner,
                        lead_id=lead_id,
                        created_at=now,
                        updated_at=now,
                    )
                )
            await self.db.execute(
                delete(WhatsAppBotSession).where(WhatsAppBotSession.number_id == chat.number_id)
            )
            await self.db.commit()
        except AppError as err:
            await self.db.rollback()
            if err.code == "CONFLICT":  # someone took that hour a moment ago: offer the others
                await self._say(
                    chat,
                    f"{w.timeTaken}{w.talkButton}",
                    choices=await self._talk_choices(chat, chat.now, False),
                )
                return "handled"
            raise
        except Exception:
            await self.db.rollback()
            raise
        chat.link = {"contactId": contact_id, "leadId": lead_id}
        chat.session = None
        await self._say(chat, w.callbackSet(when) if chosen else w.callbackThanks)
        await self._showcase(chat, force=True)  # the decision is made: "A peek" right after (D-168)
        return "handled"

    # ------------------------------------------------------------------ steps

    async def _start(self, chat: Chat, now: datetime) -> str:
        if chat.business.flow == "event":
            return await self._ask_how_to_help(chat)
        services = await self._active_services(chat.business.id)
        if len(services) == 1:
            return await self._ask_day(chat, services[0]["id"], now)
        if not services:
            return await self._ask_day(chat, None, now)
        return await self._ask_service(chat)

    async def _ask_service(self, chat: Chat, prefix: str = "") -> str:
        services = await self._active_services(chat.business.id)
        await self._set_session(chat, "service")
        extra = [self._see_our_work(chat)] if self._has_showcase(chat) else []
        w = chat.words
        await self._say(
            chat,
            f"{prefix}{self._text(chat, 'greeting')}",
            choices={
                "button": w.chooseService,
                "rows": [
                    *(
                        WhatsAppChoice(
                            f"svc:{s['id']}",
                            s["name"],
                            " · ".join(
                                x
                                for x in (
                                    w.minutes(s["duration"]),
                                    f"₪{s['price']}" if s["price"] is not None else None,
                                )
                                if x
                            ),
                        )
                        for s in services[: MAX_ROWS - len(extra)]
                    ),
                    *extra,
                    self._human(chat),
                ],
            },
        )
        return "handled"

    async def _pick_service(self, chat: Chat, service_id: str, now: datetime) -> str:
        found = next(
            (s for s in await self._active_services(chat.business.id) if str(s["id"]) == service_id), None
        )
        if not found:
            return await self._ask_service(chat, chat.words.serviceGone)
        return await self._ask_day(chat, found["id"], now)

    def _info(self, chat: Chat) -> BusinessInfo:
        return BusinessInfo(chat.business.id, chat.business.timezone, chat.business.opening_hours)

    async def _ask_day(
        self, chat: Chat, service_id: uuid.UUID | None, now: datetime, prefix: str = ""
    ) -> str:
        today = today_in(chat.business.timezone, now)
        dates = [add_days_to(today, i) for i in range(DAYS_AHEAD)]
        free = await free_times(
            self.db, self._info(chat), dates, await self._duration(chat.business.id, service_id), now
        )
        # The first list of the conversation (when services were skipped) offers the showcase too.
        extra = [self._see_our_work(chat)] if not chat.session and self._has_showcase(chat) else []
        days = [d for d in dates if free[d]][: MAX_ROWS - len(extra)]
        if not days:
            return await self._handoff(chat, now, self._text(chat, "noTimes"), offer_booking=False)
        await self._set_session(chat, "day", service_id=service_id)
        tomorrow = add_days_to(today, 1)
        w = chat.words
        rows = []
        for d in days:
            label = short_day(w.lang, d)
            title = w.today(label) if d == today else w.tomorrow(label) if d == tomorrow else label
            rows.append(WhatsAppChoice(f"day:{d}", title, w.freeTimes(len(free[d]))))
        await self._say(
            chat,
            f"{prefix}{w.whichDay}",
            choices={"button": w.chooseDay, "rows": [*rows, *extra, self._human(chat)]},
        )
        return "handled"

    async def _ask_time(self, chat: Chat, day: str, now: datetime, prefix: str = "") -> str:
        service_id = chat.session.service_id if chat.session else None
        today = today_in(chat.business.timezone, now)
        if day < today or day > add_days_to(today, DAYS_AHEAD):
            return await self._ask_day(chat, service_id, now)
        times = await self._times_on(chat, day, service_id, now)
        if not times:
            return await self._ask_day(chat, service_id, now, chat.words.dayFull)
        await self._set_session(chat, "time", service_id=service_id, date=day)
        w = chat.words
        await self._say(
            chat,
            f"{prefix}{w.whichTime(long_day(w.lang, day))}",
            choices={
                "button": w.chooseTime,
                "rows": [
                    *(WhatsAppChoice(f"time:{t.time}", t.time) for t in spread(times, MAX_ROWS)),
                    WhatsAppChoice("other_day", w.otherDay),
                ],
            },
        )
        return "handled"

    async def _ask_confirm(self, chat: Chat, day: str, time: str) -> str:
        service_id = chat.session.service_id if chat.session else None
        service = await self._service_by_id(chat.business.id, service_id) if service_id else None
        await self._set_session(chat, "confirm", service_id=service_id, date=day, time=time)
        w = chat.words
        await self._say(
            chat,
            w.confirm(service["name"] if service else w.appointment, _when(w, day, time)),
            buttons=[
                WhatsAppChoice("ok", w.yesBook),
                WhatsAppChoice("other_time", w.otherTime),
                WhatsAppChoice("cancel", w.cancel),
            ],
        )
        return "handled"

    async def _book(self, chat: Chat, day: str, time: str, now: datetime) -> str:
        business = chat.business
        service_id = chat.session.service_id if chat.session else None
        service = await self._service_by_id(business.id, service_id) if service_id else None
        duration = service["duration"] if service else DEFAULT_DURATION
        slot = next((t for t in await self._times_on(chat, day, service_id, now) if t.time == time), None)
        taken = chat.words.timeTaken
        if not slot:
            return await self._ask_time(chat, day, now, taken)
        try:
            contact_id, lead_id = await self.ensure_customer(business.id, chat.number_id)
            await self.appointments.book_from_whatsapp(
                business.id,
                contact_id,
                lead_id,
                service["id"] if service else None,
                service["name"] if service else None,
                slot.staff_id,
                slot.starts_at,
                duration,
                business.auto_confirm,
            )
            await self.db.execute(
                delete(WhatsAppBotSession).where(WhatsAppBotSession.number_id == chat.number_id)
            )
            await self.db.commit()
        except AppError as err:
            await self.db.rollback()
            if err.code == "CONFLICT":
                return await self._ask_time(chat, day, now, taken)
            raise
        except Exception:
            await self.db.rollback()
            raise
        chat.link = {"contactId": contact_id, "leadId": lead_id}
        chat.session = None
        at = _when(chat.words, day, time)
        await self._say(
            chat,
            self._text(
                chat,
                "confirmed" if business.auto_confirm else "pending",
                service=service["name"] if service else None,
                when=at,
            ),
        )
        name = (
            await self.db.execute(select(Contact.name).where(Contact.id == contact_id))
        ).scalar_one_or_none()
        await notify_safe(
            self.db,
            business_id=business.id,
            type="appointment.booked",
            data={
                "leadId": str(lead_id),
                "name": name or chat.phone,
                "when": at,
                "pending": not business.auto_confirm,
            },
            roles=MANAGERS,
            user_ids=[slot.staff_id],
        )
        await self._showcase(chat, force=True)  # the decision is made (D-168)
        return "handled"

    async def _repeat(self, chat: Chat, now: datetime) -> str:
        """Anything that isn't one of the choices: ask the current question again."""
        s = chat.session
        assert s is not None
        if await self._missed_too_often(chat, now):
            return "handoff"
        prefix = chat.words.notUnderstood
        if s.step == "day":
            out = await self._ask_day(chat, s.service_id, now, prefix)
        elif s.step == "time" and s.date:
            out = await self._ask_time(chat, s.date, now, prefix)
        elif s.step == "confirm" and s.date and s.time:
            await self._say(chat, prefix.strip())
            out = await self._ask_confirm(chat, s.date, s.time)
        else:
            out = await self._ask_service(chat, prefix)
        await self._count_miss(chat)
        return out

    async def _missed_too_often(self, chat: Chat, now: datetime) -> bool:
        """After the second message the bot couldn't understand, a person is better (D-108)."""
        misses = (chat.session.data if chat.session else {}).get("misses", 0)
        if misses + 1 < MAX_MISSES:
            return False
        await self._handoff(chat, now, self._text(chat, "handoff"))
        return True

    async def _count_miss(self, chat: Chat) -> None:
        if not chat.session:
            return
        data = {**chat.session.data, "misses": chat.session.data.get("misses", 0) + 1}
        await self.db.execute(
            update(WhatsAppBotSession)
            .where(WhatsAppBotSession.id == chat.session.id)
            .values(data=data, updated_at=now_ms())
        )
        await self.db.commit()
        chat.session = await self._load_session(chat.number_id)

    async def _handoff(self, chat: Chat, now: datetime, text: str, offer_booking: bool = True) -> str:
        expires = now + timedelta(milliseconds=HANDOFF_MS)
        existing = await self._load_session(chat.number_id)
        if existing:
            await self.db.execute(
                update(WhatsAppBotSession)
                .where(WhatsAppBotSession.id == existing.id)
                .values(step="handoff", expires_at=expires, updated_at=now_ms())
            )
        else:
            t = now_ms()
            self.db.add(
                WhatsAppBotSession(
                    id=uuid.uuid4(),
                    business_id=chat.business.id,
                    number_id=chat.number_id,
                    step="handoff",
                    expires_at=expires,
                    created_at=t,
                    updated_at=t,
                )
            )
        await self.db.commit()
        chat.session = await self._load_session(chat.number_id)
        await self._say(chat, text)
        await self._showcase(chat, offer_booking=offer_booking)
        return "handoff"

    async def nudge_abandoned(self, now: datetime | None = None) -> int:
        """Conversations that stopped in the middle (no answer for 30 minutes) get the showcase
        once, while WhatsApp still allows a free-form message. Run by a background job."""
        now = now or datetime.now(UTC)
        stale = (
            await self.db.execute(
                select(
                    WhatsAppBotSession.id,
                    WhatsAppBotSession.business_id,
                    WhatsAppBotSession.number_id,
                    WhatsAppBotSession.updated_at,
                )
                .where(
                    WhatsAppBotSession.step.in_(OPEN_STEPS),
                    WhatsAppBotSession.updated_at < now - timedelta(milliseconds=ABANDONED_AFTER_MS),
                    WhatsAppBotSession.updated_at > now - timedelta(milliseconds=ABANDONED_UNTIL_MS),
                )
                .limit(100)
            )
        ).all()
        sent = 0
        for sid, business_id, number_id, updated in stale:
            # Claim it: a customer reply in the meantime (updated_at changes) keeps the conversation.
            res = await self.db.execute(
                delete(WhatsAppBotSession).where(
                    WhatsAppBotSession.id == sid, WhatsAppBotSession.updated_at == updated
                )
            )
            await self.db.commit()
            if not res.rowcount:
                continue
            number = (
                await self.db.execute(
                    select(WhatsAppNumber)
                    .where(WhatsAppNumber.id == number_id)
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if not number or number.status == WhatsAppNumberStatus.PERSONAL:
                continue
            chat = await self._chat_for(business_id, number, now)
            if not chat or await self._team_is_talking(number.id, now):
                continue
            if await self._showcase(chat, offer_booking=True):
                sent += 1
        return sent

    # ---------------------------------------------------------- event requests

    @staticmethod
    def _event_data(chat: Chat) -> dict[str, Any]:
        d = chat.session.data if chat.session else {}
        return {k: d[k] for k in ("type", "part", "guests", "area") if k in d}

    async def _on_event(self, chat: Chat, choice: str | None, body: str, now: datetime) -> str:
        s = chat.session
        assert s is not None
        if choice == "ev_start" or choice == "ev_edit":
            return await self._ask_event_type(chat)
        if choice and choice.startswith("evt:"):
            return await self._pick_event_type(chat, choice[4:])
        if choice == "other_date":
            return await self._ask_event_date(chat)
        if choice and choice.startswith("part:") and s.date:
            return await self._pick_part(chat, choice[5:])
        if choice and choice.startswith("guests:"):
            guests = chat.words.guests
            idx = int(choice[7:])
            if idx < len(guests):
                return await self._ask_area(chat, {**self._event_data(chat), "guests": guests[idx]})
        if choice == "ev_send" and s.step == "ev_confirm" and s.date:
            return await self._send_event(chat, s.date)
        # Typed answers: the date and the area.
        if not choice and s.step == "ev_date":
            return await self._on_event_date(chat, body, now)
        if not choice and s.step == "ev_area":
            area = re.sub(r"\s+", " ", body.strip())[:80]
            if len(area) >= 2:
                return await self._ask_event_confirm(chat, {**self._event_data(chat), "area": area})
            await self._say(chat, chat.words.whichAreaEvent)
            return "handled"
        return await self._repeat_event(chat)

    async def _ask_how_to_help(self, chat: Chat, prefix: str = "") -> str:
        """The first reply to an event business's customer (D-108): how can we help?"""
        await self._set_session(chat, "ev_intro")
        w = chat.words
        await self._say(
            chat,
            f"{prefix}{self._text(chat, 'greeting')}",
            buttons=[
                WhatsAppChoice("ev_start", w.checkDate),
                WhatsAppChoice("human", w.personalChat),
                *([self._see_our_work(chat)] if self._has_showcase(chat) else []),
            ],
        )
        return "handled"

    def _repeat_question(self, chat: Chat) -> Any:
        stored = (chat.session.data if chat.session else {}).get("answers")
        return self._ask_question(chat, [str(x) for x in stored] if isinstance(stored, list) else [])

    async def _ask_question(self, chat: Chat, answers: list[str]) -> str:
        """Asks the next of the owner's questions (the one after the answers so far)."""
        if len(answers) >= len(chat.business.questions):
            return await self._finish_questions(chat, answers)
        question = chat.business.questions[len(answers)]
        await self._set_session(chat, "ev_q", data={"answers": answers})
        await self._say(chat, question["text"])
        return "handled"

    async def _on_answer(self, chat: Chat, body: str) -> str:
        stored = (chat.session.data if chat.session else {}).get("answers")
        answers = [str(x) for x in stored] if isinstance(stored, list) else []
        answer = re.sub(r"\s+", " ", body.strip())[:300]
        if not answer:  # nothing to keep (an empty message): the same question again
            return await self._ask_question(chat, answers)
        return await self._ask_question(chat, [*answers, answer])

    async def _finish_questions(self, chat: Chat, answers: list[str]) -> str:
        """All answered: files the customer, gives the owner a task and a lead note with the
        answers, then asks when to talk."""
        w = chat.words
        lines = [
            f"{q['text']}\n{answers[i] if i < len(answers) else '—'}"
            for i, q in enumerate(chat.business.questions)
        ]
        try:
            contact_id, lead_id = await self.ensure_customer(chat.business.id, chat.number_id)
            name = (
                await self.db.execute(select(Contact.name).where(Contact.id == contact_id))
            ).scalar_one_or_none()
            owner = await self._owner_of(chat.business.id)
            now = now_ms()
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=chat.business.id,
                    lead_id=lead_id,
                    type="lead.note",
                    data={"text": f"{w.questionsNote}\n\n" + "\n\n".join(lines)[:2000]},
                    created_at=now,
                )
            )
            if owner:
                self.db.add(
                    Task(
                        id=uuid.uuid4(),
                        business_id=chat.business.id,
                        title=w.questionsTask(name or chat.phone)[:200],
                        notes="\n".join(lines)[:1000],
                        due_at=chat.now,
                        assignee_id=owner,
                        lead_id=lead_id,
                        created_at=now,
                        updated_at=now,
                    )
                )
            await self.db.execute(
                delete(WhatsAppBotSession).where(WhatsAppBotSession.number_id == chat.number_id)
            )
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        chat.link = {"contactId": contact_id, "leadId": lead_id}
        chat.session = None
        await self._say(chat, w.questionsThanks, choices=await self._talk_choices(chat, chat.now, False))
        return "handled"

    async def _ask_event_type(self, chat: Chat, prefix: str = "") -> str:
        services = await self._active_services(chat.business.id)
        extra = [self._see_our_work(chat)] if self._has_showcase(chat) else []
        w = chat.words
        if services:
            options = [
                WhatsAppChoice(
                    f"evt:svc:{sv['id']}",
                    sv["name"],
                    w.__getattr__("from")(sv["price"]) if sv["price"] is not None else None,
                )
                for sv in services
            ]
        else:
            options = [
                WhatsAppChoice(f"evt:t{i}", t)
                for i, t in enumerate(sw.event_types_for(chat.business.industry, chat.business.language))
            ]
        await self._set_session(chat, "ev_type", data={})
        question = sw.event_type_question_for(chat.business.industry, chat.business.language)
        await self._say(
            chat,
            f"{prefix}{question}",
            choices={
                "button": w.chooseType,
                "rows": [*options[: MAX_ROWS - len(extra)], *extra, self._human(chat)],
            },
        )
        return "handled"

    async def _pick_event_type(self, chat: Chat, id_: str) -> str:
        type_: str | None = None
        service_id: uuid.UUID | None = None
        if id_.startswith("svc:"):
            sv = next(
                (x for x in await self._active_services(chat.business.id) if str(x["id"]) == id_[4:]), None
            )
            type_, service_id = (sv["name"], sv["id"]) if sv else (None, None)
        else:
            types = sw.event_types_for(chat.business.industry, chat.business.language)
            idx = int(id_[1:]) if id_[1:].isdigit() else -1
            type_ = types[idx] if 0 <= idx < len(types) else None
        if not type_:
            return await self._ask_event_type(chat, chat.words.optionGone)
        await self._set_session(chat, "ev_date", service_id=service_id, data={"type": type_})
        return await self._ask_event_date(chat, chat.words.great(type_))

    async def _ask_event_date(self, chat: Chat, prefix: str = "") -> str:
        s = chat.session
        assert s is not None
        await self._set_session(chat, "ev_date", service_id=s.service_id, data=self._event_data(chat))
        await self._say(chat, f"{prefix}{chat.words.whichDate}", buttons=[self._human(chat)])
        return "handled"

    async def _on_event_date(self, chat: Chat, body: str, now: datetime) -> str:
        w = chat.words
        day = parse_event_date(body, today_in(chat.business.timezone, now))
        if not day:
            await self._say(chat, w.badDate)
            return "handled"
        if await self._date_taken(chat, day):
            await self._say(
                chat,
                self._text(chat, "dateTaken"),
                buttons=[WhatsAppChoice("other_date", w.otherDate), self._human(chat)],
            )
            return "handled"
        assert chat.session is not None
        await self._set_session(
            chat, "ev_part", service_id=chat.session.service_id, date=day, data=self._event_data(chat)
        )
        await self._say(
            chat,
            w.dateFree(event_day(w.lang, day)),
            buttons=[WhatsAppChoice(f"part:{k}", w.parts[k]) for k in PARTS],
        )
        return "handled"

    async def _pick_part(self, chat: Chat, part: str) -> str:
        if part not in PARTS:
            return await self._repeat_event(chat)
        data = {**self._event_data(chat), "part": part}
        if not sw.asks_guests(chat.business.industry):
            return await self._ask_area(chat, data)
        assert chat.session is not None
        await self._set_session(
            chat, "ev_guests", service_id=chat.session.service_id, date=chat.session.date, data=data
        )
        w = chat.words
        await self._say(
            chat,
            w.howManyGuests,
            choices={
                "button": w.guestsButton,
                "rows": [WhatsAppChoice(f"guests:{i}", g) for i, g in enumerate(w.guests)],
            },
        )
        return "handled"

    async def _ask_area(self, chat: Chat, data: dict[str, Any]) -> str:
        assert chat.session is not None
        await self._set_session(
            chat, "ev_area", service_id=chat.session.service_id, date=chat.session.date, data=data
        )
        await self._say(chat, chat.words.whichArea)
        return "handled"

    @staticmethod
    def _event_summary(w: Words, day: str, d: dict[str, Any]) -> list[str]:
        part = d.get("part")
        lines = [
            d.get("type") or "",
            f"{event_day(w.lang, day)}{', ' + w.parts[part] if part and part != 'unknown' else ''}",
            *([w.guestsLine(d["guests"])] if d.get("guests") else []),
            *([w.areaLine(d["area"])] if d.get("area") else []),
        ]
        return [x for x in lines if x]

    async def _ask_event_confirm(self, chat: Chat, data: dict[str, Any]) -> str:
        s = chat.session
        assert s is not None and s.date
        await self._set_session(chat, "ev_confirm", service_id=s.service_id, date=s.date, data=data)
        w = chat.words
        lines = [f"• {x}" for x in self._event_summary(w, s.date, data)]
        await self._say(
            chat,
            w.summary("\n".join(lines)),
            buttons=[
                WhatsAppChoice("ev_send", w.yesSend),
                WhatsAppChoice("ev_edit", w.change),
                WhatsAppChoice("cancel", w.cancel),
            ],
        )
        return "handled"

    async def _date_taken(self, chat: Chat, day: str) -> bool:
        """A date is taken when it already has as many held events as there are team members."""
        tz = chat.business.timezone
        statuses = (
            [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED]
            if chat.business.hold_date
            else [AppointmentStatus.CONFIRMED]
        )
        held = (
            await self.db.execute(
                select(func.count())
                .select_from(Appointment)
                .where(
                    Appointment.business_id == chat.business.id,
                    Appointment.status.in_(statuses),
                    Appointment.starts_at < zoned_time_to_utc(add_days_to(day, 1), "00:00", tz),
                    Appointment.ends_at > zoned_time_to_utc(day, "00:00", tz),
                )
            )
        ).scalar_one()
        team = (
            await self.db.execute(
                select(func.count())
                .select_from(Membership)
                .where(
                    Membership.business_id == chat.business.id, Membership.status == MembershipStatus.ACTIVE
                )
            )
        ).scalar_one()
        return held >= max(1, team)

    async def _send_event(self, chat: Chat, day: str) -> str:
        business = chat.business
        data = self._event_data(chat)
        w = chat.words
        if await self._date_taken(chat, day):
            await self._say(
                chat,
                self._text(chat, "dateTaken"),
                buttons=[WhatsAppChoice("other_date", w.otherDate), self._human(chat)],
            )
            return "handled"
        frm, to = PARTS[data.get("part") or "unknown"]
        try:
            contact_id, lead_id = await self.ensure_customer(business.id, chat.number_id)
            await self.appointments.request_event_from_whatsapp(
                business.id,
                contact_id,
                lead_id,
                chat.session.service_id if chat.session else None,
                zoned_time_to_utc(day, frm, business.timezone),
                zoned_time_to_utc(day, to, business.timezone),
                " · ".join([w.fromWhatsApp, *self._event_summary(w, day, data)]),
                data.get("type") or w.event,
            )
            await self.db.execute(
                delete(WhatsAppBotSession).where(WhatsAppBotSession.number_id == chat.number_id)
            )
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        chat.link = {"contactId": contact_id, "leadId": lead_id}
        chat.session = None
        await self._say(
            chat,
            self._text(
                chat, "eventReceived", service=data.get("type") or w.theEvent, when=event_day(w.lang, day)
            ),
        )
        name = (
            await self.db.execute(select(Contact.name).where(Contact.id == contact_id))
        ).scalar_one_or_none()
        await notify_safe(
            self.db,
            business_id=business.id,
            type="appointment.booked",
            data={
                "leadId": str(lead_id),
                "name": name or chat.phone,
                "when": f"{data.get('type') or w.event} · {event_day(w.lang, day)}",
                "pending": True,
            },
            roles=MANAGERS,
        )
        await self._showcase(chat, force=True)
        return "handled"

    async def _repeat_event(self, chat: Chat) -> str:
        """Not one of the choices: ask the current question of the event request again."""
        s = chat.session
        assert s is not None
        if await self._missed_too_often(chat, chat.now):
            return "handoff"
        prefix = chat.words.notUnderstoodEvent
        data = self._event_data(chat)
        if s.step == "ev_intro":
            out = await self._ask_how_to_help(chat, prefix)
        elif s.step == "ev_part" and s.date:
            await self._say(chat, prefix.strip())
            chat.session = replace(s, step="ev_date")
            out = await self._on_event_date(chat, ".".join(reversed(s.date.split("-"))), chat.now)
        elif s.step == "ev_guests":
            out = await self._pick_part(chat, data.get("part") or "unknown")
        elif s.step == "ev_confirm":
            out = await self._ask_event_confirm(chat, data)
        else:
            out = await self._ask_event_type(chat, prefix)
        await self._count_miss(chat)
        return out

    # -------------------------------------------------------------- showcase

    @staticmethod
    def _has_showcase(chat: Chat) -> bool:
        return bool(chat.business.showcase.get("enabled"))

    async def _showcase(self, chat: Chat, force: bool = False, offer_booking: bool = False) -> bool:
        """ "In the meantime, take a look" (D-106): the message with its link, the video, up to 3
        photos, and a "book" button. At most once a day per customer unless asked for."""
        sc = chat.business.showcase
        if not sc.get("enabled"):
            return False
        if (
            not force
            and chat.showcase_at
            and (chat.now - chat.showcase_at).total_seconds() * 1000 < SHOWCASE_EVERY_MS
        ):
            return False
        w = chat.words
        text = sw.fill_bot_text(
            sc.get("text") or sw.showcase_default_text(chat.business.industry, chat.business.language),
            chat.business.name,
            w.appointment,
            "",
        )
        await self._say(
            chat, f"{text}\n{sc['link']}" if sc.get("link") else text, preview=bool(sc.get("link"))
        )
        if chat.business.showcase_video:
            video = None
            try:
                video = await self.storage.get(chat.business.showcase_video)
            except Exception:
                video = None
            if video:
                await self._say_media(chat, "video", chat.business.showcase_video)
        ids = sc.get("assetIds") or []
        assets = {}
        if ids:
            rows = await self.db.execute(
                select(Asset.id, Asset.key).where(
                    Asset.id.in_([uuid.UUID(i) for i in ids]), Asset.business_id == chat.business.id
                )
            )
            assets = {str(r[0]): r[1] for r in rows}
        for id_ in ids:
            key = assets.get(id_)
            file = await self.storage.get(key) if key else None
            if not file:
                continue
            try:
                ar.to_whatsapp_jpeg(file)  # a photo that can't be converted is left out, as before
                await self._say_media(chat, "image", key)
            except Exception as err:
                log.error("whatsapp showcase image failed", extra={"errName": type(err).__name__})
        if offer_booking:
            await self._say(chat, w.bookHere, buttons=[WhatsAppChoice("book", w.bookButton)])
        chat.showcase_at = chat.now
        await self.db.execute(
            update(WhatsAppNumber).where(WhatsAppNumber.id == chat.number_id).values(bot_showcase_at=chat.now)
        )
        await self.db.commit()
        return True

    # ---------------------------------------------------------------- cancelling (D-153)

    async def _upcoming(self, chat: Chat, now: datetime) -> list[dict[str, Any]]:
        """The customer's upcoming bookings, soonest first."""
        contact_id = chat.link.get("contactId")
        if not contact_id:
            return []
        rows = (
            await self.db.execute(
                select(Appointment)
                .options(joinedload(Appointment.service))
                .where(
                    Appointment.business_id == chat.business.id,
                    Appointment.contact_id == contact_id,
                    Appointment.status.in_([AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED]),
                    Appointment.starts_at > now,
                )
                .order_by(Appointment.starts_at.asc())
                .limit(MAX_ROWS)
            )
        ).scalars()
        return [
            {"id": a.id, "starts_at": a.starts_at, "service": a.service.name if a.service else None}
            for a in rows
        ]

    def _at(self, chat: Chat, d: datetime) -> str:
        """ "Thursday, 12 November at 13:00" in the business's time zone and language."""
        tz = chat.business.timezone
        local = d.astimezone(ZoneInfo(tz))
        return _when(chat.words, date_in_zone(d, tz), local.strftime("%H:%M"))

    async def _ask_cancel(self, chat: Chat, now: datetime) -> str:
        w = chat.words
        items = await self._upcoming(chat, now)
        if not items:
            await self._say(
                chat, w.nothingToCancel, buttons=[WhatsAppChoice("book", w.bookButton), self._human(chat)]
            )
            return "handled"
        if len(items) == 1:
            return await self._confirm_cancel(chat, items[0])
        await self._say(
            chat,
            w.whichToCancel,
            choices={
                "button": w.chooseAppointment,
                "rows": [
                    WhatsAppChoice(
                        f"xpick:{a['id']}", a["service"] or w.appointment, self._at(chat, a["starts_at"])
                    )
                    for a in items
                ],
            },
        )
        return "handled"

    async def _confirm_cancel(self, chat: Chat, a: dict[str, Any]) -> str:
        w = chat.words
        await self._say(
            chat,
            w.confirmCancel(a["service"], self._at(chat, a["starts_at"])),
            buttons=[WhatsAppChoice(f"xcl:{a['id']}", w.yesCancel), WhatsAppChoice("xcl_no", w.keepIt)],
        )
        return "handled"

    async def _on_cancel_choice(self, chat: Chat, choice: str, now: datetime) -> str:
        w = chat.words
        if choice == "xcl_no":
            await self._say(chat, w.kept)
            return "handled"
        id_ = choice[choice.index(":") + 1 :]
        appt = next((a for a in await self._upcoming(chat, now) if str(a["id"]) == id_), None)
        if not appt:  # already cancelled or past: show what's left to cancel
            return await self._ask_cancel(chat, now)
        if choice.startswith("xpick:"):
            return await self._confirm_cancel(chat, appt)
        done = await self.appointments.cancel_from_whatsapp(
            chat.business.id, appt["id"], chat.link["contactId"]
        )
        if not done:
            return await self._ask_cancel(chat, now)
        await self._say(chat, w.apptCancelled, buttons=[WhatsAppChoice("book", w.bookNew)])
        name = (
            await self.db.execute(select(Contact.name).where(Contact.id == chat.link["contactId"]))
        ).scalar_one_or_none()
        await notify_safe(
            self.db,
            business_id=chat.business.id,
            type="appointment.cancelled",
            data={
                "leadId": str(done["leadId"]) if done["leadId"] else None,
                "name": name or chat.phone,
                "when": f"{appt['service'] or w.appointment} · {self._at(chat, appt['starts_at'])}",
            },
            roles=MANAGERS,
            user_ids=[done["staffId"]],
        )
        return "handled"

    # ---------------------------------------------------------------- helpers

    async def _chat_for(
        self, business_id: uuid.UUID, number: WhatsAppNumber, now: datetime, any_mode: bool = False
    ) -> Chat | None:
        """Everything the bot needs about this business and chat; None when the bot is off."""
        b = (
            await self.db.execute(
                select(Business).where(Business.id == business_id).execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if not b or (not b.whatsapp_bot_enabled and not any_mode):
            return None
        sender = await self.senders(business_id)
        if not sender:
            return None
        flow = b.whatsapp_bot_flow if b.whatsapp_bot_flow in sw.BOT_FLOWS else sw.bot_flow_for(b.industry)
        showcase = sw.parse_showcase(b.whatsapp_bot_showcase) or sw.disabled_showcase()
        video = ar.showcase_video_of(b.whatsapp_bot_showcase)
        business = BotBusiness(
            id=b.id,
            name=b.name,
            industry=b.industry,
            language=ar.language_of(b.language),
            timezone=b.timezone,
            opening_hours=b.opening_hours,
            auto_confirm=b.whatsapp_bot_auto_confirm,
            texts=sw.parse_bot_texts(b.whatsapp_bot_texts),
            showcase=showcase,
            showcase_video=video["key"] if video else None,
            flow=flow,
            hold_date=b.whatsapp_bot_hold_date,
            # Switched off (D-198): the written questions stay saved, but none is asked.
            questions=ar.questions_of(b.whatsapp_questions) if b.whatsapp_questions_enabled else [],
        )
        return Chat(
            business=business,
            sender=sender,
            number_id=number.id,
            phone=number.phone,
            showcase_at=number.bot_showcase_at,
            link=await self._link_of(business_id, number.status, number.phone),
            session=await self._load_session(number.id),
            now=now,
        )

    def _text(self, chat: Chat, key: str, service: str | None = None, when: str | None = None) -> str:
        """The business's wording for a message, or the default, with the placeholders filled in."""
        template = (
            chat.business.texts.get(key)
            or sw.bot_default_texts_for(chat.business.industry, chat.business.language)[key]
        )
        return sw.fill_bot_text(template, chat.business.name, service or chat.words.appointment, when or "")

    @staticmethod
    def _human(chat: Chat) -> WhatsAppChoice:
        return WhatsAppChoice("human", chat.words.human)

    @staticmethod
    def _see_our_work(chat: Chat) -> WhatsAppChoice:
        return WhatsAppChoice("showcase", chat.words.seeOurWork)

    async def _load_session(self, number_id: uuid.UUID) -> Sess | None:
        row = (
            await self.db.execute(
                select(WhatsAppBotSession)
                .where(WhatsAppBotSession.number_id == number_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if not row:
            return None
        return Sess(
            id=row.id,
            step=row.step,
            service_id=row.service_id,
            date=row.date,
            time=row.time,
            data=dict(row.data) if isinstance(row.data, dict) else {},
            expires_at=row.expires_at,
            updated_at=row.updated_at,
        )

    async def _drop_session(self, number_id: uuid.UUID) -> None:
        await self.db.execute(delete(WhatsAppBotSession).where(WhatsAppBotSession.number_id == number_id))
        await self.db.commit()

    async def _set_session(
        self,
        chat: Chat,
        step: str,
        service_id: uuid.UUID | None = None,
        date: str | None = None,
        time: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        """Upserts the conversation's step; `data` is kept as it was when not given."""
        expires = chat.now + timedelta(milliseconds=SESSION_MS)
        existing = await self._load_session(chat.number_id)
        t = now_ms()
        if existing:
            values: dict[str, Any] = {
                "step": step,
                "service_id": service_id,
                "date": date,
                "time": time,
                "expires_at": expires,
                "updated_at": t,
            }
            if data is not None:
                values["data"] = data
            await self.db.execute(
                update(WhatsAppBotSession).where(WhatsAppBotSession.id == existing.id).values(**values)
            )
        else:
            self.db.add(
                WhatsAppBotSession(
                    id=uuid.uuid4(),
                    business_id=chat.business.id,
                    number_id=chat.number_id,
                    step=step,
                    service_id=service_id,
                    date=date,
                    time=time,
                    data=data,
                    expires_at=expires,
                    created_at=t,
                    updated_at=t,
                )
            )
        await self.db.commit()
        chat.session = await self._load_session(chat.number_id)

    async def _say(
        self,
        chat: Chat,
        body: str,
        choices: dict[str, Any] | None = None,
        buttons: list[WhatsAppChoice] | None = None,
        preview: bool = False,
    ) -> None:
        """Queues one bot message (no sender: it shows as an automatic reply). D-202: sent now
        (inline) or by the messaging worker, after the ones queued before it."""
        options = buttons if buttons is not None else (choices["rows"] if choices else [])
        if buttons is not None:
            payload: dict[str, Any] = {"kind": "buttons", "body": body, "buttons": choices_payload(buttons)}
        elif choices is not None:
            payload = {
                "kind": "list",
                "body": body,
                "button": choices["button"],
                "rows": choices_payload(choices["rows"]),
            }
        else:
            payload = {"kind": "text", "text": body, "preview": preview}
        stored = "\n".join([body, *(f"• {o.title}" for o in options)])
        await self._queue(chat, stored[:4096], payload)

    async def _say_media(self, chat: Chat, kind: str, key: str) -> None:
        """Queues a video or photo from storage (shown as "[וידאו]" / "[תמונה]")."""
        await self._queue(chat, "[וידאו]" if kind == "video" else "[תמונה]", {"kind": kind, "key": key})

    async def _queue(self, chat: Chat, body: str, payload: dict[str, Any]) -> None:
        queue_message(
            self.db,
            business_id=chat.business.id,
            number_id=chat.number_id,
            contact_id=chat.link.get("contactId"),
            lead_id=chat.link.get("leadId"),
            body=body,
            payload=payload,
        )
        await self.db.commit()
        await self.dispatch(chat.number_id)

    async def _link_of(self, business_id: uuid.UUID, status: Any, phone: str) -> dict[str, uuid.UUID | None]:
        if status != WhatsAppNumberStatus.BUSINESS:
            return {"contactId": None, "leadId": None}
        contact_id = (
            await self.db.execute(
                select(Contact.id)
                .where(Contact.business_id == business_id, Contact.phone == phone)
                .order_by(Contact.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        lead_id = None
        if contact_id:
            lead_id = (
                await self.db.execute(
                    select(Lead.id)
                    .where(
                        Lead.business_id == business_id,
                        Lead.contact_id == contact_id,
                        Lead.stage.has(kind="OPEN"),
                    )
                    .order_by(Lead.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        return {"contactId": contact_id, "leadId": lead_id}

    async def _team_is_talking(self, number_id: uuid.UUID, now: datetime) -> bool:
        """A team member wrote in this chat recently: the bot doesn't interrupt."""
        recent = (
            await self.db.execute(
                select(WhatsAppMessage.id)
                .where(
                    WhatsAppMessage.number_id == number_id,
                    WhatsAppMessage.direction == WhatsAppDirection.OUT,
                    WhatsAppMessage.sender_id.is_not(None),
                    WhatsAppMessage.created_at > now - timedelta(milliseconds=HANDOFF_MS),
                )
                .limit(1)
            )
        ).first()
        return recent is not None

    async def _active_services(self, business_id: uuid.UUID) -> list[dict[str, Any]]:
        rows = (
            await self.db.execute(
                select(Service)
                .where(Service.business_id == business_id, Service.active.is_(True))
                .order_by(Service.name.asc())
            )
        ).scalars()
        return [{"id": s.id, "name": s.name, "duration": s.duration_min, "price": s.price} for s in rows]

    async def _service_by_id(self, business_id: uuid.UUID, id_: uuid.UUID) -> dict[str, Any] | None:
        s = (
            await self.db.execute(
                select(Service).where(
                    Service.id == id_, Service.business_id == business_id, Service.active.is_(True)
                )
            )
        ).scalar_one_or_none()
        return {"id": s.id, "name": s.name, "duration": s.duration_min} if s else None

    async def _duration(self, business_id: uuid.UUID, service_id: uuid.UUID | None) -> int:
        s = await self._service_by_id(business_id, service_id) if service_id else None
        return s["duration"] if s else DEFAULT_DURATION

    async def _times_on(self, chat: Chat, day: str, service_id: uuid.UUID | None, now: datetime):
        free = await free_times(
            self.db, self._info(chat), [day], await self._duration(chat.business.id, service_id), now
        )
        return free[day]
