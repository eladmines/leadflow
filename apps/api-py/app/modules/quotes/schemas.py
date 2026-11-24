"""F18 quotes contract (packages/shared/src/quotes.ts). Money is in agorot (integers)."""

import math
import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator

from app.modules.auth.schemas import _Request

QUOTE_STATUSES = ("DRAFT", "SENT", "ACCEPTED", "REJECTED")
QuoteStatus = Literal["DRAFT", "SENT", "ACCEPTED", "REJECTED"]
QUOTE_STATUS_LABELS = {
    "DRAFT": "טיוטה",
    "SENT": "נשלחה",
    "ACCEPTED": "אושרה",
    "REJECTED": "נדחתה",
    "EXPIRED": "פג תוקף",
}
DEFAULT_VAT_RATE = 18  # Israeli VAT (18% since 1/2025); 0 = no VAT
QUOTE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
QUOTE_WEB_PATH = "/q"

QUOTE_MESSAGES = {
    "titleTooLong": "הכותרת ארוכה מדי (עד 120 תווים)",
    "itemRequired": "יש להוסיף לפחות שורה אחת",
    "tooManyItems": "אפשר עד 50 שורות",
    "descriptionRequired": "יש לתאר את השירות או המוצר",
    "descriptionTooLong": "התיאור ארוך מדי (עד 300 תווים)",
    "quantityInvalid": "כמות בין 1 ל־9,999",
    "priceInvalid": "מחיר לא תקין",
    "discountInvalid": "ההנחה לא יכולה להיות גבוהה מהסכום",
    "vatInvalid": "שיעור מע״מ לא תקין",
    "notesTooLong": "ההערות ארוכות מדי (עד 2,000 תווים)",
    "leadInvalid": "הליד שנבחר אינו קיים",
    "notDraft": "אפשר לערוך רק טיוטה. כדי לשנות הצעה שנשלחה, שכפלו אותה.",
    "notOpen": "ההצעה כבר אינה ממתינה להחלטה",
    "expired": "תוקף ההצעה פג. אפשר לפנות לעסק לקבלת הצעה מעודכנת.",
    "noEmail": "ללקוח אין כתובת אימייל. אפשר לשלוח את הקישור ב־WhatsApp או להעתיק אותו.",
}
M = QUOTE_MESSAGES


def quote_totals(items: list[dict[str, Any]], discount: int, vat_rate: float) -> dict[str, int]:
    """All amounts in agorot. VAT is on the amount after discount, rounded to the agora (halves
    up, like JavaScript's Math.round)."""
    subtotal = sum(i["quantity"] * i["unitPrice"] for i in items)
    d = min(max(discount, 0), subtotal)
    vat = math.floor((subtotal - d) * vat_rate / 100 + 0.5)
    return {"subtotal": subtotal, "discount": d, "vat": vat, "total": subtotal - d + vat}


def format_agorot(a: int) -> str:
    """₪1,234.50 from agorot, as the Hebrew locale writes it (RLM, NBSP, RLM, ₪)."""
    return f"\u200f{a // 100:,}.{a % 100:02d} \u200f₪"


def _int(v: Any, message: str, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int | float) or (isinstance(v, float) and not v.is_integer()):
        raise ValueError(message)
    v = int(v)
    if v < lo or v > hi:
        raise ValueError(message)
    return v


def _agorot(v: Any) -> int:
    return _int(v, M["priceInvalid"], 0, 10_000_000_00)


def _description(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(M["descriptionRequired"])
    s = v.strip()
    if len(s) > 300:
        raise ValueError(M["descriptionTooLong"])
    return s


def _quantity(v: Any) -> int:
    return _int(v, M["quantityInvalid"], 1, 9999)


def _title(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if len(s) > 120:
        raise ValueError(M["titleTooLong"])
    return s


def _notes(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if len(s) > 2000:
        raise ValueError(M["notesTooLong"])
    return s


def _vat(v: Any) -> float:
    if isinstance(v, bool) or not isinstance(v, int | float) or v < 0 or v > 30:
        raise ValueError(M["vatInvalid"])
    return float(v)


def _items(v: Any) -> Any:
    if not isinstance(v, list) or len(v) < 1:
        raise ValueError(M["itemRequired"])
    if len(v) > 50:
        raise ValueError(M["tooManyItems"])
    return v


def _valid_until(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise ValueError("Invalid")
    return v


Agorot = Annotated[int, BeforeValidator(_agorot)]


class QuoteItem(_Request):
    description: Annotated[str, BeforeValidator(_description)] = ""
    quantity: Annotated[int, BeforeValidator(_quantity)] = None  # type: ignore[assignment]
    unitPrice: Agorot = None  # type: ignore[assignment]  # agorot, before VAT


class UpsertQuoteRequest(_Request):
    title: Annotated[str, BeforeValidator(_title)] = ""
    items: Annotated[list[QuoteItem], BeforeValidator(_items)] = None  # type: ignore[assignment]
    discount: Agorot = 0
    vatRate: Annotated[float, BeforeValidator(_vat)] = DEFAULT_VAT_RATE
    notes: Annotated[str, BeforeValidator(_notes)] = ""
    validUntil: Annotated[str | None, BeforeValidator(_valid_until)] = None  # YYYY-MM-DD; null = no expiry


class CreateQuoteRequest(UpsertQuoteRequest):
    leadId: uuid.UUID = None  # type: ignore[assignment]


class QuoteListQuery(BaseModel):
    status: QuoteStatus | None = None
    leadId: uuid.UUID | None = None


class SendQuoteRequest(BaseModel):
    email: bool = False


class DecideQuoteRequest(BaseModel):
    status: Literal["ACCEPTED", "REJECTED"]


class PublicDecisionRequest(BaseModel):
    decision: Literal["accept", "reject"]


class ItemOut(BaseModel):
    description: str
    quantity: int
    unitPrice: int


class Totals(BaseModel):
    subtotal: int
    discount: int
    vat: int
    total: int


class LeadRef(BaseModel):
    id: str


class CustomerRef(BaseModel):
    name: str
    phone: str | None
    email: str | None


class QuoteOut(BaseModel):
    id: str
    number: int
    title: str
    items: list[ItemOut]
    discount: int
    vatRate: float
    notes: str
    validUntil: str | None
    status: QuoteStatus
    expired: bool
    totals: Totals
    lead: LeadRef
    customer: CustomerRef
    publicUrl: str | None  # customer page link, once the quote has been sent
    sentAt: str | None
    decidedAt: str | None
    createdAt: str
    updatedAt: str


class QuoteResponse(BaseModel):
    quote: QuoteOut


class QuoteListResponse(BaseModel):
    quotes: list[QuoteOut]


class BusinessRef(BaseModel):
    name: str
    phone: str | None
    address: str | None


class PublicQuote(BaseModel):
    """What the customer sees on the quote page (no internal ids)."""

    number: int
    title: str
    items: list[ItemOut]
    vatRate: float
    notes: str
    validUntil: str | None
    status: QuoteStatus
    expired: bool
    totals: Totals
    sentAt: str | None
    customerName: str
    business: BusinessRef


class PublicQuoteResponse(BaseModel):
    quote: PublicQuote
