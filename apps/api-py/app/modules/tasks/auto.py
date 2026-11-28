"""Automatic follow-up tasks (F35: D-213, D-214, D-216).

- Quote follow-up (`quote_followup`): created when a quote is sent, one open per lead (a re-send
  moves it, a revision re-points it), closed when its quote is accepted or rejected, handed to the
  new owner when the lead is reassigned.
- Appointment confirm (`appointment_confirm`): created when the team books an appointment (customer
  bookings use their D-152 notice instead, see `AppointmentService._awareness_task`), moved by a
  reschedule or staff change, closed when the appointment is cancelled, completed or a no-show.

Every function only adds to the caller's session: it runs in the transaction of the change that
triggers it and the caller commits. Only rows with `auto_kind IS NOT NULL` are ever changed here,
so a person's task is never touched. Every query is keyed by the business id.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import iso, now_ms
from app.db.models import (
    Activity,
    Appointment,
    AppointmentStatus,
    Business,
    Lead,
    Membership,
    MembershipRole,
    MembershipStatus,
    Quote,
    Task,
    TaskStatus,
    User,
)
from app.shared.tasks import (
    APPOINTMENT_CONFIRM,
    AUTO_TASK_TITLES,
    QUOTE_FOLLOWUP,
    appointment_confirm_due_at,
    quote_follow_up_due_at,
    titles_for,
)

# Statuses that end an appointment's open confirm task (D-214 (5), D-216 (4)).
CLOSING_STATUSES = (AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW)


async def business_settings(db: AsyncSession, business_id: uuid.UUID) -> Any:
    """The business's switches, language and time zone (read at the moment of the event)."""
    return (
        await db.execute(
            select(
                Business.task_auto_quote_followup,
                Business.task_auto_appointment_confirm,
                Business.language,
                Business.timezone,
            ).where(Business.id == business_id)
        )
    ).one()


async def active_member(db: AsyncSession, business_id: uuid.UUID, user_id: uuid.UUID | None) -> bool:
    if user_id is None:
        return False
    row = (
        await db.execute(
            select(Membership.id).where(
                Membership.business_id == business_id,
                Membership.user_id == user_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
    ).first()
    return row is not None


async def first_owner(db: AsyncSession, business_id: uuid.UUID) -> uuid.UUID | None:
    return (
        await db.execute(
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


async def _lock_lead(db: AsyncSession, lead_id: uuid.UUID) -> None:
    """Serialises the follow-up bookkeeping of one lead (concurrent sends, retries)."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"taskauto:{lead_id}"})


async def _created_activity(
    db: AsyncSession,
    business_id: uuid.UUID,
    lead_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    kind: str,
    title: str,
    due_at: datetime,
    assignee_id: uuid.UUID,
) -> None:
    if lead_id is None:
        return
    name = (await db.execute(select(User.full_name).where(User.id == assignee_id))).scalar_one_or_none()
    db.add(
        Activity(
            id=uuid.uuid4(),
            business_id=business_id,
            lead_id=lead_id,
            actor_id=actor_id,
            type="task.created",
            data={"title": title, "dueAt": iso(due_at), "assignee": name or "", "auto": kind},
            created_at=now_ms(),
        )
    )


async def _insert_auto(db: AsyncSession, values: dict[str, Any]) -> bool:
    """Inserts an automatic task unless the subject already has an open one (partial unique
    index). Returns whether a row was written."""
    now = now_ms()
    res = await db.execute(
        insert(Task)
        .values(id=uuid.uuid4(), status=TaskStatus.OPEN, created_at=now, updated_at=now, **values)
        .on_conflict_do_nothing()
        .returning(Task.id)
    )
    return res.first() is not None


async def close_open(
    db: AsyncSession,
    business_id: uuid.UUID,
    *,
    quote_id: uuid.UUID | None = None,
    appointment_id: uuid.UUID | None = None,
) -> int:
    """Closes the subject's open automatic task(s): DONE, a `task.completed` entry with no actor."""
    conds: list[Any] = [
        Task.business_id == business_id,
        Task.auto_kind.is_not(None),
        Task.status == TaskStatus.OPEN,
    ]
    if quote_id is not None:
        conds.append(Task.quote_id == quote_id)
    elif appointment_id is not None:
        conds.append(Task.appointment_id == appointment_id)
    else:
        return 0
    now = now_ms()
    rows = (
        await db.execute(
            update(Task)
            .where(*conds)
            .values(status=TaskStatus.DONE, completed_at=now, updated_at=now)
            .returning(Task.lead_id, Task.title)
            .execution_options(synchronize_session=False)
        )
    ).all()
    for lead_id, title in rows:
        if lead_id is not None:
            db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=business_id,
                    lead_id=lead_id,
                    actor_id=None,
                    type="task.completed",
                    data={"title": title, "auto": True},
                    created_at=now,
                )
            )
    return len(rows)


# -- quotes -------------------------------------------------------------------------------------


def _system_titles(number: int) -> set[str]:
    return {t[QUOTE_FOLLOWUP](number) for t in AUTO_TASK_TITLES.values()}


async def on_quote_sent(db: AsyncSession, quote: Quote, sender_id: uuid.UUID) -> None:
    """A quote was sent (or re-sent): create, move or re-point the lead's open follow-up."""
    business_id, lead_id = quote.business_id, quote.lead_id
    cfg = await business_settings(db, business_id)
    if not cfg.task_auto_quote_followup:
        return  # off: no new or re-pointed follow-ups (closing still happens)
    await _lock_lead(db, lead_id)
    assert quote.sent_at is not None
    due = quote_follow_up_due_at(quote.sent_at, cfg.timezone)
    now = now_ms()
    current = (
        (
            await db.execute(
                select(Task)
                .where(
                    Task.business_id == business_id,
                    Task.lead_id == lead_id,
                    Task.auto_kind == QUOTE_FOLLOWUP,
                    Task.status == TaskStatus.OPEN,
                )
                .order_by(Task.created_at.desc())
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    # One open follow-up per lead: prefer the one already on this quote.
    task = next((t for t in current if t.quote_id == quote.id), current[0] if current else None)
    if task is not None:
        if task.quote_id != quote.id:
            old_number = (
                await db.execute(
                    select(Quote.number).where(Quote.business_id == business_id, Quote.id == task.quote_id)
                )
            ).scalar_one_or_none()
            if old_number is not None and task.title in _system_titles(old_number):
                task.title = titles_for(cfg.language)[QUOTE_FOLLOWUP](quote.number)
            task.quote_id = quote.id
        task.due_at = due
        task.reminder_sent_at = None
        task.updated_at = now
        await db.flush()
        return

    owner_id = (
        await db.execute(select(Lead.owner_id).where(Lead.business_id == business_id, Lead.id == lead_id))
    ).scalar_one_or_none()
    assignee = owner_id if await active_member(db, business_id, owner_id) else sender_id
    title = titles_for(cfg.language)[QUOTE_FOLLOWUP](quote.number)
    created = await _insert_auto(
        db,
        {
            "business_id": business_id,
            "title": title,
            "due_at": due,
            "assignee_id": assignee,
            "lead_id": lead_id,
            "quote_id": quote.id,
            "auto_kind": QUOTE_FOLLOWUP,
            "remind": True,
            "created_by_id": None,
        },
    )
    if created:
        await _created_activity(db, business_id, lead_id, sender_id, QUOTE_FOLLOWUP, title, due, assignee)


async def on_quote_decided(db: AsyncSession, business_id: uuid.UUID, quote_id: uuid.UUID) -> None:
    """Accepted or rejected (by the team or the customer): its open follow-up closes."""
    await close_open(db, business_id, quote_id=quote_id)


async def on_lead_owner_changed(
    db: AsyncSession, business_id: uuid.UUID, lead_id: uuid.UUID, owner_id: uuid.UUID | None
) -> None:
    """D-216 (3): the lead's open automatic quote follow-up goes to the new owner (an active
    member). No owner → unchanged. Runs whatever the switch; due and reminder stay."""
    if owner_id is None or not await active_member(db, business_id, owner_id):
        return
    await db.execute(
        update(Task)
        .where(
            Task.business_id == business_id,
            Task.lead_id == lead_id,
            Task.auto_kind == QUOTE_FOLLOWUP,
            Task.status == TaskStatus.OPEN,
        )
        .values(assignee_id=owner_id, updated_at=now_ms())
        .execution_options(synchronize_session=False)
    )


# -- appointments --------------------------------------------------------------------------------


async def confirm_assignee(db: AsyncSession, appt: Appointment) -> uuid.UUID | None:
    """Staff if an active member → the lead's owner if active → the first active owner."""
    if await active_member(db, appt.business_id, appt.staff_id):
        return appt.staff_id
    if appt.lead_id is not None:
        owner_id = (
            await db.execute(
                select(Lead.owner_id).where(Lead.business_id == appt.business_id, Lead.id == appt.lead_id)
            )
        ).scalar_one_or_none()
        if await active_member(db, appt.business_id, owner_id):
            return owner_id
    return await first_owner(db, appt.business_id)


async def on_appointment_booked(db: AsyncSession, appt: Appointment, actor_id: uuid.UUID | None) -> None:
    """The team booked an appointment (REQUESTED or CONFIRMED): its confirm task, unless the
    appointment is today or earlier or the switch is off."""
    if appt.status not in (AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED):
        return
    cfg = await business_settings(db, appt.business_id)
    if not cfg.task_auto_appointment_confirm:
        return
    due = appointment_confirm_due_at(appt.starts_at, now_ms(), cfg.timezone)
    if due is None:
        return
    assignee = await confirm_assignee(db, appt)
    if assignee is None:
        return
    title = titles_for(cfg.language)[APPOINTMENT_CONFIRM]()
    created = await _insert_auto(
        db,
        {
            "business_id": appt.business_id,
            "title": title,
            "due_at": due,
            "assignee_id": assignee,
            "lead_id": appt.lead_id,
            "appointment_id": appt.id,
            "auto_kind": APPOINTMENT_CONFIRM,
            "remind": True,
            "created_by_id": None,
        },
    )
    if created:
        await _created_activity(
            db, appt.business_id, appt.lead_id, actor_id, APPOINTMENT_CONFIRM, title, due, assignee
        )


async def on_appointment_changed(
    db: AsyncSession,
    appt: Appointment,
    *,
    time_changed: bool,
    staff_changed: bool,
    status_changed: bool,
) -> None:
    """Reschedule moves the open confirm task, a staff change hands it over, and a cancelled /
    completed / no-show appointment closes it. Never creates one."""
    if status_changed and appt.status in CLOSING_STATUSES:
        await close_open(db, appt.business_id, appointment_id=appt.id)
        return
    values: dict[str, Any] = {}
    if time_changed:
        tz = (await db.execute(select(Business.timezone).where(Business.id == appt.business_id))).scalar_one()
        now = now_ms()
        values["due_at"] = appointment_confirm_due_at(appt.starts_at, now, tz) or now
        values["reminder_sent_at"] = None
    if staff_changed and await active_member(db, appt.business_id, appt.staff_id):
        values["assignee_id"] = appt.staff_id
    if not values:
        return
    await db.execute(
        update(Task)
        .where(
            Task.business_id == appt.business_id,
            Task.appointment_id == appt.id,
            Task.auto_kind.is_not(None),
            Task.status == TaskStatus.OPEN,
        )
        .values(updated_at=now_ms(), **values)
        .execution_options(synchronize_session=False)
    )


# -- leads ---------------------------------------------------------------------------------------


async def delete_for_lead(db: AsyncSession, business_id: uuid.UUID, lead_id: uuid.UUID) -> None:
    """A deleted lead takes its automatic tasks with it; a person's tasks stay (unlinked)."""
    await db.execute(
        delete(Task)
        .where(Task.business_id == business_id, Task.lead_id == lead_id, Task.auto_kind.is_not(None))
        .execution_options(synchronize_session=False)
    )
