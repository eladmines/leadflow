"""Services and appointments (F17), plus the booking paths used by the WhatsApp bot and the website.

Port of apps/api/src/modules/appointments/service.ts. Appointments never overlap for one staff
member: a per-staff advisory lock makes two simultaneous bookings for the same slot impossible.
"""

import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.dates import format_when
from app.core.permissions import can
from app.core.timeutil import iso, now_ms
from app.db.models import (
    Activity,
    Appointment,
    AppointmentStatus,
    Business,
    Contact,
    Lead,
    Membership,
    MembershipRole,
    MembershipStatus,
    Service,
    Task,
)
from app.deps import TenantContext
from app.errors import AppError
from app.modules.appointments import schemas as s
from app.modules.tasks import auto as task_auto
from app.shared.tasks import APPOINTMENT_CONFIRM, appointment_confirm_due_at, titles_for

DEFAULT_DURATION = 30
CALL_BACK_MINUTES = 15  # how long a WhatsApp call-back holds in the calendar (D-171)
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)
_BLOCKING = [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED]
_LOAD = (joinedload(Appointment.service), joinedload(Appointment.staff), joinedload(Appointment.contact))


def _invalid(field: str, message: str) -> AppError:
    return AppError("VALIDATION_ERROR", message, {field: message})


def service_dto(x: Service) -> s.ServiceOut:
    return s.ServiceOut(id=str(x.id), name=x.name, durationMin=x.duration_min, price=x.price, active=x.active)


def to_dto(a: Appointment) -> s.AppointmentOut:
    return s.AppointmentOut(
        id=str(a.id),
        startsAt=iso(a.starts_at),
        endsAt=iso(a.ends_at),
        status=a.status.value,
        notes=a.notes,
        source=a.source if a.source in ("website", "whatsapp") else "manual",
        service=s.IdName(id=str(a.service.id), name=a.service.name) if a.service else None,
        staff=s.IdName(id=str(a.staff.id), name=a.staff.full_name) if a.staff else None,
        customer=s.CustomerOut(id=str(a.contact.id), name=a.contact.name, phone=a.contact.phone),
        lead=s.IdOnly(id=str(a.lead_id)) if a.lead_id else None,
        createdAt=iso(a.created_at),
    )


class AppointmentService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # -- services --------------------------------------------------------------------

    async def list_services(self, ctx: TenantContext) -> list[s.ServiceOut]:
        rows = await self.db.execute(
            select(Service)
            .where(Service.business_id == ctx.business_id)
            .order_by(Service.active.desc(), Service.name.asc())
        )
        return [service_dto(x) for x in rows.scalars()]

    async def create_service(self, ctx: TenantContext, data: s.UpsertServiceRequest) -> s.ServiceOut:
        now = now_ms()
        row = Service(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            name=data.name,
            duration_min=data.durationMin,
            price=data.price,
            active=data.active,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        await self.db.commit()
        return service_dto(row)

    async def _find_service(self, ctx: TenantContext, service_id: str) -> Service:
        row = None
        if _UUID.match(service_id):
            row = (
                await self.db.execute(
                    select(Service).where(
                        Service.id == uuid.UUID(service_id), Service.business_id == ctx.business_id
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            raise AppError("NOT_FOUND")
        return row

    async def update_service(
        self, ctx: TenantContext, service_id: str, data: s.UpsertServiceRequest
    ) -> s.ServiceOut:
        row = await self._find_service(ctx, service_id)
        row.name, row.duration_min, row.price, row.active = (
            data.name,
            data.durationMin,
            data.price,
            data.active,
        )
        row.updated_at = now_ms()
        await self.db.commit()
        return service_dto(row)

    async def remove_service(self, ctx: TenantContext, service_id: str) -> None:
        """Unused services are deleted; services with appointments are deactivated (history stays)."""
        row = await self._find_service(ctx, service_id)
        used = (
            await self.db.execute(
                select(func.count()).select_from(Appointment).where(Appointment.service_id == row.id)
            )
        ).scalar_one()
        if used:
            row.active = False
            row.updated_at = now_ms()
        else:
            await self.db.execute(delete(Service).where(Service.id == row.id))
        await self.db.commit()

    # -- appointments -----------------------------------------------------------------

    def _visible(self, ctx: TenantContext) -> list[Any]:
        """Owner/manager: everything; employee: appointments they are booked on."""
        conds: list[Any] = [Appointment.business_id == ctx.business_id]
        if not can(ctx.role, "appointments.view.all"):
            conds.append(Appointment.staff_id == ctx.user_id)
        return conds

    async def _load(self, appointment_id: uuid.UUID) -> Appointment:
        return (
            await self.db.execute(
                select(Appointment)
                .options(*_LOAD)
                .where(Appointment.id == appointment_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def _find_visible(self, ctx: TenantContext, appointment_id: str) -> Appointment:
        row = None
        if _UUID.match(appointment_id):
            row = (
                await self.db.execute(
                    select(Appointment)
                    .options(*_LOAD)
                    .where(Appointment.id == uuid.UUID(appointment_id), *self._visible(ctx))
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
        if row is None:
            raise AppError("NOT_FOUND")
        return row

    async def _require_staff(self, ctx: TenantContext, staff_id: uuid.UUID) -> None:
        if staff_id != ctx.user_id and not can(ctx.role, "appointments.view.all"):
            raise AppError("FORBIDDEN")
        member = (
            await self.db.execute(
                select(Membership.id).where(
                    Membership.business_id == ctx.business_id,
                    Membership.user_id == staff_id,
                    Membership.status == MembershipStatus.ACTIVE,
                )
            )
        ).first()
        if member is None:
            raise _invalid("staffId", s.M["staffInvalid"])

    async def _require_service(self, ctx: TenantContext, service_id: uuid.UUID) -> Service:
        row = (
            await self.db.execute(
                select(Service).where(Service.id == service_id, Service.business_id == ctx.business_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise _invalid("serviceId", s.M["serviceInvalid"])
        return row

    async def _assert_free(
        self,
        db: AsyncSession,
        business_id: uuid.UUID,
        staff_id: uuid.UUID,
        starts_at: datetime,
        ends_at: datetime,
        except_id: uuid.UUID | None = None,
    ) -> None:
        """Refuses an overlapping REQUESTED/CONFIRMED appointment for the same staff member. A
        per-staff transaction lock makes two simultaneous bookings for one slot impossible."""
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"appt:{staff_id}"})
        conds = [
            Appointment.business_id == business_id,
            Appointment.staff_id == staff_id,
            Appointment.status.in_(_BLOCKING),
            Appointment.starts_at < ends_at,
            Appointment.ends_at > starts_at,
        ]
        if except_id:
            conds.append(Appointment.id != except_id)
        if (await db.execute(select(Appointment.id).where(*conds).limit(1))).first():
            raise AppError("CONFLICT", s.M["clash"])

    async def list_appointments(
        self, ctx: TenantContext, q: s.AppointmentListQuery
    ) -> list[s.AppointmentOut]:
        conds = [*self._visible(ctx), Appointment.starts_at < q.end, Appointment.ends_at > q.start]
        if q.staffId:
            try:
                conds.append(
                    Appointment.staff_id == (ctx.user_id if q.staffId == "me" else uuid.UUID(q.staffId))
                )
            except ValueError as err:
                raise AppError("VALIDATION_ERROR", None, {"staffId": "Invalid uuid"}) from err
        if q.leadId:
            conds.append(Appointment.lead_id == q.leadId)
        if q.status:
            conds.append(Appointment.status == AppointmentStatus(q.status))
        rows = await self.db.execute(
            select(Appointment)
            .options(*_LOAD)
            .where(*conds)
            .order_by(Appointment.starts_at.asc())
            .limit(1000)
        )
        return [to_dto(a) for a in rows.scalars().unique()]

    async def requests(self, ctx: TenantContext) -> list[s.AppointmentOut]:
        """Website requests waiting for a decision (owners/managers see all of them)."""
        conds: list[Any] = [
            Appointment.business_id == ctx.business_id,
            Appointment.status == AppointmentStatus.REQUESTED,
        ]
        if not can(ctx.role, "appointments.view.all"):
            conds.append(Appointment.staff_id == ctx.user_id)
        rows = await self.db.execute(
            select(Appointment).options(*_LOAD).where(*conds).order_by(Appointment.starts_at.asc()).limit(200)
        )
        return [to_dto(a) for a in rows.scalars().unique()]

    async def create(self, ctx: TenantContext, data: s.CreateAppointmentRequest) -> s.AppointmentOut:
        if not (data.leadId or data.customer):
            raise _invalid("leadId", s.M["customerRequired"])
        staff_id = data.staffId if "staffId" in data.model_fields_set else ctx.user_id
        if staff_id:
            await self._require_staff(ctx, staff_id)
        elif not can(ctx.role, "appointments.view.all"):
            raise AppError("FORBIDDEN")
        service = await self._require_service(ctx, data.serviceId) if data.serviceId else None
        starts_at = data.startsAt
        minutes = data.durationMin or (service.duration_min if service else DEFAULT_DURATION)
        ends_at = starts_at + timedelta(minutes=minutes)

        # The customer: a visible lead, or a contact matched/created by phone.
        lead_id: uuid.UUID | None = None
        now = now_ms()
        if data.leadId:
            conds = [Lead.id == data.leadId, Lead.business_id == ctx.business_id]
            if not can(ctx.role, "leads.view.all"):
                conds.append(Lead.owner_id == ctx.user_id)
            lead = (await self.db.execute(select(Lead.id, Lead.contact_id).where(*conds))).first()
            if lead is None:
                raise _invalid("leadId", s.M["leadInvalid"])
            lead_id, contact_id = lead
        else:
            assert data.customer is not None
            existing = (
                await self.db.execute(
                    select(Contact.id)
                    .where(Contact.business_id == ctx.business_id, Contact.phone == data.customer.phone)
                    .order_by(Contact.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if existing:
                contact_id = existing
            else:
                contact_id = uuid.uuid4()
                self.db.add(
                    Contact(
                        id=contact_id,
                        business_id=ctx.business_id,
                        name=data.customer.name,
                        phone=data.customer.phone,
                        created_at=now,
                        updated_at=now,
                    )
                )
                await self.db.flush()

        if staff_id:
            await self._assert_free(self.db, ctx.business_id, staff_id, starts_at, ends_at)
        appt = Appointment(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            contact_id=contact_id,
            lead_id=lead_id,
            service_id=service.id if service else None,
            staff_id=staff_id,
            starts_at=starts_at,
            ends_at=ends_at,
            status=AppointmentStatus.CONFIRMED if staff_id else AppointmentStatus.REQUESTED,
            source="manual",
            notes=data.notes,
            created_by_id=ctx.user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(appt)
        await self.db.flush()
        created = await self._load(appt.id)
        if lead_id:
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    lead_id=lead_id,
                    actor_id=ctx.user_id,
                    type="appointment.created",
                    data={
                        "startsAt": iso(starts_at),
                        "service": created.service.name if created.service else None,
                        "staff": created.staff.full_name if created.staff else None,
                    },
                    created_at=now,
                )
            )
        # F35: the team's booking gets its confirm task (same transaction).
        await task_auto.on_appointment_booked(self.db, created, ctx.user_id)
        await self.db.commit()
        return to_dto(created)

    async def update(
        self, ctx: TenantContext, appointment_id: str, data: s.UpdateAppointmentRequest
    ) -> s.AppointmentOut:
        appt = await self._find_visible(ctx, appointment_id)
        given = data.model_fields_set
        staff_id = appt.staff_id
        staff_changed = False
        if "staffId" in given and data.staffId != appt.staff_id:
            if data.staffId:
                await self._require_staff(ctx, data.staffId)
            elif not can(ctx.role, "appointments.view.all"):
                raise AppError("FORBIDDEN")
            staff_id = data.staffId
            appt.staff_id = staff_id
            staff_changed = True
        service_changed = "serviceId" in given and data.serviceId != appt.service_id
        if service_changed:
            if data.serviceId:
                await self._require_service(ctx, data.serviceId)
            appt.service_id = data.serviceId
        previous_status = appt.status
        previous_start = appt.starts_at
        starts_at = data.startsAt or appt.starts_at
        minutes = data.durationMin or (appt.ends_at - appt.starts_at).total_seconds() / 60
        ends_at = starts_at + timedelta(minutes=minutes)
        time_changed = bool(data.startsAt or data.durationMin)
        if time_changed:
            appt.starts_at, appt.ends_at = starts_at, ends_at
        status = AppointmentStatus(data.status) if data.status else previous_status
        status_changed = bool(data.status) and status != previous_status
        if status_changed:
            appt.status = status
        if status == AppointmentStatus.CONFIRMED and not staff_id:
            raise _invalid("staffId", s.M["staffRequired"])
        notes_changed = "notes" in given
        if notes_changed:
            appt.notes = data.notes

        # Re-check the slot whenever the booking (still) holds time and its time or staff changed.
        holds_time = status in _BLOCKING
        moved = (
            bool(data.startsAt)
            or time_changed
            or staff_changed
            or (data.status is not None and previous_status not in _BLOCKING)
        )
        if staff_id and holds_time and moved:
            await self._assert_free(self.db, ctx.business_id, staff_id, starts_at, ends_at, appt.id)
        # (Tracked explicitly: the clash query above auto-flushes, so `is_modified` can't tell.)
        if not (time_changed or staff_changed or status_changed or notes_changed or service_changed):
            return to_dto(appt)

        appt.updated_at = now_ms()
        if appt.lead_id:
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    lead_id=appt.lead_id,
                    actor_id=ctx.user_id,
                    type="appointment.updated",
                    data={
                        "startsAt": iso(appt.starts_at),
                        "status": appt.status.value,
                        **({"statusChanged": True} if status_changed else {}),
                    },
                    created_at=now_ms(),
                )
            )
        # F35: move, hand over or close the open confirm task.
        await task_auto.on_appointment_changed(
            self.db,
            appt,
            time_changed=bool(data.startsAt) and starts_at != previous_start,
            staff_changed=staff_changed,
            status_changed=status_changed,
        )
        await self.db.commit()
        return to_dto(await self._load(appt.id))

    # -- bookings made by customers (website, WhatsApp bot) ------------------------------

    async def request_from_website(
        self,
        business_id: uuid.UUID,
        lead_id: uuid.UUID,
        contact_id: uuid.UUID,
        service_id: uuid.UUID | None,
        starts_at: datetime,
    ) -> None:
        """A website visitor's request (F17): REQUESTED, no staff member yet, linked to the new
        lead. An unknown or inactive service is ignored rather than failing the visitor's form."""
        service = None
        if service_id:
            service = (
                await self.db.execute(
                    select(Service).where(
                        Service.id == service_id, Service.business_id == business_id, Service.active.is_(True)
                    )
                )
            ).scalar_one_or_none()
        now = now_ms()
        ends_at = starts_at + timedelta(minutes=service.duration_min if service else DEFAULT_DURATION)
        appt = Appointment(
            id=uuid.uuid4(),
            business_id=business_id,
            contact_id=contact_id,
            lead_id=lead_id,
            service_id=service.id if service else None,
            staff_id=None,
            starts_at=starts_at,
            ends_at=ends_at,
            status=AppointmentStatus.REQUESTED,
            source="website",
            created_at=now,
            updated_at=now,
        )
        self.db.add(appt)
        await self.db.flush()
        await self._awareness_task(
            business_id,
            contact_id,
            lead_id,
            None,
            service.name if service else None,
            starts_at,
            "request",
            appt,
        )
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=business_id,
                lead_id=lead_id,
                type="appointment.created",
                data={
                    "startsAt": iso(starts_at),
                    "service": service.name if service else None,
                    "staff": None,
                    "requested": True,
                },
                created_at=now,
            )
        )
        await self.db.commit()

    async def book_from_whatsapp(
        self,
        business_id: uuid.UUID,
        contact_id: uuid.UUID,
        lead_id: uuid.UUID,
        service_id: uuid.UUID | None,
        service_name: str | None,
        staff_id: uuid.UUID,
        starts_at: datetime,
        duration_min: int,
        confirmed: bool,
    ) -> uuid.UUID:
        """Booked by the customer through the WhatsApp bot (D-102): on a free staff member,
        CONFIRMED or (when the business approves bookings itself) REQUESTED, which holds the time
        either way. Raises CONFLICT when the time was taken in the meantime."""
        ends_at = starts_at + timedelta(minutes=duration_min)
        await self._assert_free(self.db, business_id, staff_id, starts_at, ends_at)
        now = now_ms()
        appt = Appointment(
            id=uuid.uuid4(),
            business_id=business_id,
            contact_id=contact_id,
            lead_id=lead_id,
            service_id=service_id,
            staff_id=staff_id,
            starts_at=starts_at,
            ends_at=ends_at,
            status=AppointmentStatus.CONFIRMED if confirmed else AppointmentStatus.REQUESTED,
            source="whatsapp",
            created_at=now,
            updated_at=now,
        )
        self.db.add(appt)
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=business_id,
                lead_id=lead_id,
                type="appointment.created",
                data={
                    "startsAt": iso(starts_at),
                    "service": service_name,
                    "staff": None,
                    "source": "whatsapp",
                    **({} if confirmed else {"requested": True}),
                },
                created_at=now,
            )
        )
        await self.db.flush()
        await self._awareness_task(
            business_id,
            contact_id,
            lead_id,
            staff_id,
            service_name,
            starts_at,
            "booked" if confirmed else "request",
            appt,
        )
        await self.db.commit()
        return appt.id

    async def call_back_from_whatsapp(
        self,
        business_id: uuid.UUID,
        contact_id: uuid.UUID,
        lead_id: uuid.UUID,
        staff_id: uuid.UUID,
        starts_at: datetime,
        notes: str,
    ) -> uuid.UUID:
        """A call-back the customer chose in WhatsApp (D-171): 15 minutes in the owner's calendar,
        confirmed, so that hour isn't offered again. The bot adds its own task."""
        ends_at = starts_at + timedelta(minutes=CALL_BACK_MINUTES)
        await self._assert_free(self.db, business_id, staff_id, starts_at, ends_at)
        now = now_ms()
        appt = Appointment(
            id=uuid.uuid4(),
            business_id=business_id,
            contact_id=contact_id,
            lead_id=lead_id,
            staff_id=staff_id,
            starts_at=starts_at,
            ends_at=ends_at,
            status=AppointmentStatus.CONFIRMED,
            notes=notes,
            source="whatsapp",
            created_at=now,
            updated_at=now,
        )
        self.db.add(appt)
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=business_id,
                lead_id=lead_id,
                type="appointment.created",
                data={"startsAt": iso(starts_at), "service": notes, "staff": None, "source": "whatsapp"},
                created_at=now,
            )
        )
        await self.db.commit()
        return appt.id

    async def request_event_from_whatsapp(
        self,
        business_id: uuid.UUID,
        contact_id: uuid.UUID,
        lead_id: uuid.UUID,
        service_id: uuid.UUID | None,
        starts_at: datetime,
        ends_at: datetime,
        notes: str,
        event_type: str,
    ) -> uuid.UUID:
        """An event request from the WhatsApp bot (D-107): REQUESTED with no staff member yet (like
        a website request), holding the date until the team confirms it, usually with a quote."""
        now = now_ms()
        appt = Appointment(
            id=uuid.uuid4(),
            business_id=business_id,
            contact_id=contact_id,
            lead_id=lead_id,
            service_id=service_id,
            staff_id=None,
            starts_at=starts_at,
            ends_at=ends_at,
            status=AppointmentStatus.REQUESTED,
            source="whatsapp",
            notes=notes[:1000],
            created_at=now,
            updated_at=now,
        )
        self.db.add(appt)
        self.db.add(
            Activity(
                id=uuid.uuid4(),
                business_id=business_id,
                lead_id=lead_id,
                type="appointment.created",
                data={
                    "startsAt": iso(starts_at),
                    "service": event_type,
                    "staff": None,
                    "source": "whatsapp",
                    "requested": True,
                },
                created_at=now,
            )
        )
        await self.db.flush()
        await self._awareness_task(
            business_id, contact_id, lead_id, None, event_type, starts_at, "event", appt
        )
        await self.db.commit()
        return appt.id

    async def cancel_from_whatsapp(
        self, business_id: uuid.UUID, appointment_id: uuid.UUID, contact_id: uuid.UUID
    ) -> dict[str, uuid.UUID | None] | None:
        """D-153: the customer cancels an upcoming appointment from WhatsApp. Cancelled (the time
        is free again), noted on the lead, and a task so the team notices."""
        appt = (
            await self.db.execute(
                select(Appointment)
                .options(joinedload(Appointment.service))
                .where(
                    Appointment.id == appointment_id,
                    Appointment.business_id == business_id,
                    Appointment.contact_id == contact_id,
                    Appointment.status.in_(_BLOCKING),
                )
            )
        ).scalar_one_or_none()
        if appt is None:
            return None
        appt.status = AppointmentStatus.CANCELLED
        appt.updated_at = now_ms()
        if appt.lead_id:
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    lead_id=appt.lead_id,
                    type="appointment.updated",
                    data={
                        "startsAt": iso(appt.starts_at),
                        "status": "CANCELLED",
                        "statusChanged": True,
                        "source": "whatsapp",
                    },
                    created_at=now_ms(),
                )
            )
            await self._awareness_task(
                business_id,
                contact_id,
                appt.lead_id,
                appt.staff_id,
                appt.service.name if appt.service else None,
                appt.starts_at,
                "cancelled",
                appt,
            )
        # F35: the customer cancelled, so the open confirm task closes (same transaction).
        await task_auto.close_open(self.db, business_id, appointment_id=appt.id)
        await self.db.commit()
        return {"leadId": appt.lead_id, "staffId": appt.staff_id}

    async def _awareness_task(
        self,
        business_id: uuid.UUID,
        contact_id: uuid.UUID,
        lead_id: uuid.UUID,
        staff_id: uuid.UUID | None,
        what: str | None,
        starts_at: datetime,
        kind: str,
        appt: Appointment,
    ) -> None:
        """D-152: a customer's own booking (WhatsApp or the website) also becomes a task due now, so
        the team notices it: who, what and when, linked to the lead. It goes to the staff member
        who has it, or else the owner; no reminder email (the booking already notifies the team).

        F35 (D-216 (2)): the notice is always linked to its appointment. With the business's
        appointment-confirm switch on, a booking's notice **is** the confirm task (no second task):
        `auto_kind = appointment_confirm`, the confirm title with the same details, due now while
        REQUESTED, and by the confirm rule (with a reminder) when CONFIRMED and not same-day. The
        cancellation notice stays a plain notice."""
        business = (
            await self.db.execute(
                select(Business.language, Business.timezone, Business.task_auto_appointment_confirm).where(
                    Business.id == business_id
                )
            )
        ).one()
        contact_name = (
            await self.db.execute(select(Contact.name).where(Contact.id == contact_id))
        ).scalar_one_or_none()
        owner = (
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
        assignee = staff_id or owner
        if not assignee:
            return
        en = business.language == "en"
        when = format_when(starts_at, business.timezone, "en" if en else "he", with_time=kind != "event")
        label = {
            "booked": "New appointment" if en else "פגישה חדשה",
            "request": "New appointment request" if en else "בקשה חדשה לפגישה",
            "event": "New booking request" if en else "הזמנה חדשה",
            "cancelled": "Appointment cancelled" if en else "פגישה בוטלה",
        }[kind]
        title = " · ".join(x for x in (contact_name, what, when) if x)
        notes = None
        if kind not in ("booked", "cancelled"):
            notes = (
                "Waiting for your approval on the Appointments page."
                if en
                else "מחכה לאישור שלכם בעמוד הפגישות."
            )
        now = now_ms()
        full_title = f"{label}: {title}"
        due_at, remind, auto_kind = now, False, None
        if kind != "cancelled" and business.task_auto_appointment_confirm:
            auto_kind = APPOINTMENT_CONFIRM
            full_title = titles_for(business.language)[APPOINTMENT_CONFIRM](title)
            if appt.status == AppointmentStatus.CONFIRMED:
                confirm_due = appointment_confirm_due_at(starts_at, now, business.timezone)
                if confirm_due is not None:
                    due_at, remind = confirm_due, True
        self.db.add(
            Task(
                id=uuid.uuid4(),
                business_id=business_id,
                title=full_title[:200],
                notes=notes,
                due_at=due_at,
                assignee_id=assignee,
                lead_id=lead_id,
                appointment_id=appt.id,
                auto_kind=auto_kind,
                remind=remind,
                created_at=now,
                updated_at=now,
            )
        )
