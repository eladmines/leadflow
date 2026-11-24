"""Follow-up tasks (F10): title, assignee, due time, status, optional lead link, email reminder.

Port of apps/api/src/modules/tasks/service.ts.
"""

import logging
import re
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import Settings
from app.core.dates import format_full
from app.core.permissions import can
from app.core.timeutil import iso, now_ms
from app.db.models import (
    Activity,
    Lead,
    Membership,
    MembershipStatus,
    Task,
    TaskStatus,
    User,
    UserStatus,
)
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.email.templates import task_reminder_template
from app.modules.notifications.service import notify_safe
from app.modules.tasks import schemas as s

log = logging.getLogger("simplecatch")

# Reminders older than this are skipped (e.g. after downtime) instead of arriving late.
REMINDER_WINDOW = timedelta(hours=24)
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)

_LOAD = (joinedload(Task.assignee), joinedload(Task.lead).joinedload(Lead.contact))


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
        assignee_id = data.assigneeId or ctx.user_id
        await self._require_assignee(ctx, assignee_id)
        if data.leadId:
            await self._require_lead(ctx, data.leadId)
        now = now_ms()
        task = Task(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            title=data.title,
            notes=data.notes,
            due_at=data.dueAt,
            assignee_id=assignee_id,
            lead_id=data.leadId,
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
        if "leadId" in given and data.leadId != task.lead_id:
            if data.leadId:
                await self._require_lead(ctx, data.leadId)
            task.lead_id = data.leadId
        new_status = TaskStatus(data.status) if data.status else None
        completing = new_status == TaskStatus.DONE and previous_status != TaskStatus.DONE
        if new_status is not None and new_status != previous_status:
            task.status = new_status
            task.completed_at = now_ms() if new_status == TaskStatus.DONE else None
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
