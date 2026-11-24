"""F02 business contract (packages/shared/src/business.ts): messages, field validators, schemas.

Validators return normalised values (phone → E.164, blank address → null, website gets https://).
"""

import re
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator

from app.shared.industries import INDUSTRIES
from app.shared.phone import normalize_phone

BUSINESS_NAME_MIN_LENGTH = 2
BUSINESS_NAME_MAX_LENGTH = 80
ADDRESS_MAX_LENGTH = 200
SERVICE_AREA_MAX_LENGTH = 60
SERVICE_AREAS_MAX = 30
ONBOARDING_STEPS = 4  # 1 name + industry · 2 phone + address · 3 service areas · 4 opening hours

LANGUAGES = ("he", "en")
Language = Literal["he", "en"]
WEEKDAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")

BUSINESS_MESSAGES = {
    "nameRequired": "יש להזין את שם העסק",
    "nameTooShort": f"שם העסק צריך להכיל לפחות {BUSINESS_NAME_MIN_LENGTH} תווים",
    "nameTooLong": f"שם העסק יכול להכיל עד {BUSINESS_NAME_MAX_LENGTH} תווים",
    "industryRequired": "יש לבחור תחום פעילות",
    "phoneRequired": "יש להזין מספר טלפון",
    "onlyOneBusiness": "בשלב זה אפשר לנהל עסק אחד בלבד לכל משתמש",
    "phoneInvalid": "מספר הטלפון אינו תקין. לדוגמה: 050-1234567",
    "addressTooLong": f"הכתובת יכולה להכיל עד {ADDRESS_MAX_LENGTH} תווים",
    "websiteInvalid": "כתובת האתר אינה תקינה. לדוגמה: www.my-business.co.il",
    "websiteTooLong": "כתובת האתר ארוכה מדי",
    "serviceAreaTooLong": f"כל אזור שירות יכול להכיל עד {SERVICE_AREA_MAX_LENGTH} תווים",
    "serviceAreasTooMany": f"אפשר להוסיף עד {SERVICE_AREAS_MAX} אזורי שירות",
    "timeInvalid": "יש להזין שעה בפורמט 09:00",
    "hoursRange": "שעת הסגירה צריכה להיות אחרי שעת הפתיחה",
    "onboardingIncomplete": "כדי לסיים את ההקמה יש להשלים את שם העסק, התחום ומספר הטלפון",
}
M = BUSINESS_MESSAGES


def _str(v: Any, msg: str) -> str:
    if not isinstance(v, str):
        raise ValueError(msg)
    return v


def _name(v: Any) -> str:
    s = _str(v, M["nameRequired"]).strip()
    if not s:
        raise ValueError(M["nameRequired"])
    if len(s) < BUSINESS_NAME_MIN_LENGTH:
        raise ValueError(M["nameTooShort"])
    if len(s) > BUSINESS_NAME_MAX_LENGTH:
        raise ValueError(M["nameTooLong"])
    return s


def _industry(v: Any) -> str:
    if v not in INDUSTRIES:
        raise ValueError(M["industryRequired"])
    return v


def _phone(v: Any) -> str:
    """Validates and normalises to E.164: Israeli local forms, or any country with +<code>."""
    s = _str(v, M["phoneRequired"]).strip()
    if not s:
        raise ValueError(M["phoneRequired"])
    normalised = normalize_phone(s)
    if normalised is None:
        raise ValueError(M["phoneInvalid"])
    return normalised


def _address(v: Any) -> str | None:
    """Optional address: trimmed; blank becomes null."""
    if v is None:
        return None
    s = _str(v, M["addressTooLong"]).strip()
    if len(s) > ADDRESS_MAX_LENGTH:
        raise ValueError(M["addressTooLong"])
    return s or None


def _website(v: Any) -> str | None:
    """The business's own website (D-094): blank becomes null; "www.x.co.il" gets https://; only
    http(s) addresses with a real host name are accepted."""
    if v is None:
        return None
    s = _str(v, M["websiteInvalid"]).strip()
    if len(s) > 300:
        raise ValueError(M["websiteTooLong"])
    if not s:
        return None
    url = s if re.match(r"^https?://", s, re.I) else f"https://{s}"
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError as err:
        raise ValueError(M["websiteInvalid"]) from err
    if parts.scheme not in ("http", "https") or not re.search(r"\.[a-z]{2,}$", host, re.I):
        raise ValueError(M["websiteInvalid"])
    return url


def _service_areas(v: Any) -> list[str]:
    if not isinstance(v, list):
        raise ValueError(M["serviceAreasTooMany"])
    if len(v) > SERVICE_AREAS_MAX:
        raise ValueError(M["serviceAreasTooMany"])
    areas: list[str] = []
    for item in v:
        s = _str(item, M["serviceAreaTooLong"]).strip()
        if not s:
            raise ValueError("String must contain at least 1 character(s)")
        if len(s) > SERVICE_AREA_MAX_LENGTH:
            raise ValueError(M["serviceAreaTooLong"])
        areas.append(s)
    # Case-insensitive de-duplication, keeping the first spelling.
    seen: set[str] = set()
    out: list[str] = []
    for a in areas:
        if a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out


_TIME = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")


def _time(v: Any) -> str:
    if not isinstance(v, str) or not _TIME.match(v):
        raise ValueError(M["timeInvalid"])
    return v


BusinessName = Annotated[str, BeforeValidator(_name)]
Industry = Annotated[str, BeforeValidator(_industry)]
Phone = Annotated[str, BeforeValidator(_phone)]
Address = Annotated[str | None, BeforeValidator(_address)]
WebsiteUrl = Annotated[str | None, BeforeValidator(_website)]
ServiceAreas = Annotated[list[str], BeforeValidator(_service_areas)]
Time = Annotated[str, BeforeValidator(_time)]


class _Request(BaseModel):
    # Unknown keys (id, status, role, businessId…) are ignored, never applied.
    model_config = ConfigDict(validate_default=True, populate_by_name=True)


class DayHours(_Request):
    open: bool
    from_: Time = Field(alias="from")
    to: Time

    @field_validator("to")
    @classmethod
    def _range(cls, v: str, info) -> str:  # type: ignore[no-untyped-def]
        data = info.data
        if data.get("open") and "from_" in data and not data["from_"] < v:
            raise ValueError(M["hoursRange"])
        return v


class OpeningHours(_Request):
    sun: DayHours
    mon: DayHours
    tue: DayHours
    wed: DayHours
    thu: DayHours
    fri: DayHours
    sat: DayHours


class CreateBusinessRequest(_Request):
    name: BusinessName = ""
    industry: Industry = ""
    language: Language = "he"


class UpdateBusinessRequest(_Request):
    """PATCH: every field optional (use `model_fields_set` to tell "absent" from "null").
    `onboardingStep` saves wizard progress and is ignored once the business is ACTIVE."""

    name: BusinessName | None = None
    industry: Industry | None = None
    phone: Annotated[str | None, BeforeValidator(lambda v: None if v is None else _phone(v))] = None
    address: Address = None
    serviceAreas: ServiceAreas | None = None
    openingHours: OpeningHours | None = None
    websiteUrl: WebsiteUrl = None
    language: Language | None = None
    onboardingStep: Annotated[int, Field(ge=1, le=ONBOARDING_STEPS)] | None = None

    # Absent keys must not be validated (the "" defaults of other requests would raise).
    model_config = ConfigDict(validate_default=False, populate_by_name=True)


class NotificationPrefs(BaseModel):
    """Email on every new website lead (sent to owners and managers only)."""

    newLeadEmail: bool


class BusinessDto(BaseModel):
    id: str
    name: str
    industry: str
    phone: str | None
    address: str | None
    serviceAreas: list[str]
    openingHours: dict[str, Any] | None
    websiteUrl: str | None
    timezone: str
    language: Language
    status: str
    onboardingStep: int
    role: str
    createdAt: str


class BusinessResponse(BaseModel):
    business: BusinessDto


class BusinessSummary(BaseModel):
    id: str
    name: str
    status: str
    onboardingStep: int
    role: str


class BusinessListResponse(BaseModel):
    businesses: list[BusinessSummary]


class Member(BaseModel):
    userId: str
    fullName: str
    email: str
    role: str
    joinedAt: str


class MemberListResponse(BaseModel):
    members: list[Member]


class NotificationPrefsResponse(BaseModel):
    prefs: NotificationPrefs
