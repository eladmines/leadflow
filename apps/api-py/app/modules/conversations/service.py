"""F24 unified inbox (D-158). A conversation is one sender on one channel (the channel-aware
`whatsapp_numbers` row); its last-message time and unread flag are kept by a database trigger.
Personal numbers never appear. Port of apps/api/src/modules/conversations/service.ts."""

import re
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timeutil import iso
from app.db.models import (
    Contact,
    Lead,
    WhatsAppMessage,
    WhatsAppNumber,
    WhatsAppNumberStatus,
)
from app.deps import TenantContext
from app.errors import AppError
from app.modules.whatsapp import schemas as ws
from app.modules.whatsapp.service import WhatsAppService, to_dto

CONVERSATIONS_PAGE = 30
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)
Channel = Literal["whatsapp", "messenger", "instagram", "email"]


class LastMessage(BaseModel):
    body: str
    direction: Literal["IN", "OUT"]
    at: str


class ConversationSummary(BaseModel):
    id: str
    channel: Channel
    status: Literal["UNCLASSIFIED", "BUSINESS"]
    name: str | None
    phone: str | None
    email: str | None = None
    leadId: str | None
    lastMessage: LastMessage | None
    lastMessageAt: str
    unread: bool


class ConversationListResponse(BaseModel):
    connected: bool
    conversations: list[ConversationSummary]
    nextCursor: str | None
    unreadCount: int


class ConversationResponse(BaseModel):
    conversation: ConversationSummary
    messages: list[ws.MessageOut]
    replyUntil: str | None


class UnreadResponse(BaseModel):
    unreadCount: int


class ListQuery(BaseModel):
    filter: Literal["all", "unread", "new"] = "all"
    channel: Channel | None = None
    cursor: str | None = Field(default=None, pattern=r"^\d{13}_[0-9a-f-]{36}$")


class ConversationService:
    def __init__(self, db: AsyncSession, whatsapp: WhatsAppService) -> None:
        self.db, self.whatsapp = db, whatsapp

    @staticmethod
    def _visible(business_id: uuid.UUID) -> list[Any]:
        return [
            WhatsAppNumber.business_id == business_id,
            WhatsAppNumber.status.in_([WhatsAppNumberStatus.UNCLASSIFIED, WhatsAppNumberStatus.BUSINESS]),
            WhatsAppNumber.last_message_at.is_not(None),
        ]

    async def list_page(self, ctx: TenantContext, q: ListQuery) -> ConversationListResponse:
        where = self._visible(ctx.business_id)
        if q.channel:
            where.append(WhatsAppNumber.channel == q.channel)
        if q.filter == "unread":
            where.append(WhatsAppNumber.unread.is_(True))
        if q.filter == "new":
            where.append(WhatsAppNumber.status == WhatsAppNumberStatus.UNCLASSIFIED)
        if q.cursor:
            ms, id_ = q.cursor.split("_", 1)
            at = datetime.fromtimestamp(int(ms) / 1000, UTC)
            where.append(
                or_(
                    WhatsAppNumber.last_message_at < at,
                    and_(WhatsAppNumber.last_message_at == at, WhatsAppNumber.id < uuid.UUID(id_)),
                )
            )
        rows = list(
            (
                await self.db.execute(
                    select(WhatsAppNumber)
                    .where(*where)
                    .order_by(WhatsAppNumber.last_message_at.desc(), WhatsAppNumber.id.desc())
                    .limit(CONVERSATIONS_PAGE + 1)
                )
            ).scalars()
        )
        page = rows[:CONVERSATIONS_PAGE]
        last = page[-1] if page else None
        return ConversationListResponse(
            connected=await self.whatsapp.connected_to(ctx.business_id),
            conversations=await self._summaries(ctx.business_id, page),
            nextCursor=(
                f"{int(last.last_message_at.timestamp() * 1000)}_{last.id}"
                if len(rows) > CONVERSATIONS_PAGE and last and last.last_message_at
                else None
            ),
            unreadCount=await self.unread_count(ctx),
        )

    async def unread_count(self, ctx: TenantContext) -> int:
        return (
            await self.db.execute(
                select(func.count())
                .select_from(WhatsAppNumber)
                .where(*self._visible(ctx.business_id), WhatsAppNumber.unread.is_(True))
            )
        ).scalar_one()

    async def detail(self, ctx: TenantContext, id_: str) -> ConversationResponse:
        number = await self._require(ctx, id_)
        rows = list(
            (
                await self.db.execute(
                    select(WhatsAppMessage)
                    .options(selectinload(WhatsAppMessage.sender))
                    .where(WhatsAppMessage.number_id == number.id)
                    .order_by(WhatsAppMessage.created_at.desc())
                    .limit(200)
                )
            ).scalars()
        )
        last_in = next((r for r in rows if r.direction.value == "IN"), None)
        until = int(last_in.created_at.timestamp() * 1000) + ws.WHATSAPP_WINDOW_MS if last_in else 0
        (summary,) = await self._summaries(ctx.business_id, [number])
        return ConversationResponse(
            conversation=summary,
            messages=[to_dto(r, number.channel) for r in reversed(rows)],
            replyUntil=iso(datetime.fromtimestamp(until / 1000, UTC))
            if until > datetime.now(UTC).timestamp() * 1000
            else None,
        )

    async def mark_read(self, ctx: TenantContext, id_: str) -> None:
        """Opened by someone on the team: read for everyone."""
        number = await self._require(ctx, id_)
        if number.unread:
            number.unread = False
            await self.db.commit()

    async def send(self, ctx: TenantContext, id_: str, text: str) -> tuple[ws.MessageOut, str | None]:
        """A reply through the conversation's channel; answering it also marks it read."""
        await self._require(ctx, id_)
        message, lead_id = await self.whatsapp.send_on_number(ctx, id_, text)
        number = await self._require(ctx, id_)
        number.unread = False
        await self.db.commit()
        return message, lead_id

    async def _require(self, ctx: TenantContext, id_: str) -> WhatsAppNumber:
        number = None
        if _UUID.match(id_):
            number = (
                await self.db.execute(
                    select(WhatsAppNumber)
                    .where(WhatsAppNumber.id == uuid.UUID(id_), *self._visible(ctx.business_id))
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
        if not number:
            raise AppError("NOT_FOUND")
        return number

    async def _summaries(
        self, business_id: uuid.UUID, rows: list[WhatsAppNumber]
    ) -> list[ConversationSummary]:
        """The list rows: who (contact name for customers, else the profile name), the lead to
        open, and the last message. WhatsApp customers are matched to contacts by phone, the
        other channels by their link (F23)."""
        db = self.db
        phones = [
            r.phone for r in rows if r.channel == "whatsapp" and r.status == WhatsAppNumberStatus.BUSINESS
        ]
        by_phone: dict[str, Contact] = {}
        if phones:
            found = (
                await db.execute(
                    select(Contact)
                    .where(Contact.business_id == business_id, Contact.phone.in_(phones))
                    .order_by(Contact.created_at.asc())
                )
            ).scalars()
            for c in reversed(list(found)):  # the oldest contact with a phone wins
                by_phone[c.phone] = c
        contact_ids = {r.contact_id for r in rows if r.contact_id}
        by_id: dict[uuid.UUID, Contact] = {}
        if contact_ids:
            by_id = {
                c.id: c
                for c in (await db.execute(select(Contact).where(Contact.id.in_(contact_ids)))).scalars()
            }

        def contact_of(r: WhatsAppNumber) -> Contact | None:
            if r.channel == "whatsapp":
                return by_phone.get(r.phone)
            return by_id.get(r.contact_id) if r.contact_id else None

        wanted = {c.id for r in rows if (c := contact_of(r))}
        leads: list[Lead] = []
        if wanted:
            leads = list(
                (
                    await db.execute(
                        select(Lead)
                        .options(selectinload(Lead.stage))
                        .where(Lead.business_id == business_id, Lead.contact_id.in_(wanted))
                        .order_by(Lead.created_at.desc())
                    )
                ).scalars()
            )

        def lead_of(contact_id: uuid.UUID) -> str | None:
            mine = [x for x in leads if x.contact_id == contact_id]
            pick = next((x for x in mine if x.stage.kind.value == "OPEN"), mine[0] if mine else None)
            return str(pick.id) if pick else None

        last_by_number: dict[uuid.UUID, WhatsAppMessage] = {}
        if rows:
            msgs = (
                await db.execute(
                    select(WhatsAppMessage)
                    .where(WhatsAppMessage.number_id.in_([r.id for r in rows]))
                    .order_by(WhatsAppMessage.number_id, WhatsAppMessage.created_at.desc())
                )
            ).scalars()
            for m in msgs:
                last_by_number.setdefault(m.number_id, m)

        out: list[ConversationSummary] = []
        for r in rows:
            contact = contact_of(r) if r.status == WhatsAppNumberStatus.BUSINESS else None
            last = last_by_number.get(r.id)
            out.append(
                ConversationSummary(
                    id=str(r.id),
                    channel=r.channel if r.channel in ("messenger", "instagram", "email") else "whatsapp",
                    status="UNCLASSIFIED" if r.status == WhatsAppNumberStatus.UNCLASSIFIED else "BUSINESS",
                    name=(contact.name if contact else None) or r.profile_name or None,
                    phone=r.phone if r.channel == "whatsapp" else None,
                    email=re.sub(r"^mail:", "", r.phone) if r.channel == "email" else None,
                    leadId=lead_of(contact.id) if contact else None,
                    lastMessage=(
                        LastMessage(
                            body=last.body[:200], direction=last.direction.value, at=iso(last.created_at)
                        )
                        if last
                        else None
                    ),
                    lastMessageAt=iso(r.last_message_at or r.created_at),
                    unread=r.unread,
                )
            )
        return out
