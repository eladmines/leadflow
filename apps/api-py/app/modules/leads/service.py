"""Leads and CRM (F07 capture, F08 CRM), customers (D-163) and spreadsheet import (D-179).

Port of apps/api/src/modules/leads/service.ts. Tenant reads and writes are keyed by
`ctx.business_id`; employees see only leads assigned to them.
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.permissions import can
from app.core.timeutil import iso, now_ms
from app.db.models import (
    Activity,
    Appointment,
    AppointmentStatus,
    Contact,
    FormSubmission,
    Lead,
    LeadSource,
    Membership,
    MembershipStatus,
    PipelineStage,
    Quote,
    QuoteStatus,
    StageKind,
    User,
    WhatsAppMessage,
    WhatsAppNumber,
    WhatsAppNumberStatus,
)
from app.deps import TenantContext
from app.errors import AppError
from app.modules.audit import add_audit
from app.modules.leads import schemas as s
from app.shared.attribution import parse_attribution
from app.shared.phone import normalize_israeli_phone, normalize_phone

_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

_LEAD_LOAD = (joinedload(Lead.contact), joinedload(Lead.stage), joinedload(Lead.owner))


def _like(text: str) -> str:
    """A case-insensitive 'contains' pattern with LIKE wildcards escaped."""
    esc = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{esc}%"


def attribution_columns(a: dict[str, Any] | None) -> dict[str, Any]:
    """Columns for a lead's attribution (F26)."""
    return {"attribution": a, "attribution_source": a["source"]} if a else {}


async def ensure_stages(db: AsyncSession, business_id: uuid.UUID) -> list[PipelineStage]:
    """The business's pipeline stages, creating the PRD defaults the first time."""

    async def load() -> list[PipelineStage]:
        rows = await db.execute(
            select(PipelineStage)
            .where(PipelineStage.business_id == business_id)
            .order_by(PipelineStage.position.asc())
        )
        return list(rows.scalars())

    existing = await load()
    if existing:
        return existing
    now = now_ms()
    await db.execute(
        pg_insert(PipelineStage)
        .values(
            [
                {
                    "id": uuid.uuid4(),
                    "business_id": business_id,
                    "name": name,
                    "kind": StageKind(kind),
                    "position": i,
                    "created_at": now,
                }
                for i, (name, kind) in enumerate(s.DEFAULT_PIPELINE_STAGES)
            ]
        )
        .on_conflict_do_nothing()
    )
    await db.flush()
    return await load()


async def _last_whatsapp(db: AsyncSession, contact_ids: list[uuid.UUID]) -> dict[uuid.UUID, WhatsAppMessage]:
    """The latest WhatsApp message per contact (for list previews)."""
    if not contact_ids:
        return {}
    rows = await db.execute(
        select(WhatsAppMessage)
        .ext(distinct_on(WhatsAppMessage.contact_id))
        .where(WhatsAppMessage.contact_id.in_(contact_ids))
        .order_by(WhatsAppMessage.contact_id, WhatsAppMessage.created_at.desc())
    )
    return {m.contact_id: m for m in rows.scalars() if m.contact_id}


def to_lead_dto(lead: Lead, last: WhatsAppMessage | None = None) -> s.LeadOut:
    return s.LeadOut(
        id=str(lead.id),
        contact=s.ContactOut(
            id=str(lead.contact.id),
            name=lead.contact.name,
            phone=lead.contact.phone,
            email=lead.contact.email,
        ),
        stage=s.StageOut(id=str(lead.stage.id), name=lead.stage.name, kind=lead.stage.kind.value),
        source=lead.source.value,
        sourceUrl=lead.source_url,
        attribution=parse_attribution(lead.attribution),
        message=lead.message,
        owner=s.PersonOut(id=str(lead.owner.id), name=lead.owner.full_name) if lead.owner else None,
        expectedValue=lead.expected_value,
        nextActionAt=iso(lead.next_action_at) if lead.next_action_at else None,
        tags=list(lead.tags or []),
        lastWhatsApp=(
            s.LastWhatsApp(body=last.body, direction=last.direction.value, createdAt=iso(last.created_at))
            if last
            else None
        ),
        createdAt=iso(lead.created_at),
        updatedAt=iso(lead.updated_at),
    )


class LeadService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _dtos(self, leads: list[Lead]) -> list[s.LeadOut]:
        last = await _last_whatsapp(self.db, [lead.contact_id for lead in leads])
        return [to_lead_dto(lead, last.get(lead.contact_id)) for lead in leads]

    # -- visibility ------------------------------------------------------------

    def _visible(self, ctx: TenantContext) -> list[Any]:
        """Leads this member may see: everything for owner/manager, only assigned for employees."""
        conds: list[Any] = [Lead.business_id == ctx.business_id]
        if not can(ctx.role, "leads.view.all"):
            conds.append(Lead.owner_id == ctx.user_id)
        return conds

    async def find_visible(self, ctx: TenantContext, lead_id: str) -> Lead:
        """A lead this member may see, or 404. Also used by features attached to a lead."""
        lead = None
        if _UUID.match(lead_id):
            lead = (
                await self.db.execute(
                    select(Lead)
                    .options(*_LEAD_LOAD)
                    .where(Lead.id == uuid.UUID(lead_id), *self._visible(ctx))
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
        if lead is None:
            raise AppError("NOT_FOUND")
        return lead

    # -- list ------------------------------------------------------------------

    async def list_leads(self, ctx: TenantContext, q: s.LeadListQuery, take: int = 500) -> list[s.LeadOut]:
        """Newest first, with search (name / phone / email) and filters."""
        conds = self._visible(ctx)
        text = (q.q or "").strip()
        if text:
            digits = re.sub(r"\D", "", text)
            phone = normalize_israeli_phone(text)
            options = [
                Contact.name.ilike(_like(text), escape="\\"),
                Contact.email.ilike(_like(text), escape="\\"),
            ]
            if phone:
                options.append(Contact.phone == phone)
            if len(digits) >= 3:
                # "050-123" → match the national digits inside the stored E.164 number.
                options.append(Contact.phone.like(_like(re.sub(r"^0", "", digits)), escape="\\"))
            conds.append(Lead.contact.has(or_(*options)))
        if q.stageId:
            try:
                conds.append(Lead.stage_id == uuid.UUID(q.stageId))
            except ValueError as err:
                raise AppError("VALIDATION_ERROR", None, {"stageId": "Invalid uuid"}) from err
        if q.ownerId == "none":
            conds.append(Lead.owner_id.is_(None))
        elif q.ownerId:
            try:
                conds.append(Lead.owner_id == uuid.UUID(q.ownerId))
            except ValueError as err:
                raise AppError("VALIDATION_ERROR", None, {"ownerId": "Invalid uuid"}) from err
        if q.source:
            conds.append(Lead.source == LeadSource(q.source))
        if q.from_:
            if q.from_ == "unknown":
                # Direct visits from other websites (F32) are stored as "direct": unknown too.
                conds.append(or_(Lead.attribution_source.is_(None), Lead.attribution_source == "direct"))
            else:
                conds.append(Lead.attribution_source == q.from_)
        if q.campaign:
            conds.append(Lead.attribution["campaign"].astext == q.campaign)
        if q.tag:
            conds.append(Lead.tags.contains([q.tag]))
        rows = await self.db.execute(
            select(Lead).options(*_LEAD_LOAD).where(*conds).order_by(Lead.created_at.desc()).limit(take)
        )
        return await self._dtos(list(rows.scalars().unique()))

    async def tags(self, ctx: TenantContext) -> list[str]:
        """Tags on the leads this member can see, most used first."""
        rows = await self.db.execute(
            select(Lead.tags)
            .where(*self._visible(ctx), func.cardinality(Lead.tags) > 0)
            .order_by(Lead.created_at.desc())
            .limit(2000)
        )
        counts: dict[str, int] = {}
        for (tags,) in rows:
            for tag in tags:
                counts[tag] = counts.get(tag, 0) + 1
        ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        return [t for t, _ in ordered][:100]

    async def pipeline(self, ctx: TenantContext) -> list[s.PipelineStageOut]:
        stages = await ensure_stages(self.db, ctx.business_id)
        await self.db.commit()
        return [
            s.PipelineStageOut(id=str(st.id), name=st.name, position=st.position, kind=st.kind.value)
            for st in stages
        ]

    # -- detail ----------------------------------------------------------------

    async def detail(self, ctx: TenantContext, lead_id: str) -> s.LeadDetailResponse:
        lead = await self.find_visible(ctx, lead_id)
        rows = (
            (
                await self.db.execute(
                    select(Activity)
                    .where(Activity.business_id == ctx.business_id, Activity.lead_id == lead.id)
                    .order_by(Activity.created_at.desc())
                    .limit(200)
                )
            )
            .scalars()
            .all()
        )
        actor_ids = {r.actor_id for r in rows if r.actor_id}
        actors: dict[uuid.UUID, str] = {}
        if actor_ids:
            res = await self.db.execute(select(User.id, User.full_name).where(User.id.in_(actor_ids)))
            actors = {uid: name for uid, name in res}
        activities = [
            s.ActivityOut(
                id=str(r.id),
                type=r.type,
                data=r.data or {},
                actor=s.PersonOut(id=str(r.actor_id), name=actors.get(r.actor_id, ""))
                if r.actor_id
                else None,
                createdAt=iso(r.created_at),
            )
            for r in rows
            if r.type in s.ACTIVITY_TYPES
        ]
        return s.LeadDetailResponse(lead=(await self._dtos([lead]))[0], activities=activities)

    # -- checks ----------------------------------------------------------------

    async def _require_stage(self, business_id: uuid.UUID, stage_id: uuid.UUID) -> PipelineStage:
        stage = (
            await self.db.execute(
                select(PipelineStage).where(
                    PipelineStage.id == stage_id, PipelineStage.business_id == business_id
                )
            )
        ).scalar_one_or_none()
        if stage is None:
            msg = s.CRM_MESSAGES["stageInvalid"]
            raise AppError("VALIDATION_ERROR", msg, {"stageId": msg})
        return stage

    async def _require_member(self, business_id: uuid.UUID, user_id: uuid.UUID) -> User:
        user = (
            await self.db.execute(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    Membership.business_id == business_id,
                    Membership.user_id == user_id,
                    Membership.status == MembershipStatus.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if user is None:
            msg = s.CRM_MESSAGES["ownerInvalid"]
            raise AppError("VALIDATION_ERROR", msg, {"ownerId": msg})
        return user

    # -- create ----------------------------------------------------------------

    async def create(self, ctx: TenantContext, data: s.CreateLeadRequest) -> s.LeadOut:
        """Manual lead. Employees' leads are assigned to themselves; the contact is reused by
        phone/email."""
        if not (data.phone or data.email):
            msg = s.CRM_MESSAGES["contactRequired"]
            raise AppError("VALIDATION_ERROR", None, {"phone": msg})
        can_assign = can(ctx.role, "leads.assign")
        if data.ownerId is not None and not can_assign and data.ownerId != ctx.user_id:
            raise AppError("FORBIDDEN")

        stages = await ensure_stages(self.db, ctx.business_id)
        stage = await self._require_stage(ctx.business_id, data.stageId) if data.stageId else stages[0]
        await self._require_quote_for_stage(None, stage)
        owner_id = data.ownerId if can_assign else ctx.user_id
        if owner_id:
            await self._require_member(ctx.business_id, owner_id)

        match = []
        if data.phone:
            match.append(Contact.phone == data.phone)
        if data.email:
            match.append(Contact.email == data.email)
        existing = (
            await self.db.execute(
                select(Contact)
                .where(Contact.business_id == ctx.business_id, or_(*match))
                .order_by(Contact.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        now = now_ms()
        contact = existing
        if contact is None:
            contact = Contact(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                name=data.name,
                phone=data.phone,
                email=data.email,
                created_at=now,
                updated_at=now,
            )
            self.db.add(contact)
            await self.db.flush()
        lead = Lead(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            contact_id=contact.id,
            stage_id=stage.id,
            owner_id=owner_id,
            source=LeadSource.MANUAL,
            message=data.message,
            expected_value=data.expectedValue,
            tags=[],
            created_at=now,
            updated_at=now,
        )
        self.db.add(lead)
        await self.db.flush()
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                lead_id=lead.id,
                actor_id=ctx.user_id,
                type="lead.created",
                data={"source": "manual", "contactReused": existing is not None},
                created_at=now,
            )
        )
        add_audit(
            self.db,
            "lead.created",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="lead",
            entity_id=lead.id,
            metadata={"source": "manual"},
        )
        await self.db.commit()
        return (await self._dtos([await self.find_visible(ctx, str(lead.id))]))[0]

    async def create_from_website(
        self,
        business_id: uuid.UUID,
        site_id: uuid.UUID | None,
        idempotency_key: str,
        ip_hash: str,
        source_url: str,
        data: s.LeadSubmission,
        attribution: dict[str, Any] | None = None,
    ) -> tuple[s.LeadOut, bool]:
        """A lead from a website form: reuses the contact with the same phone (no lost source:
        every submission is its own lead), first pipeline stage, activity + audit, one
        transaction. The same idempotency key twice returns the existing lead (created=False).
        `site_id` is None for a form on a website built elsewhere (F30)."""
        dup = await self._find_by_idempotency_key(business_id, site_id, idempotency_key)
        if dup:
            return dup, False
        try:
            first = (await ensure_stages(self.db, business_id))[0]
            now = now_ms()
            existing = (
                await self.db.execute(
                    select(Contact)
                    .where(Contact.business_id == business_id, Contact.phone == data.phone)
                    .order_by(Contact.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if existing:
                # Keep the stored name; fill in an email we didn't have.
                if data.email and not existing.email:
                    existing.email = data.email
                contact = existing
            else:
                contact = Contact(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    name=data.name,
                    phone=data.phone,
                    email=data.email,
                    created_at=now,
                    updated_at=now,
                )
                self.db.add(contact)
                await self.db.flush()
            lead = Lead(
                id=uuid.uuid4(),
                business_id=business_id,
                contact_id=contact.id,
                stage_id=first.id,
                source=LeadSource.WEBSITE_FORM,
                source_url=source_url,
                message=data.message,
                tags=[],
                created_at=now,
                updated_at=now,
                **attribution_columns(attribution),
            )
            self.db.add(lead)
            await self.db.flush()
            self.db.add(
                FormSubmission(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    site_id=site_id,
                    idempotency_key=idempotency_key,
                    payload={
                        "name": data.name,
                        "phone": data.phone,
                        "email": data.email,
                        "message": data.message,
                    },
                    consent_at=now,
                    ip_hash=ip_hash,
                    lead_id=lead.id,
                    created_at=now,
                )
            )
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    lead_id=lead.id,
                    type="lead.created",
                    data={"source": "website_form", "contactReused": existing is not None},
                    created_at=now,
                )
            )
            add_audit(
                self.db,
                "lead.created",
                business_id=business_id,
                entity_type="lead",
                entity_id=lead.id,
                metadata={"source": "website_form"},
            )
            await self.db.commit()
        except IntegrityError:
            # Two identical submissions racing: the second hits the unique key → return the first.
            await self.db.rollback()
            again = await self._find_by_idempotency_key(business_id, site_id, idempotency_key)
            if again:
                return again, False
            raise
        row = (
            await self.db.execute(
                select(Lead)
                .options(*_LEAD_LOAD)
                .where(Lead.id == lead.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        return (await self._dtos([row]))[0], True

    async def _find_by_idempotency_key(
        self, business_id: uuid.UUID, site_id: uuid.UUID | None, key: str
    ) -> s.LeadOut | None:
        cond = [FormSubmission.idempotency_key == key]
        cond.append(FormSubmission.site_id == site_id if site_id else FormSubmission.site_id.is_(None))
        cond.append(FormSubmission.business_id == business_id)
        lead_id = (
            await self.db.execute(select(FormSubmission.lead_id).where(*cond).limit(1))
        ).scalar_one_or_none()
        if lead_id is None:
            return None
        lead = (
            await self.db.execute(select(Lead).options(*_LEAD_LOAD).where(Lead.id == lead_id))
        ).scalar_one()
        return (await self._dtos([lead]))[0]

    # -- update / notes / delete ----------------------------------------------------

    async def _require_quote_for_stage(self, lead_id: uuid.UUID | None, stage: PipelineStage) -> None:
        """ "Quote sent" means a quote went out: a lead can only be put there once one was sent to it
        (sending a quote moves the lead there by itself)."""
        if stage.name != s.QUOTE_SENT_STAGE:
            return
        if lead_id is not None:
            sent = await self.db.execute(
                select(exists().where(Quote.lead_id == lead_id, Quote.status != QuoteStatus.DRAFT))
            )
            if sent.scalar():
                return
        raise AppError("VALIDATION_ERROR", s.QUOTE_STAGE_NEEDS_QUOTE, {"stageId": s.QUOTE_STAGE_NEEDS_QUOTE})

    async def update(self, ctx: TenantContext, lead_id: str, data: s.UpdateLeadRequest) -> s.LeadOut:
        """Updates a visible lead; stage moves, assignments and field edits each land in the
        history."""
        given = data.model_fields_set
        if "ownerId" in given and not can(ctx.role, "leads.assign"):
            raise AppError("FORBIDDEN")
        lead = await self.find_visible(ctx, lead_id)
        activities: list[tuple[str, dict[str, Any]]] = []
        owner_changed = False

        if "stageId" in given and data.stageId is not None and data.stageId != lead.stage_id:
            stage = await self._require_stage(ctx.business_id, data.stageId)
            await self._require_quote_for_stage(lead.id, stage)
            activities.append(
                (
                    "lead.stage_changed",
                    {"from": lead.stage.name, "to": stage.name, "toKind": stage.kind.value},
                )
            )
            lead.stage_id = stage.id
        if "ownerId" in given and data.ownerId != lead.owner_id:
            owner = await self._require_member(ctx.business_id, data.ownerId) if data.ownerId else None
            lead.owner_id = owner.id if owner else None
            owner_changed = True
            activities.append(("lead.assigned", {"to": owner.full_name if owner else None}))
        changed: list[str] = []
        if "expectedValue" in given and data.expectedValue != lead.expected_value:
            lead.expected_value = data.expectedValue
            changed.append("expectedValue")
        if "nextActionAt" in given:
            nxt = _parse_datetime(data.nextActionAt)
            if nxt != lead.next_action_at:
                lead.next_action_at = nxt
                changed.append("nextActionAt")
        if "message" in given and data.message != lead.message:
            lead.message = data.message
            changed.append("message")
        if "tags" in given and data.tags is not None and data.tags != list(lead.tags or []):
            lead.tags = data.tags
            changed.append("tags")
        if changed:
            activities.append(("lead.updated", {"fields": changed}))
        if not activities:
            return (await self._dtos([lead]))[0]

        now = now_ms()
        lead.updated_at = now
        for kind, payload in activities:
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    lead_id=lead.id,
                    actor_id=ctx.user_id,
                    type=kind,
                    data=payload,
                    created_at=now,
                )
            )
        if owner_changed:
            add_audit(
                self.db,
                "lead.assigned",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="lead",
                entity_id=lead.id,
            )
        await self.db.commit()
        return (await self._dtos([await self.find_visible(ctx, str(lead.id))]))[0]

    async def add_note(self, ctx: TenantContext, lead_id: str, text: str) -> s.ActivityOut:
        lead = await self.find_visible(ctx, lead_id)
        row = Activity(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            lead_id=lead.id,
            actor_id=ctx.user_id,
            type="lead.note",
            data={"text": text},
            created_at=now_ms(),
        )
        self.db.add(row)
        name = (
            await self.db.execute(select(User.full_name).where(User.id == ctx.user_id))
        ).scalar_one_or_none()
        await self.db.commit()
        return s.ActivityOut(
            id=str(row.id),
            type="lead.note",
            data={"text": text},
            actor=s.PersonOut(id=str(ctx.user_id), name=name or ""),
            createdAt=iso(row.created_at),
        )

    async def remove(self, ctx: TenantContext, lead_id: str) -> None:
        """Deletes a lead with its history and form submission. Linked tasks stay, unlinked. The
        contact goes too when no other lead uses it, so a deletion request leaves no personal data
        behind."""
        lead = await self.find_visible(ctx, lead_id)
        contact_id, phone, lid = lead.contact_id, lead.contact.phone, lead.id
        # Core deletes: the database's foreign keys cascade or unlink the dependents.
        await self.db.execute(delete(Lead).where(Lead.id == lid))
        remaining = (
            await self.db.execute(select(func.count()).select_from(Lead).where(Lead.contact_id == contact_id))
        ).scalar_one()
        contact_removed = remaining == 0
        if contact_removed:
            await self.db.execute(delete(Contact).where(Contact.id == contact_id))
            # Its WhatsApp number goes too (with any messages), so the phone isn't kept (D-092).
            if phone:
                await self.db.execute(
                    delete(WhatsAppNumber).where(
                        WhatsAppNumber.business_id == ctx.business_id,
                        WhatsAppNumber.phone == phone,
                        WhatsAppNumber.status == WhatsAppNumberStatus.BUSINESS,
                    )
                )
        add_audit(
            self.db,
            "lead.deleted",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="lead",
            entity_id=lid,
            metadata={"contactRemoved": contact_removed},
        )
        await self.db.commit()
        self.db.expunge_all()

    async def duplicates(
        self, ctx: TenantContext, phone: str | None, email: str | None
    ) -> list[s.DuplicateContact]:
        """Existing contacts with this phone or email (duplicate warning before creating a lead).
        Only for members who can see all leads; employees get an empty list (the server still
        reuses the contact), so the check can't be used to discover other people's leads."""
        if not can(ctx.role, "leads.view.all"):
            return []
        e164 = normalize_israeli_phone(phone) if phone else None
        mail = (email or "").strip().lower() or None
        if not e164 and not mail:
            return []
        match = ([Contact.phone == e164] if e164 else []) + ([Contact.email == mail] if mail else [])
        rows = await self.db.execute(
            select(Contact, func.count(Lead.id))
            .outerjoin(Lead, Lead.contact_id == Contact.id)
            .where(Contact.business_id == ctx.business_id, or_(*match))
            .group_by(Contact.id)
            .limit(5)
        )
        return [
            s.DuplicateContact(id=str(c.id), name=c.name, phone=c.phone, email=c.email, leadCount=n)
            for c, n in rows
        ]

    # -- customers -------------------------------------------------------------------

    async def customers(self, ctx: TenantContext, q: str | None = None) -> list[s.Customer]:
        """Customers (D-163, D-178): contacts with a lead in a Won stage or an accepted quote (the
        same rule as Reports), plus contacts with a booked appointment (confirmed, done, missed or
        cancelled). Employees see customers from leads assigned to them and appointments they
        hold."""
        text = (q or "").strip()
        contact_filter = None
        if text:
            digits = re.sub(r"\D", "", text)
            options = [
                Contact.name.ilike(_like(text), escape="\\"),
                Contact.email.ilike(_like(text), escape="\\"),
            ]
            if len(digits) >= 3:
                options.append(Contact.phone.like(_like(re.sub(r"^0", "", digits)), escape="\\"))
            contact_filter = or_(*options)

        conds = [
            *self._visible(ctx),
            or_(
                Lead.stage.has(PipelineStage.kind == StageKind.WON),
                Lead.quotes.any(Quote.status == QuoteStatus.ACCEPTED),
            ),
        ]
        if contact_filter is not None:
            conds.append(Lead.contact.has(contact_filter))
        leads = (
            (
                await self.db.execute(
                    select(Lead)
                    .options(joinedload(Lead.contact), joinedload(Lead.stage))
                    .where(*conds)
                    .order_by(Lead.created_at.asc())
                    .limit(5000)
                )
            )
            .scalars()
            .unique()
            .all()
        )
        decided: dict[uuid.UUID, datetime] = {}
        if leads:
            res = await self.db.execute(
                select(Quote.lead_id, func.max(Quote.decided_at))
                .where(Quote.lead_id.in_([lead.id for lead in leads]), Quote.status == QuoteStatus.ACCEPTED)
                .group_by(Quote.lead_id)
            )
            decided = {lid: at for lid, at in res if at}

        by_contact: dict[uuid.UUID, dict[str, Any]] = {}
        for lead in leads:
            at = iso(decided.get(lead.id) or lead.updated_at)
            c = by_contact.get(lead.contact.id)
            if c is None:
                c = {
                    "contactId": str(lead.contact.id),
                    "name": lead.contact.name,
                    "phone": lead.contact.phone,
                    "email": lead.contact.email,
                    "totalValue": 0,
                    "lastPurchaseAt": at,
                    "lastActivityAt": at,
                    # Oldest lead first: where they first came from.
                    "attribution": parse_attribution(lead.attribution),
                    "purchases": [],
                    "bookings": [],
                }
                by_contact[lead.contact.id] = c
            c["totalValue"] += lead.expected_value or 0
            if not c["lastPurchaseAt"] or at > c["lastPurchaseAt"]:
                c["lastPurchaseAt"] = at
            if at > c["lastActivityAt"]:
                c["lastActivityAt"] = at
            c["purchases"].insert(
                0,
                {
                    "leadId": str(lead.id),
                    "at": at,
                    "value": lead.expected_value,
                    "via": "won" if lead.stage.kind == StageKind.WON else "quote",
                },
            )

        # People who booked: anything but a request still waiting for approval.
        appt_conds: list[Any] = [
            Appointment.business_id == ctx.business_id,
            Appointment.status.in_([AppointmentStatus(x) for x in s.CUSTOMER_BOOKING_STATUSES]),
        ]
        if not can(ctx.role, "appointments.view.all"):
            appt_conds.append(Appointment.staff_id == ctx.user_id)
        if contact_filter is not None:
            appt_conds.append(Appointment.contact.has(contact_filter))
        appointments = (
            (
                await self.db.execute(
                    select(Appointment)
                    .options(
                        joinedload(Appointment.contact),
                        joinedload(Appointment.service),
                        joinedload(Appointment.lead),
                    )
                    .where(*appt_conds)
                    .order_by(Appointment.starts_at.asc())
                    .limit(5000)
                )
            )
            .scalars()
            .unique()
            .all()
        )
        for a in appointments:
            at = iso(a.starts_at)
            c = by_contact.get(a.contact.id)
            if c is None:
                c = {
                    "contactId": str(a.contact.id),
                    "name": a.contact.name,
                    "phone": a.contact.phone,
                    "email": a.contact.email,
                    "totalValue": 0,
                    "lastPurchaseAt": None,
                    "lastActivityAt": at,
                    "attribution": parse_attribution(a.lead.attribution) if a.lead else None,
                    "purchases": [],
                    "bookings": [],
                }
                by_contact[a.contact.id] = c
            if at > c["lastActivityAt"]:
                c["lastActivityAt"] = at
            c["bookings"].append(
                {
                    "appointmentId": str(a.id),
                    "startsAt": at,
                    "status": a.status.value,
                    "serviceName": a.service.name if a.service else None,
                    "leadId": str(a.lead_id) if a.lead_id else None,
                }
            )

        customers = list(by_contact.values())
        for c in customers:
            c["purchases"].sort(key=lambda p: p["at"], reverse=True)
            c["bookings"].sort(key=lambda b: b["startsAt"], reverse=True)
        customers.sort(key=lambda c: c["lastActivityAt"], reverse=True)
        return [s.Customer(**c) for c in customers]

    async def import_customers(
        self, ctx: TenantContext, rows: list[s.ImportCustomerRow]
    ) -> s.ImportCustomersResponse:
        """Import customers (D-179): each valid row becomes a contact (reused by phone or email)
        with a lead in the first Won stage, which is what the Customers page lists. A person who
        is already a customer, or who appears twice in the file, is counted, not duplicated. Bad
        rows are reported with their row number; the rest are still imported."""
        m = s.IMPORT_MESSAGES
        invalid: list[s.InvalidRow] = []
        valid: list[dict[str, Any]] = []
        for idx, r in enumerate(rows):
            row = idx + 1
            name = (r.name or "").strip()
            phone_raw = (r.phone or "").strip()
            email_raw = (r.email or "").strip().lower()
            reason = None
            phone = None
            value = None
            if len(name) < 2 or len(name) > 80:
                reason = m["nameInvalid"]
            elif not phone_raw and not email_raw:
                reason = m["contactMissing"]
            else:
                phone = normalize_phone(phone_raw) if phone_raw else None
                if phone_raw and not phone:
                    reason = m["phoneInvalid"]
                elif email_raw and (not _EMAIL.match(email_raw) or len(email_raw) > 254):
                    reason = m["emailInvalid"]
                else:
                    value = s.parse_import_value(r.value)
                    if value == "invalid":
                        reason = m["valueInvalid"]
            if reason:
                invalid.append(s.InvalidRow(row=row, reason=reason))
            else:
                valid.append({"name": name, "phone": phone, "email": email_raw or None, "value": value})

        stages = await ensure_stages(self.db, ctx.business_id)
        won = next((st for st in stages if st.kind == StageKind.WON), None)
        if won is None:
            raise AppError("VALIDATION_ERROR", m["noRows"])
        imported = duplicates = 0
        for r in valid:
            match = ([Contact.phone == r["phone"]] if r["phone"] else []) + (
                [Contact.email == r["email"]] if r["email"] else []
            )
            existing = (
                await self.db.execute(
                    select(Contact)
                    .where(Contact.business_id == ctx.business_id, or_(*match))
                    .order_by(Contact.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if existing:
                already = (
                    await self.db.execute(
                        select(Lead.id)
                        .join(PipelineStage, PipelineStage.id == Lead.stage_id)
                        .where(
                            Lead.business_id == ctx.business_id,
                            Lead.contact_id == existing.id,
                            PipelineStage.kind == StageKind.WON,
                        )
                        .limit(1)
                    )
                ).first()
                if already:
                    duplicates += 1
                    continue
            now = now_ms()
            contact = existing
            if contact is None:
                contact = Contact(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    name=r["name"],
                    phone=r["phone"],
                    email=r["email"],
                    created_at=now,
                    updated_at=now,
                )
                self.db.add(contact)
                await self.db.flush()
            lead = Lead(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                contact_id=contact.id,
                stage_id=won.id,
                owner_id=None,
                source=LeadSource.MANUAL,
                expected_value=r["value"],
                tags=[],
                created_at=now,
                updated_at=now,
            )
            self.db.add(lead)
            await self.db.flush()
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    lead_id=lead.id,
                    actor_id=ctx.user_id,
                    type="lead.created",
                    data={"source": "manual", "imported": True, "contactReused": existing is not None},
                    created_at=now,
                )
            )
            imported += 1
        add_audit(
            self.db,
            "customers.imported",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="customer",
            metadata={"imported": imported, "duplicates": duplicates, "invalid": len(invalid)},
        )
        await self.db.commit()
        return s.ImportCustomersResponse(imported=imported, duplicates=duplicates, invalid=invalid)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError as err:
        raise AppError("VALIDATION_ERROR", None, {"nextActionAt": "Invalid datetime"}) from err
