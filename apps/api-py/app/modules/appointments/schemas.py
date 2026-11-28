"""F17 appointments contract (packages/shared/src/appointments.ts)."""

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.modules.auth.schemas import _Request
from app.shared.business import _phone as validate_phone

APPOINTMENT_STATUSES = ("REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED")
AppointmentStatus = Literal["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"]
APPOINTMENT_STATUS_LABELS = {
    "REQUESTED": "ממתינה לאישור",
    "CONFIRMED": "מאושרת",
    "COMPLETED": "בוצעה",
    "NO_SHOW": "לא הגיע/ה",
    "CANCELLED": "בוטלה",
}
BLOCKING_STATUSES = ("REQUESTED", "CONFIRMED")  # statuses that hold the staff member's time

APPOINTMENT_MESSAGES = {
    "nameRequired": "יש להזין שם לשירות",
    "nameTooLong": "השם ארוך מדי (עד 80 תווים)",
    "durationInvalid": "משך בין 5 דקות ל־8 שעות",
    "priceInvalid": "יש להזין מחיר בשקלים (מספר שלם)",
    "startRequired": "יש לבחור מועד",
    "customerRequired": "יש לבחור ליד או להזין שם וטלפון של הלקוח",
    "customerNameRequired": "יש להזין שם לקוח",
    "notesTooLong": "ההערות ארוכות מדי (עד 1,000 תווים)",
    "serviceInvalid": "השירות שנבחר אינו קיים",
    "staffInvalid": "אפשר לשבץ רק חבר צוות פעיל בעסק",
    "leadInvalid": "הליד שנבחר אינו קיים",
    "clash": "יש כבר פגישה בזמן הזה לאותו איש צוות. בחרו שעה אחרת או איש צוות אחר.",
    "staffRequired": "כדי לאשר פגישה יש לשבץ איש צוות",
}
M = APPOINTMENT_MESSAGES
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def parse_datetime(v: Any, message: str) -> datetime:
    """An ISO-8601 UTC timestamp ending in Z (Zod's .datetime())."""
    if not isinstance(v, str) or not _DATETIME.match(v):
        raise ValueError(message)
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError as err:
        raise ValueError(message) from err


def _duration(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, int | float) or (isinstance(v, float) and not v.is_integer()):
        raise ValueError(M["durationInvalid"])
    v = int(v)
    if v < 5 or v > 480:
        raise ValueError(M["durationInvalid"])
    return v


def _service_name(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(M["nameRequired"])
    s = v.strip()
    if len(s) > 80:
        raise ValueError(M["nameTooLong"])
    return s


def _price(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int | float) or (isinstance(v, float) and not v.is_integer()):
        raise ValueError(M["priceInvalid"])
    v = int(v)
    if v < 0 or v > 1_000_000:
        raise ValueError(M["priceInvalid"])
    return v


def _notes(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError(M["notesTooLong"])
    s = v.strip()
    if len(s) > 1000:
        raise ValueError(M["notesTooLong"])
    return s or None


def _customer_name(v: Any) -> str:
    if not isinstance(v, str) or len(v.strip()) < 2:
        raise ValueError(M["customerNameRequired"])
    s = v.strip()
    if len(s) > 80:
        raise ValueError("String must contain at most 80 character(s)")
    return s


def _starts(v: Any) -> datetime:
    return parse_datetime(v, M["startRequired"])


Duration = Annotated[int, BeforeValidator(_duration)]
ServiceName = Annotated[str, BeforeValidator(_service_name)]
Price = Annotated[int | None, BeforeValidator(_price)]
Notes = Annotated[str | None, BeforeValidator(_notes)]
CustomerName = Annotated[str, BeforeValidator(_customer_name)]
StartsAt = Annotated[datetime, BeforeValidator(_starts)]
Phone = Annotated[str, BeforeValidator(validate_phone)]


class UpsertServiceRequest(_Request):
    name: ServiceName = ""
    durationMin: Duration = None  # type: ignore[assignment]
    price: Price = None
    active: bool = True


class CustomerIn(_Request):
    name: CustomerName = ""
    phone: Phone = ""


class CreateAppointmentRequest(_Request):
    """POST /appointments. The customer is an existing lead (`leadId`) or a name + phone (an
    existing contact with that phone is reused). Duration defaults to the service's."""

    startsAt: StartsAt = None  # type: ignore[assignment]
    durationMin: Duration | None = None
    serviceId: uuid.UUID | None = None
    staffId: uuid.UUID | None = None  # absent = the creator; null = nobody yet
    leadId: uuid.UUID | None = None
    customer: CustomerIn | None = None
    notes: Notes = None


class UpdateAppointmentRequest(BaseModel):
    model_config = ConfigDict(validate_default=False)

    startsAt: StartsAt | None = None
    durationMin: Duration | None = None
    serviceId: uuid.UUID | None = None
    staffId: uuid.UUID | None = None
    status: AppointmentStatus | None = None
    notes: Notes = None


class AppointmentListQuery(BaseModel):
    """GET /appointments: a time window (max 62 days), plus filters."""

    from_: str = Field(alias="from")
    to: str
    staffId: str | None = None  # 'me' or a user id
    leadId: uuid.UUID | None = None
    status: AppointmentStatus | None = None

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _window(self) -> "AppointmentListQuery":
        a = parse_datetime(self.from_, "Invalid datetime")
        b = parse_datetime(self.to, "Invalid datetime")
        span = (b - a).total_seconds()
        if not 0 < span <= 62 * 86400:
            raise ValueError("טווח לא תקין")
        return self

    @property
    def start(self) -> datetime:
        return parse_datetime(self.from_, "Invalid datetime")

    @property
    def end(self) -> datetime:
        return parse_datetime(self.to, "Invalid datetime")


class ServiceOut(BaseModel):
    id: str
    name: str
    durationMin: int
    price: int | None  # whole shekels; null = not shown
    active: bool


class ServiceResponse(BaseModel):
    service: ServiceOut


class ServiceListResponse(BaseModel):
    services: list[ServiceOut]


class IdName(BaseModel):
    id: str
    name: str


class CustomerOut(BaseModel):
    id: str
    name: str
    phone: str | None


class IdOnly(BaseModel):
    id: str


class AppointmentOut(BaseModel):
    id: str
    startsAt: str
    endsAt: str
    status: AppointmentStatus
    notes: str | None
    source: Literal["manual", "website", "whatsapp"]
    service: IdName | None
    staff: IdName | None
    customer: CustomerOut
    lead: IdOnly | None
    createdAt: str


class AppointmentResponse(BaseModel):
    appointment: AppointmentOut


class AppointmentListResponse(BaseModel):
    appointments: list[AppointmentOut]
