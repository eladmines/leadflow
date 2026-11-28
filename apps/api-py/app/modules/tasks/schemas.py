"""F10 follow-up tasks contract (packages/shared/src/tasks.ts)."""

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictBool

from app.modules.auth.schemas import _Request

TASK_STATUSES = ("OPEN", "DONE")
TaskStatus = Literal["OPEN", "DONE"]

TASK_MESSAGES = {
    "titleRequired": "יש לכתוב מה צריך לעשות",
    "titleTooLong": "הכותרת ארוכה מדי (עד 200 תווים)",
    "notesTooLong": "ההערות ארוכות מדי (עד 1,000 תווים)",
    "dueRequired": "יש לבחור מועד",
    "assigneeInvalid": "אפשר להקצות רק לחבר צוות פעיל בעסק",
    "leadInvalid": "הליד שנבחר אינו קיים",
    # F35 (D-213).
    "quoteInvalid": "ההצעה שנבחרה אינה קיימת",
    "appointmentInvalid": "התור שנבחר אינו קיים",
    "subjectBoth": "אפשר לקשר משימה להצעה או לתור, לא לשניהם",
    "subjectOtherLead": "ההצעה או התור שייכים לליד אחר. בטלו את הקישור או בחרו את הליד שלהם.",
}
M = TASK_MESSAGES

# Zod's .datetime(): an ISO-8601 UTC timestamp ending in Z.
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def _title(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError(M["titleRequired"])
    s = v.strip()
    if not s:
        raise ValueError(M["titleRequired"])
    if len(s) > 200:
        raise ValueError(M["titleTooLong"])
    return s


def _notes(v: Any) -> str | None:
    """Trimmed; blank becomes null."""
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError(M["notesTooLong"])
    s = v.strip()
    if len(s) > 1000:
        raise ValueError(M["notesTooLong"])
    return s or None


def _due(v: Any) -> datetime:
    if not isinstance(v, str) or not _DATETIME.match(v):
        raise ValueError(M["dueRequired"])
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError as err:
        raise ValueError(M["dueRequired"]) from err


Title = Annotated[str, BeforeValidator(_title)]
Notes = Annotated[str | None, BeforeValidator(_notes)]
DueAt = Annotated[datetime, BeforeValidator(_due)]


class CreateTaskRequest(_Request):
    title: Title = ""
    notes: Notes = None
    dueAt: DueAt = None  # type: ignore[assignment]  # validated default: missing → dueRequired
    # Defaults to the creator. Employees can only assign to themselves.
    assigneeId: uuid.UUID | None = None
    leadId: uuid.UUID | None = None
    # F35: at most one subject (checked in the service: `subjectBoth` on `appointmentId`).
    quoteId: uuid.UUID | None = None
    appointmentId: uuid.UUID | None = None
    remind: bool = True


class UpdateTaskRequest(BaseModel):
    """Every field optional; use `model_fields_set` to tell "absent" from "null"."""

    model_config = ConfigDict(validate_default=False)

    title: Title | None = None
    notes: Notes = None
    dueAt: DueAt | None = None
    assigneeId: uuid.UUID | None = None
    leadId: uuid.UUID | None = None  # a lead, or null to unlink
    # F35: set (uuid) or remove (null) the subject; setting one replaces the other.
    quoteId: uuid.UUID | None = None
    appointmentId: uuid.UUID | None = None
    status: TaskStatus | None = None
    remind: bool | None = None


class TaskListQuery(BaseModel):
    """GET /tasks filters. `due=overdue` = open and past due."""

    status: TaskStatus | None = None
    assigneeId: str | None = None  # 'me' or a user id
    leadId: uuid.UUID | None = None
    quoteId: uuid.UUID | None = None
    appointmentId: uuid.UUID | None = None
    due: Literal["overdue"] | None = None


class Person(BaseModel):
    id: str
    name: str


QuoteStatus = Literal["DRAFT", "SENT", "ACCEPTED", "REJECTED"]
AppointmentStatus = Literal["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"]
TaskAutoKind = Literal["quote_followup", "appointment_confirm"]


class QuoteSubject(BaseModel):
    kind: Literal["quote"]
    id: str
    number: int
    status: QuoteStatus


class AppointmentSubject(BaseModel):
    kind: Literal["appointment"]
    id: str
    startsAt: str
    status: AppointmentStatus


TaskSubject = Annotated[QuoteSubject | AppointmentSubject, Field(discriminator="kind")]


class Task(BaseModel):
    id: str
    title: str
    notes: str | None
    dueAt: str
    status: TaskStatus
    remind: bool
    completedAt: str | None
    assignee: Person
    lead: Person | None
    # F35: the linked quote or appointment (always sent), and the kind of an automatic task.
    subject: TaskSubject | None
    autoKind: TaskAutoKind | None
    createdAt: str


class TaskResponse(BaseModel):
    task: Task


class TaskListResponse(BaseModel):
    tasks: list[Task]


class TaskAutomations(BaseModel):
    """F35 (D-213): the per-business switches of the automatic follow-ups (both required)."""

    quoteFollowUp: StrictBool
    appointmentConfirm: StrictBool


class TaskAutomationsResponse(BaseModel):
    settings: TaskAutomations
