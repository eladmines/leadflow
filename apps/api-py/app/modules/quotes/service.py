"""Quotes (F18): created from a lead, with line items, quantity, price, discount, VAT and notes;
draft → sent (private link / email) → accepted or rejected; validity date.

Port of apps/api/src/modules/quotes/service.ts. Money is in agorot (integers).
"""

import asyncio
import logging
import re
import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import joinedload

from app.config import Settings
from app.core.permissions import can
from app.core.security import generate_token
from app.core.timeutil import iso, now_ms
from app.core.timezone import date_in_zone
from app.db.models import (
    Activity,
    Lead,
    Membership,
    MembershipRole,
    MembershipStatus,
    PipelineStage,
    Quote,
    QuoteStatus,
    StageKind,
    User,
    UserStatus,
)
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.email.templates import quote_decision_template, quote_template
from app.modules.leads.schemas import QUOTE_SENT_STAGE
from app.modules.notifications.service import MANAGERS, notify_safe
from app.modules.quotes import schemas as s

log = logging.getLogger("simplecatch")

FIRST_NUMBER = 1001
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)
_LOAD = (joinedload(Quote.lead).joinedload(Lead.contact), joinedload(Quote.business))
_background: set[asyncio.Task] = set()


def _items(q: Quote) -> list[dict[str, Any]]:
    out = []
    for i in q.items if isinstance(q.items, list) else []:
        if isinstance(i, dict) and {"description", "quantity", "unitPrice"} <= i.keys():
            out.append(
                {"description": i["description"], "quantity": i["quantity"], "unitPrice": i["unitPrice"]}
            )
        else:
            return []
    return out


def _ymd(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _is_expired(q: Quote) -> bool:
    return (
        q.status == QuoteStatus.SENT
        and q.valid_until is not None
        and q.valid_until.isoformat() < date_in_zone(datetime.now(UTC), q.business.timezone)
    )


def check_discount(data: s.UpsertQuoteRequest) -> None:
    """The discount can't be higher than the amount (reported on `discount`)."""
    subtotal = sum(i.quantity * i.unitPrice for i in data.items)
    if data.discount > subtotal:
        raise AppError("VALIDATION_ERROR", None, {"discount": s.M["discountInvalid"]})


class QuoteService:
    def __init__(self, db: AsyncSession, settings: Settings, email: EmailSender) -> None:
        self.db = db
        self.settings = settings
        self.email = email

    def _public_url(self, token: str | None) -> str | None:
        return f"{self.settings.APP_URL}{s.QUOTE_WEB_PATH}/{token}" if token else None

    def _dto(self, q: Quote) -> s.QuoteOut:
        items = _items(q)
        vat_rate = float(q.vat_rate)
        return s.QuoteOut(
            id=str(q.id),
            number=q.number,
            title=q.title,
            items=[s.ItemOut(**i) for i in items],
            discount=q.discount,
            vatRate=vat_rate,
            notes=q.notes,
            validUntil=_ymd(q.valid_until),
            status=q.status.value,
            expired=_is_expired(q),
            totals=s.Totals(**s.quote_totals(items, q.discount, vat_rate)),
            lead=s.LeadRef(id=str(q.lead.id)),
            customer=s.CustomerRef(
                name=q.lead.contact.name, phone=q.lead.contact.phone, email=q.lead.contact.email
            ),
            publicUrl=self._public_url(q.public_token),
            sentAt=iso(q.sent_at) if q.sent_at else None,
            decidedAt=iso(q.decided_at) if q.decided_at else None,
            createdAt=iso(q.created_at),
            updatedAt=iso(q.updated_at),
        )

    def _visible(self, ctx: TenantContext) -> list[Any]:
        """Quotes follow lead visibility: employees only see quotes on leads assigned to them."""
        conds: list[Any] = [Quote.business_id == ctx.business_id]
        if not can(ctx.role, "leads.view.all"):
            conds.append(Quote.lead.has(Lead.owner_id == ctx.user_id))
        return conds

    async def _load(self, quote_id: uuid.UUID) -> Quote:
        return (
            await self.db.execute(
                select(Quote)
                .options(*_LOAD)
                .where(Quote.id == quote_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def _find_visible(self, ctx: TenantContext, quote_id: str) -> Quote:
        row = None
        if _UUID.match(quote_id):
            row = (
                await self.db.execute(
                    select(Quote)
                    .options(*_LOAD)
                    .where(Quote.id == uuid.UUID(quote_id), *self._visible(ctx))
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
        if row is None:
            raise AppError("NOT_FOUND")
        return row

    def _activity(
        self,
        business_id: uuid.UUID,
        lead_id: uuid.UUID,
        actor_id: uuid.UUID | None,
        kind: str,
        number: int,
        total: int,
    ) -> None:
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=business_id,
                lead_id=lead_id,
                actor_id=actor_id,
                type=kind,
                data={"number": number, "total": total},
                created_at=now_ms(),
            )
        )

    async def list_quotes(self, ctx: TenantContext, q: s.QuoteListQuery) -> list[s.QuoteOut]:
        conds = self._visible(ctx)
        if q.status:
            conds.append(Quote.status == QuoteStatus(q.status))
        if q.leadId:
            conds.append(Quote.lead_id == q.leadId)
        rows = await self.db.execute(
            select(Quote).options(*_LOAD).where(*conds).order_by(Quote.number.desc()).limit(500)
        )
        return [self._dto(r) for r in rows.scalars().unique()]

    async def get(self, ctx: TenantContext, quote_id: str) -> s.QuoteOut:
        return self._dto(await self._find_visible(ctx, quote_id))

    async def _next_number(self, business_id: uuid.UUID) -> int:
        """Next number per business, under a per-business lock so two quotes never share one."""
        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"quote:{business_id}"}
        )
        top = (
            await self.db.execute(select(func.max(Quote.number)).where(Quote.business_id == business_id))
        ).scalar()
        return max((top or 0) + 1, FIRST_NUMBER)

    @staticmethod
    def _fields(data: s.UpsertQuoteRequest) -> dict[str, Any]:
        return {
            "title": data.title,
            "items": [i.model_dump() for i in data.items],
            "discount": data.discount,
            "vat_rate": data.vatRate,
            "notes": data.notes,
            "valid_until": date.fromisoformat(data.validUntil) if data.validUntil else None,
        }

    async def create(self, ctx: TenantContext, data: s.CreateQuoteRequest) -> s.QuoteOut:
        check_discount(data)
        conds = [Lead.id == data.leadId, Lead.business_id == ctx.business_id]
        if not can(ctx.role, "leads.view.all"):
            conds.append(Lead.owner_id == ctx.user_id)
        lead_id = (await self.db.execute(select(Lead.id).where(*conds))).scalar_one_or_none()
        if lead_id is None:
            msg = s.M["leadInvalid"]
            raise AppError("VALIDATION_ERROR", msg, {"leadId": msg})
        now = now_ms()
        quote = Quote(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            lead_id=lead_id,
            number=await self._next_number(ctx.business_id),
            created_by_id=ctx.user_id,
            status=QuoteStatus.DRAFT,
            created_at=now,
            updated_at=now,
            **self._fields(data),
        )
        self.db.add(quote)
        total = s.quote_totals([i.model_dump() for i in data.items], data.discount, data.vatRate)["total"]
        self._activity(ctx.business_id, lead_id, ctx.user_id, "quote.created", quote.number, total)
        await self.db.commit()
        return self._dto(await self._load(quote.id))

    async def update(self, ctx: TenantContext, quote_id: str, data: s.UpsertQuoteRequest) -> s.QuoteOut:
        q = await self._find_visible(ctx, quote_id)
        if q.status != QuoteStatus.DRAFT:
            raise AppError("CONFLICT", s.M["notDraft"])
        check_discount(data)
        for key, value in self._fields(data).items():
            setattr(q, key, value)
        q.updated_at = now_ms()
        await self.db.commit()
        return self._dto(await self._load(q.id))

    async def remove(self, ctx: TenantContext, quote_id: str) -> None:
        q = await self._find_visible(ctx, quote_id)
        if q.status != QuoteStatus.DRAFT:
            raise AppError("CONFLICT", s.M["notDraft"])
        await self.db.execute(delete(Quote).where(Quote.id == q.id))
        await self.db.commit()

    async def duplicate(self, ctx: TenantContext, quote_id: str) -> s.QuoteOut:
        """A new draft with the same content (to change a quote that was already sent)."""
        q = await self._find_visible(ctx, quote_id)
        return await self.create(
            ctx,
            s.CreateQuoteRequest.model_validate(
                {
                    "leadId": str(q.lead_id),
                    "title": q.title,
                    "items": _items(q),
                    "discount": q.discount,
                    "vatRate": float(q.vat_rate),
                    "notes": q.notes,
                    "validUntil": _ymd(q.valid_until),
                }
            ),
        )

    async def _advance_lead(self, ctx: TenantContext, lead_id: uuid.UUID) -> None:
        """Sending a quote moves a lead that is still early in the pipeline to "Quote sent", so that
        stage always means a quote went out. A lead further along (waiting, won, lost) stays put."""
        target = (
            await self.db.execute(
                select(PipelineStage).where(
                    PipelineStage.business_id == ctx.business_id, PipelineStage.name == QUOTE_SENT_STAGE
                )
            )
        ).scalar_one_or_none()
        if target is None:
            return
        current = (
            await self.db.execute(
                select(PipelineStage.name, PipelineStage.position, PipelineStage.kind)
                .join(Lead, Lead.stage_id == PipelineStage.id)
                .where(Lead.id == lead_id)
            )
        ).one_or_none()
        if current is None or current.kind != StageKind.OPEN or current.position >= target.position:
            return
        await self.db.execute(
            update(Lead).where(Lead.id == lead_id).values(stage_id=target.id, updated_at=now_ms())
        )
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                lead_id=lead_id,
                actor_id=ctx.user_id,
                type="lead.stage_changed",
                data={"from": current.name, "to": target.name, "toKind": target.kind.value},
                created_at=now_ms(),
            )
        )

    async def send(self, ctx: TenantContext, quote_id: str, email: bool) -> s.QuoteOut:
        """Marks the quote sent (creating its link once) and optionally emails the customer."""
        q = await self._find_visible(ctx, quote_id)
        if q.status in (QuoteStatus.ACCEPTED, QuoteStatus.REJECTED):
            raise AppError("CONFLICT", s.M["notOpen"])
        if email and not q.lead.contact.email:
            msg = s.M["noEmail"]
            raise AppError("VALIDATION_ERROR", msg, {"email": msg})
        total = s.quote_totals(_items(q), q.discount, float(q.vat_rate))["total"]
        q.status = QuoteStatus.SENT
        q.sent_at = now_ms()
        q.public_token = q.public_token or generate_token()
        q.updated_at = now_ms()
        self._activity(ctx.business_id, q.lead_id, ctx.user_id, "quote.sent", q.number, total)
        await self._advance_lead(ctx, q.lead_id)
        await self.db.commit()
        row = await self._load(q.id)
        if email and row.lead.contact.email:
            mail = quote_template(
                business_name=row.business.name,
                customer_name=row.lead.contact.name,
                number=row.number,
                total=s.format_agorot(total),
                valid_until="/".join(reversed(_ymd(row.valid_until).split("-"))) if row.valid_until else None,
                link=self._public_url(row.public_token) or "",
                lang="en" if row.business.language == "en" else "he",
            )
            await self.email.send(
                EmailMessage(to=row.lead.contact.email, subject=mail.subject, html=mail.html, text=mail.text)
            )
        return self._dto(row)

    async def decide(self, ctx: TenantContext, quote_id: str, status: str) -> s.QuoteOut:
        """The business records the customer's answer (e.g. given by phone)."""
        q = await self._find_visible(ctx, quote_id)
        if q.status.value == status:
            return self._dto(q)
        total = s.quote_totals(_items(q), q.discount, float(q.vat_rate))["total"]
        q.status = QuoteStatus(status)
        q.decided_at = now_ms()
        q.updated_at = now_ms()
        self._activity(
            ctx.business_id,
            q.lead_id,
            ctx.user_id,
            "quote.accepted" if status == "ACCEPTED" else "quote.rejected",
            q.number,
            total,
        )
        await self.db.commit()
        return self._dto(await self._load(q.id))

    # -- the customer's page (no login: the unguessable link is the permission) ----------------

    async def _by_token(self, token: str) -> Quote:
        row = None
        if s.QUOTE_TOKEN_PATTERN.match(token):
            row = (
                await self.db.execute(
                    select(Quote)
                    .options(*_LOAD)
                    .where(Quote.public_token == token)
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
        # Drafts are never public (a duplicated draft has no token anyway).
        if row is None or row.status == QuoteStatus.DRAFT:
            raise AppError("NOT_FOUND")
        return row

    def _public_dto(self, q: Quote) -> s.PublicQuote:
        d = self._dto(q)
        return s.PublicQuote(
            number=d.number,
            title=d.title,
            items=d.items,
            vatRate=d.vatRate,
            notes=d.notes,
            validUntil=d.validUntil,
            status=d.status,
            expired=d.expired,
            totals=d.totals,
            sentAt=d.sentAt,
            customerName=q.lead.contact.name,
            business=s.BusinessRef(name=q.business.name, phone=q.business.phone, address=q.business.address),
        )

    async def public_get(self, token: str) -> s.PublicQuote:
        return self._public_dto(await self._by_token(token))

    async def public_decide(
        self, token: str, decision: str, sessionmaker: async_sessionmaker[AsyncSession]
    ) -> s.PublicQuote:
        """The customer accepts or rejects a sent, unexpired quote; the team is emailed."""
        q = await self._by_token(token)
        if q.status != QuoteStatus.SENT:
            raise AppError("CONFLICT", s.M["notOpen"])
        if _is_expired(q):
            raise AppError("CONFLICT", s.M["expired"])
        status = QuoteStatus.ACCEPTED if decision == "accept" else QuoteStatus.REJECTED
        total = s.quote_totals(_items(q), q.discount, float(q.vat_rate))["total"]
        # Only a still-open quote changes (two clicks can't both win).
        res = await self.db.execute(
            update(Quote)
            .where(Quote.id == q.id, Quote.status == QuoteStatus.SENT)
            .values(status=status, decided_at=now_ms(), updated_at=now_ms())
        )
        if res.rowcount == 0:
            await self.db.rollback()
            raise AppError("CONFLICT", s.M["notOpen"])
        self._activity(
            q.business_id,
            q.lead_id,
            None,
            "quote.accepted" if status == QuoteStatus.ACCEPTED else "quote.rejected",
            q.number,
            total,
        )
        await self.db.commit()
        row = await self._load(q.id)
        accepted = status == QuoteStatus.ACCEPTED
        await self._notify_in_app(row, accepted)
        # In the background; a failure is logged, never left unhandled.
        task = asyncio.create_task(self._notify_team(sessionmaker, row, accepted, total))
        _background.add(task)
        task.add_done_callback(_background.discard)
        return self._public_dto(row)

    async def _notify_in_app(self, q: Quote, accepted: bool) -> None:
        """In-app (D-097): owners/managers and whoever the lead is assigned to."""
        owner_id = (
            await self.db.execute(select(Lead.owner_id).where(Lead.id == q.lead_id))
        ).scalar_one_or_none()
        await notify_safe(
            self.db,
            business_id=q.business_id,
            type="quote.accepted" if accepted else "quote.rejected",
            data={
                "quoteId": str(q.id),
                "leadId": str(q.lead_id),
                "number": q.number,
                "name": q.lead.contact.name,
            },
            roles=MANAGERS,
            user_ids=[owner_id],
        )

    async def _notify_team(
        self, sessionmaker: async_sessionmaker[AsyncSession], q: Quote, accepted: bool, total: int
    ) -> None:
        try:
            async with sessionmaker() as db:
                team = (
                    await db.execute(
                        select(User.email, User.status)
                        .join(Membership, Membership.user_id == User.id)
                        .where(
                            Membership.business_id == q.business_id,
                            Membership.status == MembershipStatus.ACTIVE,
                            Membership.role.in_([MembershipRole.OWNER, MembershipRole.MANAGER]),
                        )
                    )
                ).all()
            mail = quote_decision_template(
                business_name=q.business.name,
                customer_name=q.lead.contact.name,
                number=q.number,
                accepted=accepted,
                total=s.format_agorot(total),
                link=f"{self.settings.APP_URL}/b/{q.business_id}/quotes/{q.id}",
                lang="en" if q.business.language == "en" else "he",
            )
            for address, status in team:
                if status != UserStatus.ACTIVE:
                    continue
                try:
                    await self.email.send(
                        EmailMessage(to=address, subject=mail.subject, html=mail.html, text=mail.text)
                    )
                except Exception as err:
                    log.error(
                        "email failed", extra={"errName": type(err).__name__, "template": "quoteDecision"}
                    )
        except Exception as err:
            log.error("quote notification failed", extra={"errName": type(err).__name__})
