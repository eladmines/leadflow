"""Follow-up tasks (F10): title, assignee, due time, status, optional lead link, email reminder.

Port of apps/api/src/modules/tasks/service.ts.
"""

import logging
import re
import uuid
from datetime import datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import Settings
from app.core.dates import format_full
from app.core.permissions import can
from app.core.timeutil import iso, now_ms
from app.db.models import (
    Activity,
    Appointment,
    Business,
    Lead,
    Membership,
    MembershipStatus,
    Quote,
    Task,
    TaskStatus,
    User,
    UserStatus,
)
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.email.templates import task_reminder_template
from app.modules.audit import add_audit
from app.modules.notifications.service import notify_safe
from app.modules.tasks import schemas as s
from app.shared.tasks import QUOTE_FOLLOWUP

log = logging.getLogger("simplecatch")

# Reminders older than this are skipped (e.g. after downtime) instead of arriving late.
REMINDER_WINDOW = timedelta(hours=24)
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)

_LOAD = (
    joinedload(Task.assignee),
    joinedload(Task.lead).joinedload(Lead.contact),
    joinedload(Task.quote),
    joinedload(Task.appointment),
)


def _invalid(field: str, key: str) -> AppError:
    msg = s.TASK_MESSAGES[key]
    return AppError("VALIDATION_ERROR", msg, {field: msg})


def subject_dto(t: Task) -> s.QuoteSubject | s.AppointmentSubject | None:
    """The linked quote or appointment (the relationships join on the task's own business)."""
    if t.quote_id and t.quote is not None:
        return s.QuoteSubject(
            kind="quote", id=str(t.quote.id), number=t.quote.number, status=t.quote.status.value
        )
    if t.appointment_id and t.appointment is not None:
        return s.AppointmentSubject(
            kind="appointment",
            id=str(t.appointment.id),
            startsAt=iso(t.appointment.starts_at),
            status=t.appointment.status.value,
        )
    return None


def to_dto(t: Task) -> s.Task:
    return s.Task(
        id=str(t.id),
        title=t.title,
        notes=t.notes,
        dueAt=iso(t.due_at),
        status=t.status.value,
        remind=t.remind,
        completedAt=iso(t.completed_at) if t.completed_at else None,
        assignee=s.Person(id=str(t.assignee.id), name=t.assignee.full_name),
        lead=s.Person(id=str(t.lead.id), name=t.lead.contact.name) if t.lead else None,
        subject=subject_dto(t),
        autoKind=t.auto_kind,  # type: ignore[arg-type]
        createdAt=iso(t.created_at),
    )


class TaskService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _visible(self, ctx: TenantContext):
        """Owner/manager: all tasks; employee: tasks assigned to them."""
        conds = [Task.business_id == ctx.business_id]
        if not can(ctx.role, "tasks.view.all"):
            conds.append(Task.assignee_id == ctx.user_id)
        return conds

    async def _find_visible(self, ctx: TenantContext, task_id: str) -> Task:
        task = None
        if _UUID.match(task_id):
            task = (
                await self.db.execute(
                    select(Task)
                    .options(*_LOAD)
                    .where(Task.id == uuid.UUID(task_id), *self._visible(ctx))
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
        if task is None:
            raise AppError("NOT_FOUND")
        return task

    async def _require_assignee(self, ctx: TenantContext, user_id: uuid.UUID) -> None:
        if user_id != ctx.user_id and not can(ctx.role, "tasks.view.all"):
            raise AppError("FORBIDDEN")
        member = (
            await self.db.execute(
                select(Membership.id).where(
                    Membership.business_id == ctx.business_id,
                    Membership.user_id == user_id,
                    Membership.status == MembershipStatus.ACTIVE,
                )
            )
        ).first()
        if member is None:
            msg = s.TASK_MESSAGES["assigneeInvalid"]
            raise AppError("VALIDATION_ERROR", msg, {"assigneeId": msg})

    async def _require_lead(self, ctx: TenantContext, lead_id: uuid.UUID) -> None:
        """A task may only link to a lead the member can see (employees: their own leads)."""
        conds = [Lead.id == lead_id, Lead.business_id == ctx.business_id]
        if not can(ctx.role, "leads.view.all"):
            conds.append(Lead.owner_id == ctx.user_id)
        if (await self.db.execute(select(Lead.id).where(*conds))).first() is None:
            msg = s.TASK_MESSAGES["leadInvalid"]
            raise AppError("VALIDATION_ERROR", msg, {"leadId": msg})

    async def _quote_lead(self, ctx: TenantContext, quote_id: uuid.UUID) -> uuid.UUID:
        """The lead of a quote the member may see (quotes follow lead visibility), or 400 on
        `quoteId` (same answer for "doesn't exist", "another business" and "not yours")."""
        conds = [Quote.id == quote_id, Quote.business_id == ctx.business_id]
        if not can(ctx.role, "leads.view.all"):
            conds.append(Quote.lead.has(Lead.owner_id == ctx.user_id))
        lead_id = (await self.db.execute(select(Quote.lead_id).where(*conds))).first()
        if lead_id is None:
            raise _invalid("quoteId", "quoteInvalid")
        return lead_id[0]

    async def _appointment_lead(self, ctx: TenantContext, appointment_id: uuid.UUID) -> uuid.UUID | None:
        """The lead (may be none) of an appointment the member may see (employees: their own)."""
        conds = [Appointment.id == appointment_id, Appointment.business_id == ctx.business_id]
        if not can(ctx.role, "appointments.view.all"):
            conds.append(Appointment.staff_id == ctx.user_id)
        row = (await self.db.execute(select(Appointment.lead_id).where(*conds))).first()
        if row is None:
            raise _invalid("appointmentId", "appointmentInvalid")
        return row[0]

    async def _stored_subject_lead(self, task: Task) -> uuid.UUID | None:
        """The lead of the subject a task already has (no visibility check: it is already linked)."""
        if task.quote_id:
            return (
                await self.db.execute(
                    select(Quote.lead_id).where(
                        Quote.business_id == task.business_id, Quote.id == task.quote_id
                    )
                )
            ).scalar_one_or_none()
        if task.appointment_id:
            return (
                await self.db.execute(
                    select(Appointment.lead_id).where(
                        Appointment.business_id == task.business_id, Appointment.id == task.appointment_id
                    )
                )
            ).scalar_one_or_none()
        return None

    async def _other_open_auto(self, task: Task) -> bool:
        """Is there another open automatic task for this task's subject (or, for a quote follow-up,
        on its lead: one open follow-up per lead)?"""
        same: list = []
        if task.quote_id:
            same.append(Task.quote_id == task.quote_id)
        if task.appointment_id:
            same.append(Task.appointment_id == task.appointment_id)
        if task.auto_kind == QUOTE_FOLLOWUP and task.lead_id:
            same.append((Task.lead_id == task.lead_id) & (Task.auto_kind == QUOTE_FOLLOWUP))
        if not same:
            return False
        row = (
            await self.db.execute(
                select(Task.id)
                .where(
                    Task.business_id == task.business_id,
                    Task.id != task.id,
                    Task.auto_kind.is_not(None),
                    Task.status == TaskStatus.OPEN,
                    or_(*same),
                )
                .limit(1)
            )
        ).first()
        return row is not None

    async def list_tasks(self, ctx: TenantContext, q: s.TaskListQuery) -> list[s.Task]:
        conds = self._visible(ctx)
        if q.status:
            conds.append(Task.status == TaskStatus(q.status))
        if q.assigneeId:
            if q.assigneeId == "me":
                conds.append(Task.assignee_id == ctx.user_id)
            else:
                try:
                    conds.append(Task.assignee_id == uuid.UUID(q.assigneeId))
                except ValueError as err:
                    raise AppError("VALIDATION_ERROR", None, {"assigneeId": "Invalid uuid"}) from err
        if q.leadId:
            conds.append(Task.lead_id == q.leadId)
        if q.quoteId:
            conds.append(Task.quote_id == q.quoteId)
        if q.appointmentId:
            conds.append(Task.appointment_id == q.appointmentId)
        if q.due == "overdue":
            conds.extend([Task.status == TaskStatus.OPEN, Task.due_at < now_ms()])
        rows = await self.db.execute(
            select(Task)
            .options(*_LOAD)
            .where(*conds)
            .order_by(Task.status.asc(), Task.due_at.asc())
            .limit(500)
        )
        return [to_dto(t) for t in rows.scalars().unique()]

    async def create(self, ctx: TenantContext, data: s.CreateTaskRequest) -> s.Task:
        if data.quoteId and data.appointmentId:
            raise _invalid("appointmentId", "subjectBoth")
        assignee_id = data.assigneeId or ctx.user_id
        await self._require_assignee(ctx, assignee_id)
        lead_id = data.leadId
        if data.quoteId or data.appointmentId:
            # With a subject, the task's lead is the subject's lead (D-214 (3)).
            subject_lead = (
                await self._quote_lead(ctx, data.quoteId)
                if data.quoteId
                else await self._appointment_lead(ctx, data.appointmentId)  # type: ignore[arg-type]
            )
            if lead_id is not None and lead_id != subject_lead:
                raise _invalid("leadId", "subjectOtherLead")
            lead_id = subject_lead
        elif lead_id:
            await self._require_lead(ctx, lead_id)
        now = now_ms()
        task = Task(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            title=data.title,
            notes=data.notes,
            due_at=data.dueAt,
            assignee_id=assignee_id,
            lead_id=lead_id,
            quote_id=data.quoteId,
            appointment_id=data.appointmentId,
            remind=data.remind,
            created_by_id=ctx.user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(task)
        await self.db.flush()
        if task.lead_id:
            assignee_name = (
                await self.db.execute(select(User.full_name).where(User.id == assignee_id))
            ).scalar_one()
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    lead_id=task.lead_id,
                    actor_id=ctx.user_id,
                    type="task.created",
                    data={"title": task.title, "dueAt": iso(task.due_at), "assignee": assignee_name},
                    created_at=now,
                )
            )
        await self.db.commit()
        return to_dto(await self._reload(task.id))

    async def _reload(self, task_id: uuid.UUID) -> Task:
        return (
            await self.db.execute(
                select(Task)
                .options(*_LOAD)
                .where(Task.id == task_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def update(self, ctx: TenantContext, task_id: str, data: s.UpdateTaskRequest) -> s.Task:
        task = await self._find_visible(ctx, task_id)
        given = data.model_fields_set
        previous_status = task.status
        if "title" in given and data.title is not None:
            task.title = data.title
        if "notes" in given:
            task.notes = data.notes
        if "remind" in given and data.remind is not None:
            task.remind = data.remind
        if "dueAt" in given and data.dueAt is not None and data.dueAt != task.due_at:
            task.due_at = data.dueAt
            task.reminder_sent_at = None  # a new due time gets a new reminder
        if "assigneeId" in given and data.assigneeId is not None and data.assigneeId != task.assignee_id:
            await self._require_assignee(ctx, data.assigneeId)
            task.assignee_id = data.assigneeId
        await self._apply_subject(ctx, task, data)
        new_status = TaskStatus(data.status) if data.status else None
        completing = new_status == TaskStatus.DONE and previous_status != TaskStatus.DONE
        if new_status is not None and new_status != previous_status:
            task.status = new_status
            task.completed_at = now_ms() if new_status == TaskStatus.DONE else None
            # Reopening an automatic task while its subject (or lead, for a quote follow-up)
            # already has another open one makes it a person's task (D-214, no 409).
            if new_status == TaskStatus.OPEN and task.auto_kind and await self._other_open_auto(task):
                task.auto_kind = None
        task.updated_at = now_ms()
        if completing and task.lead_id:
            self.db.add(
                Activity(
                    id=uuid.uuid4(),
                    business_id=ctx.business_id,
                    lead_id=task.lead_id,
                    actor_id=ctx.user_id,
                    type="task.completed",
                    data={"title": task.title},
                    created_at=now_ms(),
                )
            )
        await self.db.commit()
        return to_dto(await self._reload(task.id))

    async def _apply_subject(self, ctx: TenantContext, task: Task, data: s.UpdateTaskRequest) -> None:
        """F35 linking rules on PATCH: one subject at most (setting one replaces the other), the
        task's lead is the subject's lead, and a changed subject makes an automatic task a
        person's task."""
        given = data.model_fields_set
        if data.quoteId and data.appointmentId:
            raise _invalid("appointmentId", "subjectBoth")
        quote_id, appointment_id = task.quote_id, task.appointment_id
        subject_lead: uuid.UUID | None = None
        new_subject = False
        if "quoteId" in given and data.quoteId is None:
            quote_id = None
        if "appointmentId" in given and data.appointmentId is None:
            appointment_id = None
        if "quoteId" in given and data.quoteId is not None and data.quoteId != task.quote_id:
            subject_lead = await self._quote_lead(ctx, data.quoteId)
            quote_id, appointment_id, new_subject = data.quoteId, None, True
        elif "quoteId" in given and data.quoteId is not None:
            appointment_id = None
        if (
            "appointmentId" in given
            and data.appointmentId is not None
            and data.appointmentId != task.appointment_id
        ):
            subject_lead = await self._appointment_lead(ctx, data.appointmentId)
            quote_id, appointment_id, new_subject = None, data.appointmentId, True
        elif "appointmentId" in given and data.appointmentId is not None:
            quote_id = None
        subject_changed = (quote_id, appointment_id) != (task.quote_id, task.appointment_id)

        lead_given = "leadId" in given
        if quote_id or appointment_id:
            if not new_subject:
                subject_lead = await self._stored_subject_lead(task)
            if lead_given and data.leadId is not None and data.leadId != subject_lead:
                raise _invalid("leadId", "subjectOtherLead")
            if new_subject or lead_given:
                task.lead_id = subject_lead
        elif lead_given and data.leadId != task.lead_id:
            if data.leadId:
                await self._require_lead(ctx, data.leadId)
            task.lead_id = data.leadId

        if subject_changed:
            task.quote_id, task.appointment_id = quote_id, appointment_id
            task.auto_kind = None

    async def get_automations(self, ctx: TenantContext) -> s.TaskAutomations:
        row = (
            await self.db.execute(
                select(Business.task_auto_quote_followup, Business.task_auto_appointment_confirm).where(
                    Business.id == ctx.business_id
                )
            )
        ).one()
        return s.TaskAutomations(quoteFollowUp=row[0], appointmentConfirm=row[1])

    async def set_automations(self, ctx: TenantContext, data: s.TaskAutomations) -> s.TaskAutomations:
        """Owner/manager (`automations.manage`, checked by the route); audited when it changes."""
        before = await self.get_automations(ctx)
        if before != data:
            await self.db.execute(
                update(Business)
                .where(Business.id == ctx.business_id)
                .values(
                    task_auto_quote_followup=data.quoteFollowUp,
                    task_auto_appointment_confirm=data.appointmentConfirm,
                    updated_at=now_ms(),
                )
            )
            add_audit(
                self.db,
                "automations.tasks_updated",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="business",
                entity_id=ctx.business_id,
                metadata={"quoteFollowUp": data.quoteFollowUp, "appointmentConfirm": data.appointmentConfirm},
            )
            await self.db.commit()
        return data

    async def remove(self, ctx: TenantContext, task_id: str) -> None:
        task = await self._find_visible(ctx, task_id)
        await self.db.delete(task)
        await self.db.commit()

    async def send_due_reminders(
        self, email: EmailSender, settings: Settings, now: datetime | None = None
    ) -> int:
        """Emails assignees of open tasks that are due. Each reminder is claimed with a
        conditional update first, so it's sent once even if several workers run. Returns how many
        were sent."""
        now = now or now_ms()
        due = (
            (
                await self.db.execute(
                    select(Task)
                    .options(*_LOAD, joinedload(Task.business))
                    .where(
                        Task.status == TaskStatus.OPEN,
                        Task.remind.is_(True),
                        Task.reminder_sent_at.is_(None),
                        Task.due_at <= now,
                        Task.due_at > now - REMINDER_WINDOW,
                    )
                    .limit(100)
                )
            )
            .scalars()
            .unique()
            .all()
        )
        sent = 0
        for t in due:
            claimed = await self.db.execute(
                update(Task)
                .where(Task.id == t.id, Task.reminder_sent_at.is_(None), Task.status == TaskStatus.OPEN)
                .values(reminder_sent_at=now)
            )
            await self.db.commit()
            if claimed.rowcount == 0 or t.assignee.status != UserStatus.ACTIVE:
                continue
            member = (
                await self.db.execute(
                    select(Membership.id).where(
                        Membership.business_id == t.business_id,
                        Membership.user_id == t.assignee_id,
                        Membership.status == MembershipStatus.ACTIVE,
                    )
                )
            ).first()
            if member is None:
                continue
            # In-app (D-097): the bell for the assignee, next to the email.
            await notify_safe(
                self.db,
                business_id=t.business_id,
                type="task.due",
                data={"taskId": str(t.id), "title": t.title, "leadId": str(t.lead_id) if t.lead_id else None},
                user_ids=[t.assignee_id],
            )
            lang = "en" if t.business.language == "en" else "he"
            link = (
                f"{settings.APP_URL}/b/{t.business_id}/leads/{t.lead_id}"
                if t.lead_id
                else f"{settings.APP_URL}/b/{t.business_id}/tasks"
            )
            mail = task_reminder_template(
                name=t.assignee.full_name,
                title=t.title,
                due_text=format_full(t.due_at, t.business.timezone, lang),
                lead_name=t.lead.contact.name if t.lead else None,
                link=link,
                lang=lang,
            )
            try:
                await email.send(
                    EmailMessage(to=t.assignee.email, subject=mail.subject, html=mail.html, text=mail.text)
                )
                sent += 1
            except Exception as err:
                log.error(
                    "task reminder email failed",
                    extra={"errName": type(err).__name__, "template": "taskReminder"},
                )
        return sent
