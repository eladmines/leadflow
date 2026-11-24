"""F12/F23/F24/F27/F29: customer messages from WhatsApp, Facebook, Instagram and email become leads;
the team replies from the lead or the inbox. Port of apps/api/src/modules/whatsapp/service.ts
(messaging half; the booking bot and its settings are ported separately).
"""

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from html import escape
from typing import Any, Literal

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.core.timeutil import iso, now_ms
from app.db.models import (
    Activity,
    Business,
    ChannelConnection,
    Contact,
    Lead,
    LeadSource,
    WhatsAppBotSession,
    WhatsAppDirection,
    WhatsAppMessage,
    WhatsAppNumber,
    WhatsAppNumberStatus,
)
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.gmail import GmailApi, GmailMessage, GmailOutgoing
from app.integrations.messenger import MessengerSender
from app.integrations.storage import StorageProvider
from app.integrations.whatsapp import WhatsAppSender
from app.modules.audit import add_audit
from app.modules.channels.registry import ChannelRegistry
from app.modules.leads.service import LeadService, attribution_columns, ensure_stages
from app.modules.notifications.service import MANAGERS, notify_safe
from app.modules.whatsapp import auto_reply as ar
from app.modules.whatsapp import schemas as s
from app.modules.whatsapp.bot import BookingBot, BotMessage
from app.shared import whatsapp as sw
from app.shared.attribution import parse_attribution
from app.shared.phone import format_israeli_phone

log = logging.getLogger("simplecatch")
M = s.M

STATUS_RANK = {"received": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 4}
INBOX_MESSAGES = 20
EMAIL_PREFIX = "mail:"
FACEBOOK_USER = "משתמש/ת פייסבוק"
INSTAGRAM_USER = "משתמש/ת אינסטגרם"
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)


def psid_of(address: str) -> str:
    """Messenger senders are stored as `fb:<psid>` (F23), Instagram ones as `ig:<id>` (F28)."""
    return address[address.find(":") + 1 :]


def is_social(channel: str | None) -> bool:
    return channel in ("messenger", "instagram")


def address_of(address: str) -> str:
    return address[len(EMAIL_PREFIX) :]


def social_user(channel: str | None) -> str:
    return INSTAGRAM_USER if channel == "instagram" else FACEBOOK_USER


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


def stored_mail_id(message_id: str) -> str:
    """A message id that fits the column: kept as is when short, else hashed."""
    return f"m:{message_id}" if len(message_id) <= 120 else f"h:{_sha1(message_id)}"


def quoted_mail_id(stored: str) -> str | None:
    return stored[2:] if stored.startswith(("m:", "g:")) else None


def stored_gmail_id(mail: GmailMessage) -> str:
    if not mail.message_id:
        return f"gi:{mail.id}"
    return f"g:{mail.message_id}" if len(mail.message_id) <= 120 else f"gh:{_sha1(mail.message_id)}"


def is_gmail_id(stored: str) -> bool:
    return bool(re.match(r"^(g|gh|gi):", stored))


_WROTE = re.compile(r"^(on .+ wrote:|ב-.+(כתב|כתבה)[^:]*:)\s*$", re.I)


def clean_email_text(text: str) -> str:
    """Quoted earlier messages (`>` lines and "On … wrote:") are cut; what is new stays."""
    out: list[str] = []
    for line in re.sub(r"\r\n?", "\n", text).split("\n"):
        if re.match(r"^\s*>", line):
            continue
        if _WROTE.match(line.strip()):
            break
        out.append(line)
    return "\n".join(out).strip()


def mail_name(address: str) -> str:
    return address.split("@")[0][:80]


def to_dto(row: WhatsAppMessage, channel: str | None = None) -> s.MessageOut:
    return s.MessageOut(
        id=str(row.id),
        direction=row.direction.value,
        body=row.body,
        status=row.status if row.status in s.WHATSAPP_STATUSES else "sent",
        subject=row.subject or None,
        sender=s.Sender(id=str(row.sender.id), name=row.sender.full_name) if row.sender else None,
        createdAt=iso(row.created_at),
        channel=channel if (is_social(channel) or channel == "email") else None,
    )


@dataclass
class InboundMessage:
    """A customer message from Meta's webhook (or mail), already normalised."""

    waMessageId: str
    from_: str  # WhatsApp: E.164. Messenger/Instagram: `fb:`/`ig:` + id. Email: `mail:` + address.
    body: str
    receivedAt: datetime
    to: str | None = None  # Meta's phone number id / Page id it was sent to (F25 routing)
    channel: str = "whatsapp"
    profileName: str | None = None
    subject: str | None = None
    holdUntilApproved: bool = False  # Gmail: a new sender waits to be marked business or personal
    replyId: str | None = None  # id of the tapped button or list row
    attribution: dict[str, Any] | None = None  # F26: the Meta ad the customer tapped


@dataclass
class ReceiveResult:
    kind: Literal["lead", "inbox", "ignored"]
    leadId: uuid.UUID | None = None
    created: bool = False
    numberId: uuid.UUID | None = None
    isNew: bool = False


class WhatsAppService:
    def __init__(
        self,
        db: AsyncSession,
        settings: Settings,
        whatsapp: WhatsAppSender,
        messenger: MessengerSender,
        email: EmailSender,
        gmail: GmailApi,
        storage: StorageProvider,
    ) -> None:
        self.db, self.settings, self.email, self.gmail = db, settings, email, gmail
        self.leads = LeadService(db)
        self.channels = ChannelRegistry(db, settings, whatsapp, messenger)
        self.storage = storage
        self.bot = BookingBot(db, self.channels.whatsapp, storage, self.ensure_customer)

    async def connected_to(self, business_id: uuid.UUID) -> bool:
        return await self.channels.is_connected(business_id)

    # -- incoming ----------------------------------------------------------------------------

    async def _number(self, business_id: uuid.UUID, phone: str) -> WhatsAppNumber | None:
        return (
            await self.db.execute(
                select(WhatsAppNumber)
                .where(WhatsAppNumber.business_id == business_id, WhatsAppNumber.phone == phone)
                .execution_options(populate_existing=True)  # never a stale copy (long-lived sessions)
            )
        ).scalar_one_or_none()

    async def _message_seen(self, wa_message_id: str) -> bool:
        return (
            await self.db.execute(
                select(WhatsAppMessage.id).where(WhatsAppMessage.wa_message_id == wa_message_id)
            )
        ).first() is not None

    async def _open_lead_of(self, business_id: uuid.UUID, contact_id: uuid.UUID | None) -> uuid.UUID | None:
        if not contact_id:
            return None
        return (
            await self.db.execute(
                select(Lead.id)
                .where(Lead.business_id == business_id, Lead.contact_id == contact_id)
                .order_by(Lead.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def receive_echo(
        self,
        *,
        page_id: str,
        customer: str,
        wa_message_id: str,
        body: str,
        sent_at: datetime,
        channel: str = "messenger",
    ) -> None:
        """A message the business sent from its Page itself (Meta's "echo"), so the conversation
        shows both sides. Only into a conversation that already exists."""
        business_id = await self.channels.business_for(channel, page_id)
        if not business_id or await self._message_seen(wa_message_id):
            return
        number = await self._number(business_id, customer)
        if not number or number.status != WhatsAppNumberStatus.BUSINESS:
            return
        try:
            self.db.add(
                WhatsAppMessage(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    number_id=number.id,
                    contact_id=number.contact_id,
                    lead_id=await self._open_lead_of(business_id, number.contact_id),
                    direction=WhatsAppDirection.OUT,
                    wa_message_id=wa_message_id,
                    body=body[:4096],
                    status="sent",
                    created_at=sent_at,
                )
            )
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()  # Meta delivered it twice at once: the first one is stored

    async def receive(
        self, msg: InboundMessage, known_business_id: uuid.UUID | None = None
    ) -> ReceiveResult | None:
        """Routes an incoming message by what the business decided about the sender's number:
        business → the contact's open lead (or a new lead); personal → dropped; unknown → a known
        contact is business automatically, otherwise it waits in the inbox. Retries are ignored by
        message id."""
        channel = msg.channel
        business_id = known_business_id or await self.channels.business_for(channel, msg.to)
        if not business_id:
            return None
        if await self._message_seen(msg.waMessageId):
            return None
        if is_social(channel) and not msg.profileName:
            known = await self._number(business_id, msg.from_)
            social = (
                None
                if known
                else await (self.channels.instagram if channel == "instagram" else self.channels.messenger)(
                    business_id
                )
            )
            if social:
                msg = replace(msg, profileName=await social.profile_name(psid_of(msg.from_)))
        try:
            result = await self._store(business_id, msg)
            await self.db.commit()
        except IntegrityError:
            # The same message (or two first messages from a new number) delivered at once.
            await self.db.rollback()
            return None
        bot = "none"
        if result.kind != "ignored" and channel == "whatsapp":
            bot = await self._run_bot(business_id, msg)
        await self._notify_received(business_id, result, msg, bot)
        return result

    async def _store(self, business_id: uuid.UUID, msg: InboundMessage) -> ReceiveResult:
        db = self.db
        number = await self._number(business_id, msg.from_)
        if number and number.status == WhatsAppNumberStatus.PERSONAL:
            return ReceiveResult("ignored")
        is_new = False
        now = now_ms()
        if number is None:
            # The number is the business's own: every sender is a customer (D-176), except where the
            # inbox is shared with private mail (Gmail): then the owner decides first.
            number = WhatsAppNumber(
                id=uuid.uuid4(),
                business_id=business_id,
                channel=msg.channel,
                phone=msg.from_,
                status=WhatsAppNumberStatus.UNCLASSIFIED
                if msg.holdUntilApproved
                else WhatsAppNumberStatus.BUSINESS,
                profile_name=(msg.profileName or "")[:80] or None if msg.holdUntilApproved else None,
                created_at=now,
                updated_at=now,
            )
            db.add(number)
            await db.flush()
            is_new = True
        if msg.attribution:  # a new ad click replaces an earlier one
            number.attribution = msg.attribution
            number.updated_at = now
        subject = msg.subject[:300] if msg.subject else None
        if number.status == WhatsAppNumberStatus.UNCLASSIFIED and msg.holdUntilApproved:
            db.add(
                WhatsAppMessage(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    number_id=number.id,
                    direction=WhatsAppDirection.IN,
                    wa_message_id=msg.waMessageId,
                    body=msg.body[:4096],
                    subject=subject,
                    status="received",
                    created_at=msg.receivedAt,
                )
            )
            await db.flush()
            return ReceiveResult("inbox", numberId=number.id, isNew=is_new)
        if number.status == WhatsAppNumberStatus.UNCLASSIFIED:
            await self._promote(business_id, number, None)  # waiting from before D-176
        contact_id, lead_id, created = await self._attach_to_lead(
            business_id, number, msg.profileName, msg.body
        )
        db.add(
            WhatsAppMessage(
                id=uuid.uuid4(),
                business_id=business_id,
                number_id=number.id,
                contact_id=contact_id,
                lead_id=lead_id,
                direction=WhatsAppDirection.IN,
                wa_message_id=msg.waMessageId,
                body=msg.body[:4096],
                subject=subject,
                status="received",
                created_at=msg.receivedAt,
            )
        )
        await db.flush()
        return ReceiveResult("lead", leadId=lead_id, created=created)

    async def receive_email(self, mail: s.EmailInbound) -> ReceiveResult | None:
        """F27: an email to a business's forwarding address (already verified and parsed)."""
        domain = self.settings.EMAIL_INBOUND_DOMAIN
        if mail.autoSubmitted or mail.from_ == mail.to:
            return None
        if domain and mail.from_.endswith(f"@{domain}"):
            return None
        subject = re.sub(r"[\r\n]+", " ", mail.subject).strip()
        text = clean_email_text(mail.text)
        received = (
            datetime.fromisoformat(mail.receivedAt.replace("Z", "+00:00")) if mail.receivedAt else now_ms()
        )
        return await self.receive(
            InboundMessage(
                channel="email",
                to=mail.to,
                waMessageId=stored_mail_id(mail.messageId),
                from_=f"{EMAIL_PREFIX}{mail.from_}",
                profileName=(mail.fromName or "").strip()[:80] or None,
                body=text or subject or "[מייל ללא טקסט]",
                subject=subject,
                receivedAt=received,
            )
        )

    async def receive_gmail(self, business_id: uuid.UUID, mail: GmailMessage) -> ReceiveResult | None:
        """F29: one message from a business's connected Gmail inbox. The sender waits to be marked
        business or personal."""
        text = clean_email_text(mail.text)
        subject = re.sub(r"[\r\n]+", " ", mail.subject).strip()
        return await self.receive(
            InboundMessage(
                channel="email",
                waMessageId=stored_gmail_id(mail),
                from_=f"{EMAIL_PREFIX}{mail.from_}",
                profileName=(mail.from_name or "").strip()[:80] or None,
                body=text or subject or "[מייל ללא טקסט]",
                subject=subject,
                holdUntilApproved=True,
                receivedAt=datetime.fromtimestamp(mail.received_at / 1000, UTC),
            ),
            business_id,
        )

    async def sync_gmail(self, now: datetime | None = None) -> int:
        """F29, every couple of minutes: the new inbox mail of every connected Gmail. A revoked
        grant is logged and skipped; one business never blocks another."""
        now = now or datetime.now(UTC)
        ids = (
            (
                await self.db.execute(
                    select(ChannelConnection.business_id).where(ChannelConnection.channel == "gmail")
                )
            )
            .scalars()
            .all()
        )
        imported = 0
        for business_id in ids:
            conn = await self.channels.gmail(business_id)
            if not conn:
                continue
            try:
                cursor = (
                    conn["sync_cursor"] if conn["sync_cursor"] is not None else int(now.timestamp() * 1000)
                )
                access = await self.gmail.access_token(conn["refresh_token"])
                newest = cursor
                for mail in await self.gmail.list_inbox(access, cursor):
                    newest = max(newest, mail.received_at)
                    if mail.received_at <= cursor or mail.skip or mail.from_ == conn["email"]:
                        continue
                    if await self.receive_gmail(business_id, mail):
                        imported += 1
                if newest != cursor or conn["sync_cursor"] is None:
                    await self.db.execute(
                        update(ChannelConnection)
                        .where(ChannelConnection.id == conn["id"])
                        .values(sync_cursor=newest)
                    )
                    await self.db.commit()
            except Exception as err:
                await self.db.rollback()
                log.error("gmail sync failed", extra={"errName": type(err).__name__})
        return imported

    async def _run_bot(self, business_id: uuid.UUID, msg: InboundMessage) -> str:
        """The booking bot's turn (D-102); a bot failure never loses the customer's message."""
        try:
            return await self.bot.handle(business_id, BotMessage(msg.from_, msg.body, msg.replyId))
        except Exception as err:
            await self.db.rollback()
            log.error("whatsapp bot failed", extra={"errName": type(err).__name__})
            return "none"

    async def _notify_received(
        self, business_id: uuid.UUID, result: ReceiveResult, msg: InboundMessage, bot: str
    ) -> None:
        """Bell and pop-up for an incoming message (D-097)."""
        if result.kind == "ignored":
            return
        if bot == "handled" and result.kind == "lead" and not result.created:
            return  # taps in a bot conversation aren't news; the booking itself notifies
        if result.kind == "inbox":
            if not result.isNew:
                return
            data: dict[str, Any] = {
                "numberId": str(result.numberId),
                "name": (msg.profileName or "").strip()
                or (social_user(msg.channel) if is_social(msg.channel) else format_israeli_phone(msg.from_)),
            }
            if is_social(msg.channel) or msg.channel == "email":
                data["channel"] = msg.channel
            return await notify_safe(
                self.db, business_id=business_id, type="whatsapp.new_number", data=data, roles=MANAGERS
            )
        lead = (
            await self.db.execute(
                select(Lead).options(selectinload(Lead.contact)).where(Lead.id == result.leadId)
            )
        ).scalar_one_or_none()
        if not lead:
            return
        if result.created:
            source = {"messenger": "facebook", "instagram": "instagram", "email": "email"}.get(
                msg.channel, "whatsapp"
            )
            kind, data = "lead.new", {"leadId": str(lead.id), "name": lead.contact.name, "source": source}
        else:
            kind = "whatsapp.message"
            data = {"leadId": str(lead.id), "name": lead.contact.name, "preview": msg.body[:120]}
        await notify_safe(
            self.db, business_id=business_id, type=kind, data=data, roles=MANAGERS, user_ids=[lead.owner_id]
        )

    async def _attach_to_lead(
        self,
        business_id: uuid.UUID,
        number: WhatsAppNumber,
        name: str | None,
        first_message: str,
        actor_id: uuid.UUID | None = None,
    ) -> tuple[uuid.UUID, uuid.UUID, bool]:
        """The contact for this sender (reused, or created) and its latest open lead, or a new lead
        in the first stage. WhatsApp finds the contact by phone; Facebook/Instagram/email senders
        are linked to their contact directly (F23)."""
        db = self.db
        channel = number.channel
        social = is_social(channel)
        email = channel == "email"
        address = address_of(number.phone) if email else None
        source = (
            "instagram"
            if channel == "instagram"
            else "facebook"
            if social
            else "email"
            if email
            else "whatsapp"
        )

        async def contact_by(*cond: Any) -> Contact | None:
            return (
                await db.execute(
                    select(Contact)
                    .where(Contact.business_id == business_id, *cond)
                    .order_by(Contact.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()

        if social:
            existing = await contact_by(Contact.id == number.contact_id) if number.contact_id else None
        elif email:
            existing = (
                await contact_by(Contact.id == number.contact_id)
                if number.contact_id
                else await contact_by(func.lower(Contact.email) == address.lower())
            )
        else:
            existing = await contact_by(Contact.phone == number.phone)
        now = now_ms()
        contact = existing
        if contact is None:
            display = (name or "").strip() or (
                social_user(channel)
                if social
                else mail_name(address)
                if email
                else format_israeli_phone(number.phone)
            )
            contact = Contact(
                id=uuid.uuid4(),
                business_id=business_id,
                name=display[:80],
                phone=None if social or email else number.phone,
                email=address if email else None,
                created_at=now,
                updated_at=now,
            )
            db.add(contact)
            await db.flush()
        if (social or email) and number.contact_id != contact.id:
            number.contact_id = contact.id
            number.updated_at = now
        if existing:
            open_lead = (
                await db.execute(
                    select(Lead)
                    .join(Lead.stage)
                    .where(
                        Lead.business_id == business_id,
                        Lead.contact_id == contact.id,
                        Lead.stage.has(kind="OPEN"),
                    )
                    .order_by(Lead.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if open_lead:
                return contact.id, open_lead.id, False
        first = (await ensure_stages(db, business_id))[0]
        lead = Lead(
            id=uuid.uuid4(),
            business_id=business_id,
            contact_id=contact.id,
            stage_id=first.id,
            source=LeadSource(source),
            message=first_message[:1000] or None,
            tags=[],
            created_at=now,
            updated_at=now,
            **attribution_columns(parse_attribution(number.attribution)),
        )
        db.add(lead)
        await db.flush()
        db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=business_id,
                lead_id=lead.id,
                type="lead.created",
                actor_id=actor_id,
                data={"source": source, "contactReused": existing is not None},
                created_at=now,
            )
        )
        add_audit(
            db,
            "lead.created",
            business_id=business_id,
            actor_user_id=actor_id,
            entity_type="lead",
            entity_id=lead.id,
            metadata={"source": source},
        )
        await db.flush()
        return contact.id, lead.id, True

    async def update_status(self, wa_message_id: str, status: str) -> None:
        """Delivery receipt for one of our messages. It only moves forward; "failed" always wins."""
        row = (
            await self.db.execute(
                select(WhatsAppMessage).where(WhatsAppMessage.wa_message_id == wa_message_id)
            )
        ).scalar_one_or_none()
        if not row or row.direction != WhatsAppDirection.OUT:
            return
        current = row.status if row.status in STATUS_RANK else "sent"
        if STATUS_RANK[status] <= STATUS_RANK[current]:
            return
        row.status = status
        await self.db.commit()

    # -- inbox / classification ----------------------------------------------------------------

    async def inbox(self, ctx: TenantContext) -> s.InboxResponse:
        """Unclassified numbers with their waiting messages, most recent conversation first."""
        numbers = (
            (
                await self.db.execute(
                    select(WhatsAppNumber)
                    .where(
                        WhatsAppNumber.business_id == ctx.business_id,
                        WhatsAppNumber.status == WhatsAppNumberStatus.UNCLASSIFIED,
                    )
                    .limit(200)
                )
            )
            .scalars()
            .all()
        )
        out: list[s.InboxNumber] = []
        for n in numbers:
            rows = (
                (
                    await self.db.execute(
                        select(WhatsAppMessage)
                        .options(selectinload(WhatsAppMessage.sender))
                        .where(WhatsAppMessage.number_id == n.id)
                        .order_by(WhatsAppMessage.created_at.desc())
                        .limit(INBOX_MESSAGES)
                    )
                )
                .scalars()
                .all()
            )
            if not rows:
                continue
            out.append(
                s.InboxNumber(
                    id=str(n.id),
                    phone=n.phone,
                    channel=n.channel if (is_social(n.channel) or n.channel == "email") else None,
                    profileName=n.profile_name,
                    messages=[to_dto(m, n.channel) for m in reversed(rows)],
                    lastMessageAt=iso(rows[0].created_at),
                )
            )
        out.sort(key=lambda n: n.lastMessageAt, reverse=True)
        return s.InboxResponse(connected=await self.connected_to(ctx.business_id), numbers=out)

    async def personal_numbers(self, ctx: TenantContext) -> s.PersonalNumbersResponse:
        rows = (
            (
                await self.db.execute(
                    select(WhatsAppNumber)
                    .where(
                        WhatsAppNumber.business_id == ctx.business_id,
                        WhatsAppNumber.status == WhatsAppNumberStatus.PERSONAL,
                    )
                    .order_by(WhatsAppNumber.classified_at.desc().nulls_last())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        out = []
        for r in rows:
            extra: dict[str, Any] = {}
            if is_social(r.channel):
                extra = {"channel": r.channel, "name": social_user(r.channel)}
            elif r.channel == "email":
                extra = {"channel": "email", "name": address_of(r.phone)}
            out.append(
                s.PersonalNumber(
                    id=str(r.id),
                    phone=r.phone,
                    classifiedAt=iso(r.classified_at) if r.classified_at else None,
                    **extra,
                )
            )
        return s.PersonalNumbersResponse(numbers=out)

    async def _require_number(self, ctx: TenantContext, number_id: str) -> WhatsAppNumber:
        number = None
        if _UUID.match(number_id):
            number = (
                await self.db.execute(
                    select(WhatsAppNumber).where(
                        WhatsAppNumber.id == uuid.UUID(number_id),
                        WhatsAppNumber.business_id == ctx.business_id,
                    )
                )
            ).scalar_one_or_none()
        if not number:
            raise AppError("NOT_FOUND")
        return number

    async def classify(self, ctx: TenantContext, number_id: str, as_: str) -> s.ClassifyResponse:
        """Business: the waiting messages move to the contact's lead (created if needed). Personal:
        the waiting messages are deleted and future ones dropped. The choice is remembered."""
        number = await self._require_number(ctx, number_id)
        if number.status == WhatsAppNumberStatus.BUSINESS:
            if as_ == "PERSONAL":
                raise AppError("CONFLICT", M["alreadyCustomer"])
            return s.ClassifyResponse(status="BUSINESS", leadId=None)
        if as_ == "PERSONAL":
            await self.db.execute(delete(WhatsAppMessage).where(WhatsAppMessage.number_id == number.id))
            number.status = WhatsAppNumberStatus.PERSONAL
            number.profile_name = None
            number.classified_by_id = ctx.user_id
            number.classified_at = now_ms()
            number.updated_at = now_ms()
            add_audit(
                self.db,
                "whatsapp.number_classified",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="whatsapp_number",
                entity_id=number.id,
                metadata={"as": "PERSONAL"},
            )
            await self.db.commit()
            return s.ClassifyResponse(status="PERSONAL", leadId=None)
        _, lead_id = await self._promote(ctx.business_id, number, ctx.user_id)
        await self.db.commit()
        return s.ClassifyResponse(status="BUSINESS", leadId=str(lead_id))

    async def _promote(
        self, business_id: uuid.UUID, number: WhatsAppNumber, actor_id: uuid.UUID | None
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """An unclassified number becomes a business number: its waiting messages move to the
        contact's lead (created if needed). `actor_id` None = the booking bot did it."""
        waiting = (
            (
                await self.db.execute(
                    select(WhatsAppMessage.body)
                    .where(
                        WhatsAppMessage.number_id == number.id,
                        WhatsAppMessage.direction == WhatsAppDirection.IN,
                    )
                    .order_by(WhatsAppMessage.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        contact_id, lead_id, _ = await self._attach_to_lead(
            business_id, number, number.profile_name, "\n".join(waiting), actor_id
        )
        await self.db.execute(
            update(WhatsAppMessage)
            .where(WhatsAppMessage.number_id == number.id)
            .values(contact_id=contact_id, lead_id=lead_id)
        )
        number.status = WhatsAppNumberStatus.BUSINESS
        number.profile_name = None
        number.classified_by_id = actor_id
        number.classified_at = now_ms()
        number.updated_at = now_ms()
        add_audit(
            self.db,
            "whatsapp.number_classified",
            business_id=business_id,
            actor_user_id=actor_id,
            entity_type="whatsapp_number",
            entity_id=number.id,
            metadata={"as": "BUSINESS", **({} if actor_id else {"by": "booking_bot"})},
        )
        await self.db.flush()
        return contact_id, lead_id

    async def ensure_customer(
        self, business_id: uuid.UUID, number_id: uuid.UUID
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """The contact and open lead for a number (used by the booking bot when it books)."""
        number = (
            await self.db.execute(
                select(WhatsAppNumber).where(
                    WhatsAppNumber.id == number_id, WhatsAppNumber.business_id == business_id
                )
            )
        ).scalar_one_or_none()
        if not number or number.status == WhatsAppNumberStatus.PERSONAL:
            raise AppError("NOT_FOUND")
        if number.status == WhatsAppNumberStatus.UNCLASSIFIED:
            return await self._promote(business_id, number, None)
        contact_id, lead_id, _ = await self._attach_to_lead(business_id, number, None, "")
        return contact_id, lead_id

    async def forget_personal(self, ctx: TenantContext, number_id: str) -> None:
        """Forgets a personal marking; the number's next message lands in the inbox again."""
        number = await self._require_number(ctx, number_id)
        if number.status != WhatsAppNumberStatus.PERSONAL:
            raise AppError("CONFLICT", M["notPersonal"])
        await self.db.delete(number)
        add_audit(
            self.db,
            "whatsapp.number_unmarked",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="whatsapp_number",
            entity_id=number.id,
        )
        await self.db.commit()

    # -- booking bot, automatic replies and statuses -------------------------------------------------

    async def nudge_abandoned_bookings(self, now: datetime | None = None) -> int:
        """Showcase for booking conversations that stopped in the middle (D-106; background job)."""
        return await self.bot.nudge_abandoned(now)

    async def _business(self, business_id: uuid.UUID) -> Business:
        return (
            await self.db.execute(
                select(Business).where(Business.id == business_id).execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def bot_settings(self, ctx: TenantContext) -> sw.BotResponse:
        """Booking bot settings (D-102)."""
        b = await self._business(ctx.business_id)
        lang = ar.language_of(b.language)
        statuses = ar.statuses_of(b.whatsapp_statuses, lang)
        active = ar.active_of(b.whatsapp_active_status, statuses, datetime.now(UTC))
        chosen = b.whatsapp_bot_flow if b.whatsapp_bot_flow in sw.BOT_FLOWS else None
        sc = sw.parse_showcase(b.whatsapp_bot_showcase) or sw.disabled_showcase()
        video = ar.showcase_video_of(b.whatsapp_bot_showcase)
        return sw.BotResponse(
            connected=await self.channels.is_connected(ctx.business_id, "whatsapp"),
            settings=sw.BotSettingsOut(
                mode=ar.mode_of(b.whatsapp_reply_mode),
                autoReplyText=b.whatsapp_auto_reply_text,
                autoReplyDefault=sw.auto_reply_default_for(lang),
                statuses=ar.status_dtos(statuses),
                questions=[sw.QuestionOut(**q) for q in ar.questions_of(b.whatsapp_questions)],
                questionsEnabled=b.whatsapp_questions_enabled,
                activeStatus=sw.ActiveStatus(id=active["status"]["id"], until=active["until"])
                if active
                else None,
                enabled=b.whatsapp_bot_enabled,
                autoConfirm=b.whatsapp_bot_auto_confirm,
                texts=sw.parse_bot_texts(b.whatsapp_bot_texts),
                holdDate=b.whatsapp_bot_hold_date,
                flow=chosen or sw.bot_flow_for(b.industry),
                flowIsDefault=chosen is None,
                defaults=sw.bot_default_texts_for(b.industry, lang),
                showcase=sw.ShowcaseOut(
                    enabled=sc["enabled"],
                    **({"text": sc["text"]} if sc.get("text") else {}),
                    defaultText=sw.showcase_default_text(b.industry, lang),
                    link=sc["link"],
                    assetIds=sc["assetIds"],
                    video=sw.VideoOut(sizeBytes=video["bytes"]) if video else None,
                ),
            ),
        )

    async def update_bot_settings(self, ctx: TenantContext, data: sw.BotSettingsRequest) -> sw.BotResponse:
        b = await self._business(ctx.business_id)
        current_mode = ar.mode_of(b.whatsapp_reply_mode)
        # Older clients send only `enabled`: on = booking; off leaves the automatic reply as it was.
        mode = data.mode or (
            "booking" if data.enabled else ("off" if current_mode == "booking" else current_mode)
        )
        enabled = mode == "booking"
        video = ar.showcase_video_of(b.whatsapp_bot_showcase)
        dropped: list[str] = []
        if data.statuses is not None:
            merged, dropped = ar.merge_statuses(ar.statuses_of(b.whatsapp_statuses), data.statuses)
            b.whatsapp_statuses = merged
            if ar.active_of(b.whatsapp_active_status, merged, datetime.now(UTC)) is None:
                b.whatsapp_active_status = None  # a deleted status can't stay on
        if data.questions is not None:
            b.whatsapp_questions = [q.model_dump() for q in data.questions]
        if data.questionsEnabled is not None:
            b.whatsapp_questions_enabled = data.questionsEnabled
        b.whatsapp_reply_mode = mode
        b.whatsapp_auto_reply_text = data.autoReplyText
        b.whatsapp_bot_enabled = enabled
        b.whatsapp_bot_auto_confirm = data.autoConfirm
        b.whatsapp_bot_texts = data.texts.custom()
        sc = data.showcase
        showcase: dict[str, Any] = {"enabled": sc.enabled, "link": sc.link, "assetIds": sc.assetIds}
        if sc.text:
            showcase["text"] = sc.text
        # The video is uploaded on its own (D-151); saving the settings keeps it.
        if video:
            showcase.update(videoKey=video["key"], videoBytes=video["bytes"])
        b.whatsapp_bot_showcase = showcase
        b.whatsapp_bot_flow = data.flow
        b.whatsapp_bot_hold_date = data.holdDate
        b.updated_at = now_ms()
        if not enabled:  # leaving the booking bot ends conversations in progress
            await self.db.execute(
                delete(WhatsAppBotSession).where(WhatsAppBotSession.business_id == ctx.business_id)
            )
        # Only the business's own photos can go into the showcase.
        if sc.assetIds:
            from app.db.models import Asset

            ids = {uuid.UUID(i) for i in sc.assetIds}
            owned = (
                await self.db.execute(
                    select(func.count())
                    .select_from(Asset)
                    .where(Asset.id.in_(ids), Asset.business_id == ctx.business_id)
                )
            ).scalar_one()
            if owned != len(ids):
                await self.db.rollback()
                raise AppError(
                    "VALIDATION_ERROR", sw.M["imageMissing"], {"showcase.assetIds": sw.M["imageMissing"]}
                )
        add_audit(
            self.db,
            "whatsapp.bot_updated",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="business",
            entity_id=ctx.business_id,
            # Which messages are custom, not their wording.
            metadata={
                "mode": mode,
                "customAutoReply": data.autoReplyText is not None,
                **({"statuses": len(data.statuses)} if data.statuses is not None else {}),
                **({"questions": len(data.questions)} if data.questions is not None else {}),
                **({"questionsEnabled": data.questionsEnabled} if data.questionsEnabled is not None else {}),
                "enabled": enabled,
                "autoConfirm": data.autoConfirm,
                "customTexts": list(data.texts.custom()),
                "showcase": sc.enabled,
            },
        )
        await self.db.commit()
        for key in dropped:  # videos of deleted statuses (after the change is saved)
            try:
                await self.storage.delete(key)
            except Exception:
                pass
        return await self.bot_settings(ctx)

    async def set_status(self, ctx: TenantContext, data: sw.SetStatusRequest) -> sw.BotResponse:
        """Turns a status on (until a time, or until changed) or off (D-123)."""
        b = await self._business(ctx.business_id)
        if data.id and not any(x["id"] == data.id for x in ar.statuses_of(b.whatsapp_statuses)):
            raise AppError("NOT_FOUND")
        if data.until:
            try:
                until = datetime.fromisoformat(data.until.replace("Z", "+00:00"))
            except ValueError as err:
                raise AppError("VALIDATION_ERROR", "Invalid", {"until": "Invalid"}) from err
            if until <= datetime.now(UTC):
                raise AppError("VALIDATION_ERROR", sw.M["untilPast"], {"until": sw.M["untilPast"]})
        b.whatsapp_active_status = {"id": data.id, "until": data.until} if data.id else None
        b.updated_at = now_ms()
        add_audit(
            self.db,
            "whatsapp.status_set",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="business",
            entity_id=ctx.business_id,
            metadata={"status": data.id, "until": data.until},
        )
        await self.db.commit()
        return await self.bot_settings(ctx)

    async def set_showcase_video(self, ctx: TenantContext, video: bytes) -> sw.BotResponse:
        """Stores the "meanwhile" video (D-151), replacing the old one."""
        key = ar.check_showcase_video(ctx.business_id, video)
        b = await self._business(ctx.business_id)
        await self.storage.put(key, video, "video/mp4")
        old = ar.showcase_video_of(b.whatsapp_bot_showcase)
        b.whatsapp_bot_showcase = {
            **ar.showcase_object(b.whatsapp_bot_showcase),
            "videoKey": key,
            "videoBytes": len(video),
        }
        b.updated_at = now_ms()
        await self.db.commit()
        if old:
            try:
                await self.storage.delete(old["key"])
            except Exception:
                pass
        return await self.bot_settings(ctx)

    async def delete_showcase_video(self, ctx: TenantContext) -> sw.BotResponse:
        b = await self._business(ctx.business_id)
        old = ar.showcase_video_of(b.whatsapp_bot_showcase)
        if not old:
            return await self.bot_settings(ctx)
        rest = ar.showcase_object(b.whatsapp_bot_showcase)
        rest.pop("videoKey", None)
        rest.pop("videoBytes", None)
        b.whatsapp_bot_showcase = rest
        b.updated_at = now_ms()
        await self.db.commit()
        try:
            await self.storage.delete(old["key"])
        except Exception:
            pass
        return await self.bot_settings(ctx)

    async def showcase_video(self, ctx: TenantContext) -> bytes:
        """The video's bytes, for the owner's preview (this business's only)."""
        b = await self._business(ctx.business_id)
        v = ar.showcase_video_of(b.whatsapp_bot_showcase)
        video = await self.storage.get(v["key"]) if v else None
        if not video:
            raise AppError("NOT_FOUND")
        return video

    # -- threads and replies ---------------------------------------------------------------------

    async def thread(self, ctx: TenantContext, lead_id: str) -> s.ThreadResponse:
        """The conversation with this lead's contact, oldest first."""
        lead = await self.leads.find_visible(ctx, lead_id)
        rows = (
            (
                await self.db.execute(
                    select(WhatsAppMessage)
                    .options(selectinload(WhatsAppMessage.sender), selectinload(WhatsAppMessage.number))
                    .where(
                        WhatsAppMessage.business_id == ctx.business_id,
                        WhatsAppMessage.contact_id == lead.contact_id,
                    )
                    .order_by(WhatsAppMessage.created_at.asc())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        last_in = next((r for r in reversed(rows) if r.direction == WhatsAppDirection.IN), None)
        until = int(last_in.created_at.timestamp() * 1000) + s.WHATSAPP_WINDOW_MS if last_in else 0
        number = await self._number(ctx.business_id, lead.contact.phone) if lead.contact.phone else None
        now_ms_ = datetime.now(UTC).timestamp() * 1000
        channel = last_in.number.channel if last_in else None
        return s.ThreadResponse(
            connected=await self.connected_to(ctx.business_id),
            messages=[to_dto(r, r.number.channel) for r in rows],
            replyUntil=iso(datetime.fromtimestamp(until / 1000, UTC)) if until > now_ms_ else None,
            botPaused=number.bot_paused if number else False,
            channel=channel if (is_social(channel) or channel == "email") else None,
        )

    async def pause_bot(self, ctx: TenantContext, lead_id: str, paused: bool) -> None:
        """Pause or resume the booking bot for this lead's customer (D-108). Pausing also ends a
        conversation in progress."""
        lead = await self.leads.find_visible(ctx, lead_id)
        phone = lead.contact.phone
        if not phone:
            raise AppError("CONFLICT", M["noPhone"])
        number = await self._number(ctx.business_id, phone)
        now = now_ms()
        if number is None:
            number = WhatsAppNumber(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                phone=phone,
                channel="whatsapp",
                status=WhatsAppNumberStatus.BUSINESS,
                bot_paused=paused,
                created_at=now,
                updated_at=now,
            )
            self.db.add(number)
        else:
            number.bot_paused = paused
            number.updated_at = now
        await self.db.flush()
        if paused:
            await self.db.execute(delete(WhatsAppBotSession).where(WhatsAppBotSession.number_id == number.id))
        add_audit(
            self.db,
            "whatsapp.bot_paused" if paused else "whatsapp.bot_resumed",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="whatsapp_number",
            entity_id=number.id,
        )
        await self.db.commit()

    async def send(self, ctx: TenantContext, lead_id: str, text: str) -> s.MessageOut:
        """Free-form reply; only inside the 24-hour window that the customer's last message opened."""
        lead = await self.leads.find_visible(ctx, lead_id)
        row = (
            await self.db.execute(
                select(WhatsAppMessage.created_at, WhatsAppNumber)
                .join(WhatsAppNumber, WhatsAppNumber.id == WhatsAppMessage.number_id)
                .where(
                    WhatsAppMessage.business_id == ctx.business_id,
                    WhatsAppMessage.contact_id == lead.contact_id,
                    WhatsAppMessage.direction == WhatsAppDirection.IN,
                )
                .order_by(WhatsAppMessage.created_at.desc())
                .limit(1)
            )
        ).first()
        if row is None:
            if not await self.channels.is_connected(ctx.business_id, "whatsapp"):
                raise AppError("CONFLICT", M["notConnected"])
            raise AppError("CONFLICT", M["windowClosed"] if lead.contact.phone else M["noPhone"])
        at, number = row
        return await self._deliver(ctx, number, lead.contact_id, lead.id, at, text)

    async def send_on_number(
        self, ctx: TenantContext, number_id: str, text: str
    ) -> tuple[s.MessageOut, str | None]:
        """F24 inbox: a reply in one conversation, through its channel. A new sender becomes a
        customer first, so the reply is never lost."""
        number = await self._require_number(ctx, number_id)
        if number.status == WhatsAppNumberStatus.PERSONAL:
            raise AppError("NOT_FOUND")
        lead_id: uuid.UUID | None = None
        if number.status == WhatsAppNumberStatus.UNCLASSIFIED:
            res = await self.classify(ctx, number_id, "BUSINESS")
            lead_id = uuid.UUID(res.leadId) if res.leadId else None
            number = await self._require_number(ctx, number_id)
            await self.db.refresh(number)
        if number.channel != "whatsapp":
            contact_id = number.contact_id
        else:
            contact_id = (
                await self.db.execute(
                    select(Contact.id)
                    .where(Contact.business_id == ctx.business_id, Contact.phone == number.phone)
                    .order_by(Contact.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        if not lead_id and contact_id:
            base = select(Lead.id).where(Lead.business_id == ctx.business_id, Lead.contact_id == contact_id)
            lead_id = (
                await self.db.execute(
                    base.where(Lead.stage.has(kind="OPEN")).order_by(Lead.created_at.desc()).limit(1)
                )
            ).scalar_one_or_none() or (
                await self.db.execute(base.order_by(Lead.created_at.desc()).limit(1))
            ).scalar_one_or_none()
        last_in = (
            await self.db.execute(
                select(WhatsAppMessage.created_at)
                .where(
                    WhatsAppMessage.number_id == number.id, WhatsAppMessage.direction == WhatsAppDirection.IN
                )
                .order_by(WhatsAppMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        message = await self._deliver(ctx, number, contact_id, lead_id, last_in, text)
        return message, str(lead_id) if lead_id else None

    async def _deliver(
        self,
        ctx: TenantContext,
        number: WhatsAppNumber,
        contact_id: uuid.UUID | None,
        lead_id: uuid.UUID | None,
        last_in_at: datetime | None,
        text: str,
    ) -> s.MessageOut:
        """Sends through the conversation's channel inside the 24-hour window, and stores the reply."""
        if number.channel == "email":
            return await self._deliver_email(ctx, number, contact_id, lead_id, text)
        social = is_social(number.channel)
        instagram = number.channel == "instagram"
        via = await (
            self.channels.instagram
            if instagram
            else self.channels.messenger
            if social
            else self.channels.whatsapp
        )(ctx.business_id)
        if not via:
            raise AppError(
                "CONFLICT",
                M["instagramNotConnected"]
                if instagram
                else M["messengerNotConnected"]
                if social
                else M["notConnected"],
            )
        if (
            not last_in_at
            or datetime.now(UTC).timestamp() * 1000 - last_in_at.timestamp() * 1000 > s.WHATSAPP_WINDOW_MS
        ):
            raise AppError(
                "CONFLICT",
                M["instagramWindowClosed"]
                if instagram
                else M["messengerWindowClosed"]
                if social
                else M["windowClosed"],
            )
        try:
            sent = await via.send_text(psid_of(number.phone) if social else number.phone, text)
        except Exception as err:
            log.error(
                "instagram send failed"
                if instagram
                else "messenger send failed"
                if social
                else "whatsapp send failed",
                extra={
                    "errName": type(err).__name__,
                    "status": getattr(err, "status", None),
                    "code": getattr(err, "code", None),
                },
            )
            raise AppError("INTERNAL_ERROR", M["sendFailed"]) from err
        # Messenger's echo of this very reply can land first; it then gets this sender.
        row = (
            await self.db.execute(select(WhatsAppMessage).where(WhatsAppMessage.wa_message_id == sent["id"]))
        ).scalar_one_or_none()
        if row:
            row.sender_id = ctx.user_id
        else:
            row = WhatsAppMessage(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                number_id=number.id,
                contact_id=contact_id,
                lead_id=lead_id,
                direction=WhatsAppDirection.OUT,
                wa_message_id=sent["id"],
                body=text,
                status="sent",
                sender_id=ctx.user_id,
                created_at=now_ms(),
            )
            self.db.add(row)
        await self.db.commit()
        return await self._dto(row.id, number.channel)

    async def _dto(self, message_id: uuid.UUID, channel: str) -> s.MessageOut:
        row = (
            await self.db.execute(
                select(WhatsAppMessage)
                .options(selectinload(WhatsAppMessage.sender))
                .where(WhatsAppMessage.id == message_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        return to_dto(row, channel)

    async def _deliver_gmail(
        self,
        ctx: TenantContext,
        number: WhatsAppNumber,
        contact_id: uuid.UUID | None,
        lead_id: uuid.UUID | None,
        text: str,
        gm: dict[str, Any],
        last: tuple[str | None, str],
    ) -> s.MessageOut:
        """F29: a reply from the connected Gmail, threaded under the mail it answers."""
        base = re.sub(r"^(\s*re:\s*)+", "", last[0] or "", flags=re.I).strip() or "-"
        subject = f"Re: {base}"[:300]
        quoted = quoted_mail_id(last[1])
        try:
            access = await self.gmail.access_token(gm["refresh_token"])
            sent = await self.gmail.send(
                access,
                GmailOutgoing(
                    from_=gm["email"],
                    to=address_of(number.phone),
                    subject=subject,
                    text=text,
                    in_reply_to=quoted,
                ),
            )
        except Exception as err:
            log.error("gmail send failed", extra={"errName": type(err).__name__})
            raise AppError("INTERNAL_ERROR", M["sendFailed"]) from err
        return await self._store_out(ctx, number, contact_id, lead_id, f"go:{sent['id']}", text, subject)

    async def _store_out(
        self,
        ctx: TenantContext,
        number: WhatsAppNumber,
        contact_id: uuid.UUID | None,
        lead_id: uuid.UUID | None,
        wa_id: str,
        text: str,
        subject: str,
    ) -> s.MessageOut:
        row = WhatsAppMessage(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            number_id=number.id,
            contact_id=contact_id,
            lead_id=lead_id,
            direction=WhatsAppDirection.OUT,
            wa_message_id=wa_id,
            body=text[:4096],
            subject=subject,
            status="sent",
            sender_id=ctx.user_id,
            created_at=now_ms(),
        )
        self.db.add(row)
        await self.db.commit()
        return await self._dto(row.id, "email")

    async def _deliver_email(
        self,
        ctx: TenantContext,
        number: WhatsAppNumber,
        contact_id: uuid.UUID | None,
        lead_id: uuid.UUID | None,
        text: str,
    ) -> s.MessageOut:
        """F27: a reply by email, from the business's forwarding address (so the customer's answer
        comes back to the same conversation). No 24-hour window."""
        last = (
            await self.db.execute(
                select(WhatsAppMessage.subject, WhatsAppMessage.wa_message_id)
                .where(
                    WhatsAppMessage.number_id == number.id, WhatsAppMessage.direction == WhatsAppDirection.IN
                )
                .order_by(WhatsAppMessage.created_at.desc())
                .limit(1)
            )
        ).first()
        if last and is_gmail_id(last[1]):
            gm = await self.channels.gmail(ctx.business_id)
            if gm:
                return await self._deliver_gmail(
                    ctx, number, contact_id, lead_id, text, gm, (last[0], last[1])
                )
        sender = await self.channels.email_address(ctx.business_id)
        if not sender:
            raise AppError("CONFLICT", M["emailNotConnected"])
        if self.settings.EMAIL_TRANSPORT == "disabled":
            raise AppError("CONFLICT", M["emailNotConfigured"])
        business = (
            await self.db.execute(select(Business.name).where(Business.id == ctx.business_id))
        ).scalar_one_or_none()
        name = re.sub(r'["<>,\r\n]', " ", business or "").strip()
        base = (
            re.sub(r"^(\s*re:\s*)+", "", (last[0] if last else "") or "", flags=re.I).strip() or name or "-"
        )
        subject = f"Re: {base}"[:300]
        html = f'<div dir="auto">{escape(text, quote=False).replace(chr(10), "<br>")}</div>'
        quoted = quoted_mail_id(last[1]) if last else None
        try:
            await self.email.send(
                EmailMessage(
                    to=address_of(number.phone),
                    from_=f"{name} <{sender}>" if name else sender,
                    reply_to=sender,
                    in_reply_to=f"<{re.sub(r'^<|>$', '', quoted)}>" if quoted else None,
                    subject=subject,
                    text=text,
                    html=html,
                )
            )
        except Exception as err:
            log.error("email send failed", extra={"errName": type(err).__name__})
            raise AppError("INTERNAL_ERROR", M["sendFailed"]) from err
        return await self._store_out(ctx, number, contact_id, lead_id, f"o:{uuid.uuid4()}", text, subject)


def build_service(app_state: Any, db: AsyncSession) -> WhatsAppService:
    """The service wired from the app's settings, senders and storage."""
    st = app_state
    return WhatsAppService(
        db, st.settings, st.whatsapp_sender, st.messenger_sender, st.email, st.gmail_api, st.storage
    )
