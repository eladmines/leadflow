"""Lead capture, CRM and customers contract (packages/shared/src/{leads,customers}.ts)."""

import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, WithJsonSchema

from app.modules.auth.schemas import _Request
from app.shared.attribution import Attribution
from app.shared.business import _phone as validate_phone
from app.shared.lead_fields import MAX_CUSTOM_FIELD_KEYS
from app.shared.lead_fields import M as LEAD_FIELD_MESSAGES

LEAD_SOURCES = ("website_form", "manual", "whatsapp", "facebook", "instagram", "email")
LEAD_SOURCE_LABELS = {
    "website_form": "טופס באתר",
    "manual": "הוזן ידנית",
    "whatsapp": "WhatsApp",
    "facebook": "פייסבוק",
    "instagram": "אינסטגרם",
    "email": "מייל",
}
STAGE_KINDS = ("OPEN", "WON", "LOST")
# The default stage a lead is in once a quote went out to it: a lead gets there by sending a quote.
QUOTE_SENT_STAGE = "הצעה נשלחה"
QUOTE_STAGE_NEEDS_QUOTE = 'כדי להעביר ל"הצעה נשלחה" צריך קודם ליצור ולשלוח הצעת מחיר לליד'
DEFAULT_PIPELINE_STAGES = [
    ("חדש", "OPEN"),
    ("נוצר קשר", "OPEN"),
    ("הצעה נשלחה", "OPEN"),
    ("ממתין", "OPEN"),
    ("נסגר", "WON"),
    ("אבוד", "LOST"),
]
ACTIVITY_TYPES = (
    "lead.created",
    "lead.stage_changed",
    "lead.assigned",
    "lead.updated",
    "lead.note",
    "task.created",
    "task.completed",
    "appointment.created",
    "appointment.updated",
    "quote.created",
    "quote.sent",
    "quote.accepted",
    "quote.rejected",
)
CUSTOMER_BOOKING_STATUSES = ("CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED")

LEAD_MESSAGES = {
    "nameRequired": "יש להזין שם",
    "nameTooLong": "השם ארוך מדי",
    "emailInvalid": "כתובת האימייל אינה תקינה",
    "messageTooLong": "ההודעה ארוכה מדי (עד 1,000 תווים)",
    "consentRequired": "יש לאשר את יצירת הקשר כדי לשלוח",
    "formExpired": "תוקף הטופס פג. רעננו את הדף ונסו שוב.",
    "slotIncomplete": "לבקשת פגישה יש לבחור גם תאריך וגם שעה",
    "slotInvalid": "המועד שנבחר לפגישה אינו תקין",
    "slotPast": "אפשר לבקש פגישה רק למועד עתידי (עד 4 חודשים קדימה)",
}
CRM_MESSAGES = {
    "contactRequired": "יש להזין טלפון או אימייל",
    "noteRequired": "יש לכתוב הערה",
    "noteTooLong": "ההערה ארוכה מדי (עד 2,000 תווים)",
    "stageInvalid": "השלב שנבחר אינו קיים",
    "ownerInvalid": "אפשר לשייך רק לחבר צוות פעיל בעסק",
    "tagTooLong": "תגית יכולה להכיל עד 30 תווים",
    "tooManyTags": "אפשר עד 10 תגיות לליד",
}
IMPORT_MAX_ROWS = 1000
IMPORT_MESSAGES = {
    "tooMany": f"אפשר לייבא עד {IMPORT_MAX_ROWS} שורות בכל פעם",
    "noRows": "לא נמצאו שורות לייבוא",
    "nameInvalid": "שם חסר או קצר מדי",
    "contactMissing": "חסר טלפון או אימייל",
    "phoneInvalid": "מספר הטלפון אינו תקין",
    "emailInvalid": "כתובת האימייל אינה תקינה",
    "alreadyCustomer": "כבר קיים כלקוח",
}
MAX_LEAD_TAGS = 10
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_UUID_LIKE = re.compile(r"^[0-9a-f-]{36}$", re.I)


# ---------------------------------------------------------------------------- validators


def _name(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError(LEAD_MESSAGES["nameRequired"])
    s = v.strip()
    if len(s) < 2:
        raise ValueError(LEAD_MESSAGES["nameRequired"])
    if len(s) > 80:
        raise ValueError(LEAD_MESSAGES["nameTooLong"])
    return s


def _optional_text(v: Any) -> str | None:
    """Trimmed; blank becomes null."""
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError(LEAD_MESSAGES["messageTooLong"])
    s = v.strip()
    if len(s) > 1000:
        raise ValueError(LEAD_MESSAGES["messageTooLong"])
    return s or None


def _optional_phone(v: Any) -> str | None:
    if v is None or v == "":
        return None
    return validate_phone(v)


def _optional_email(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError(LEAD_MESSAGES["emailInvalid"])
    s = v.strip().lower()
    if not s:
        return None
    if len(s) > 254 or not _EMAIL.match(s):
        raise ValueError(LEAD_MESSAGES["emailInvalid"])
    return s


def _tags(v: Any) -> list[str]:
    """Tags without duplicates (case-insensitive), in the order given."""
    if not isinstance(v, list):
        raise ValueError(CRM_MESSAGES["tooManyTags"])
    if len(v) > MAX_LEAD_TAGS:
        raise ValueError(CRM_MESSAGES["tooManyTags"])
    out: list[str] = []
    seen: set[str] = set()
    for item in v:
        if not isinstance(item, str):
            raise ValueError("Expected string")
        t = item.strip()
        if not t:
            raise ValueError("String must contain at least 1 character(s)")
        if len(t) > 30:
            raise ValueError(CRM_MESSAGES["tagTooLong"])
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def _note(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(CRM_MESSAGES["noteRequired"])
    s = v.strip()
    if len(s) > 2000:
        raise ValueError(CRM_MESSAGES["noteTooLong"])
    return s


def _custom_fields_input(v: Any) -> dict[str, Any]:
    """F34: the shape of `customFields` (`customFieldsInputSchema`). The per-business check (known
    field, type, option, required) is `validate_custom_fields` in the service."""
    if not isinstance(v, dict):
        raise ValueError(LEAD_FIELD_MESSAGES["valuesInvalid"])
    if len(v) > MAX_CUSTOM_FIELD_KEYS:
        raise ValueError(LEAD_FIELD_MESSAGES["tooManyValues"])
    for value in v.values():
        if value is not None and not isinstance(value, str | int | float | bool):
            raise ValueError(LEAD_FIELD_MESSAGES["valuesInvalid"])
    return v


_CUSTOM_FIELDS_INPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": {
        "anyOf": [{"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "null"}]
    },
}


def _strict_bool(v: Any) -> bool:
    if not isinstance(v, bool):
        raise ValueError("Expected boolean")
    return v


def _enum(values: tuple[str, ...], message: str):
    def check(v: Any) -> str:
        if v not in values:
            raise ValueError(message)
        return v

    return check


Name = Annotated[str, BeforeValidator(_name)]
OptionalText = Annotated[str | None, BeforeValidator(_optional_text)]
OptionalPhone = Annotated[str | None, BeforeValidator(_optional_phone)]
OptionalEmail = Annotated[str | None, BeforeValidator(_optional_email)]
Tags = Annotated[list[str], BeforeValidator(_tags)]
Note = Annotated[str, BeforeValidator(_note)]
# `{ [fieldId]: value }`; `null`/`""` = no value. Any non-object (null included) is refused.
CustomFieldsInput = Annotated[
    dict[str, Any] | None,
    BeforeValidator(_custom_fields_input),
    WithJsonSchema(_CUSTOM_FIELDS_INPUT_SCHEMA),
]


# ---------------------------------------------------------------------------- requests


class CreateLeadRequest(_Request):
    """Manual lead (F08). Needs a name and a phone or an email; a matching contact is reused.
    D-207: no value field; an `expectedValue` key from an old client is ignored like any extra."""

    name: Name = ""
    phone: OptionalPhone = None
    email: OptionalEmail = None
    message: OptionalText = None
    stageId: uuid.UUID | None = None
    ownerId: uuid.UUID | None = None
    # F34: checked per business (mode 'create', in the app: required fields needed).
    customFields: CustomFieldsInput = Field(default_factory=dict)
    # D-205: quick "add customer" paths in the app don't demand required custom fields (every
    # value sent is still validated). Never stored.
    skipRequiredCustomFields: Annotated[bool, BeforeValidator(_strict_bool)] = False


class UpdateLeadRequest(BaseModel):
    """PATCH: every field optional; each change is recorded in the activity log. Use
    `model_fields_set` to tell "absent" from "null". D-207/D-209: no `expectedValue` and no
    `nextActionAt`; those keys from an old client are ignored (extras), not stored."""

    model_config = ConfigDict(validate_default=False)

    stageId: uuid.UUID | None = None
    ownerId: uuid.UUID | None = None
    message: OptionalText = None
    tags: Tags | None = None
    # F34: a patch (keys sent change; `null`/`""` removes a value; absent keys stay).
    customFields: CustomFieldsInput = None


class AddNoteRequest(_Request):
    text: Note = ""


class LeadListQuery(BaseModel):
    """GET /leads: free-text search + filters. `ownerId=none` = unassigned."""

    model_config = ConfigDict(populate_by_name=True)

    q: str | None = Field(default=None, max_length=100)
    stageId: str | None = None
    ownerId: str | None = None
    source: Literal["website_form", "manual", "whatsapp", "facebook", "instagram", "email"] | None = None
    # F26: where it came from; `unknown` = no attribution recorded.
    from_: (
        Literal[
            "google_ads",
            "google",
            "meta_ads",
            "meta",
            "tiktok",
            "microsoft_ads",
            "utm",
            "referral",
            "direct",
            "unknown",
        ]
        | None
    ) = Field(default=None, alias="from")
    campaign: str | None = Field(default=None, max_length=100)
    tag: str | None = Field(default=None, max_length=30)


class DuplicateQuery(BaseModel):
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=254)


class CustomerListQuery(BaseModel):
    q: str | None = Field(default=None, max_length=100)


class ImportCustomerRow(BaseModel):
    """A spreadsheet row as the browser sends it: raw text, checked per row on the server.
    D-207: no value column; a `value` key is ignored."""

    name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=60)
    email: str | None = Field(default=None, max_length=300)


class ImportCustomersRequest(BaseModel):
    rows: Annotated[list[ImportCustomerRow], Field(min_length=1, max_length=IMPORT_MAX_ROWS)]


# ---------------------------------------------------------------------------- public form


class LeadSubmission(BaseModel):
    """Public form fields (urlencoded strings). Unknown fields are ignored."""

    name: str
    phone: str
    email: str | None
    message: str | None
    serviceId: str | None
    date: str | None
    time: str | None


def parse_lead_submission(form: dict[str, str]) -> tuple[LeadSubmission | None, dict[str, str]]:
    """Validates a website form post. Returns the submission, or the field errors."""
    errors: dict[str, str] = {}

    def field(key: str, fn):  # type: ignore[no-untyped-def]
        try:
            return fn(form.get(key))
        except ValueError as err:
            errors[key] = str(err)
            return None

    name = field("name", _name)
    phone = field("phone", validate_phone)
    email = field("email", _optional_email)
    message = field("message", _optional_text)
    if form.get("consent") != "on":
        errors["consent"] = LEAD_MESSAGES["consentRequired"]
    service_raw = form.get("serviceId")
    service_id = service_raw if service_raw and _UUID_LIKE.match(service_raw) else None
    date = form.get("date") or None
    time = form.get("time") or None
    if date is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        errors["date"] = LEAD_MESSAGES["slotInvalid"]
    if time is not None and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", time):
        errors["time"] = LEAD_MESSAGES["slotInvalid"]
    if (date is None) != (time is None):
        errors.setdefault("date", LEAD_MESSAGES["slotIncomplete"])
    if errors:
        return None, errors
    return LeadSubmission(
        name=name, phone=phone, email=email, message=message, serviceId=service_id, date=date, time=time
    ), {}  # type: ignore[arg-type]


# ---------------------------------------------------------------------------- responses


class ContactOut(BaseModel):
    id: str
    name: str
    phone: str | None
    email: str | None


class StageOut(BaseModel):
    id: str
    name: str
    kind: Literal["OPEN", "WON", "LOST"]


class PersonOut(BaseModel):
    id: str
    name: str


class LastWhatsApp(BaseModel):
    body: str
    direction: Literal["IN", "OUT"]
    createdAt: str


class LeadValue(BaseModel):
    """D-207/D-208/D-210: whole shekels from the lead's quotes. `won` = all accepted quotes;
    `open` = the latest sent quote while still sent and not expired."""

    won: int = Field(ge=0)
    open: int = Field(ge=0)


class LeadNextTask(BaseModel):
    """D-209: the lead's nearest open task the member may see."""

    id: str
    title: str
    dueAt: str
    assignee: PersonOut


class LeadOut(BaseModel):
    id: str
    contact: ContactOut
    stage: StageOut
    source: Literal["website_form", "manual", "whatsapp", "facebook", "email", "instagram"]
    sourceUrl: str | None
    attribution: Attribution | None
    message: str | None
    owner: PersonOut | None
    value: LeadValue  # D-207: read-only, from quotes
    nextTask: LeadNextTask | None  # D-209: replaces the next-action date
    tags: list[str]
    # F34: `{ [fieldId]: value }`, archived fields' values included; `{}` when none. `bool` comes
    # first so `true` never turns into `1`.
    customFields: dict[str, bool | int | float | str]
    lastWhatsApp: LastWhatsApp | None
    createdAt: str
    updatedAt: str


class LeadResponse(BaseModel):
    lead: LeadOut


class LeadListResponse(BaseModel):
    leads: list[LeadOut]


class ActivityOut(BaseModel):
    id: str
    type: Literal[
        "lead.created",
        "lead.stage_changed",
        "lead.assigned",
        "lead.updated",
        "lead.note",
        "task.created",
        "task.completed",
        "appointment.created",
        "appointment.updated",
        "quote.created",
        "quote.sent",
        "quote.accepted",
        "quote.rejected",
    ]
    data: dict[str, Any]
    actor: PersonOut | None
    createdAt: str


# D-212 (F35): at most this many related leads are returned (newest first).
MAX_RELATED_LEADS = 10


class RelatedLead(BaseModel):
    """Another lead of the same contact (D-212, D-215)."""

    id: str
    stage: StageOut
    createdAt: str
    value: LeadValue


class LeadDetailResponse(BaseModel):
    lead: LeadOut
    activities: list[ActivityOut]
    # D-215: the contact's other leads the member may see; `[]` when none. Always sent.
    relatedLeads: list[RelatedLead] = Field(max_length=MAX_RELATED_LEADS)


class ActivityResponse(BaseModel):
    activity: ActivityOut


class PipelineStageOut(BaseModel):
    id: str
    name: str
    position: int
    kind: Literal["OPEN", "WON", "LOST"]


class PipelineResponse(BaseModel):
    stages: list[PipelineStageOut]


class DuplicateContact(BaseModel):
    id: str
    name: str
    phone: str | None
    email: str | None
    leadCount: int


class DuplicatesResponse(BaseModel):
    contacts: list[DuplicateContact]


class LeadTagsResponse(BaseModel):
    """Tags in use on the leads the member can see, most used first."""

    tags: list[str]


class CustomerPurchase(BaseModel):
    leadId: str
    at: str  # when it became a purchase: the quote's acceptance, else the lead's last change
    value: int | None
    via: Literal["won", "quote"]


class CustomerBooking(BaseModel):
    appointmentId: str
    startsAt: str
    status: Literal["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"]
    serviceName: str | None
    leadId: str | None


class Customer(BaseModel):
    contactId: str
    name: str
    phone: str | None
    email: str | None
    totalValue: int
    lastPurchaseAt: str | None
    lastActivityAt: str
    attribution: Attribution | None
    purchases: list[CustomerPurchase]
    bookings: list[CustomerBooking]


class CustomerListResponse(BaseModel):
    customers: list[Customer]


class InvalidRow(BaseModel):
    row: int
    reason: str


class ImportCustomersResponse(BaseModel):
    imported: int
    duplicates: int
    invalid: list[InvalidRow]
