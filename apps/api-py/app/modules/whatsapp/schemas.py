"""WhatsApp / inbox contract (packages/shared/src/whatsapp.ts, channels.ts)."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field

from app.core.wire import Wire
from app.modules.auth.schemas import _Request

WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000
WHATSAPP_TEXT_MAX = 4096
WHATSAPP_STATUSES = ("received", "queued", "sent", "delivered", "read", "failed")
CHANNELS = ("whatsapp", "messenger", "instagram", "email")

MESSAGES = {
    "untilPast": "הזמן שבחרתם כבר עבר",
    "textRequired": "יש לכתוב הודעה",
    "textTooLong": f"ההודעה ארוכה מדי (עד {WHATSAPP_TEXT_MAX:,} תווים)",
    "notConnected": "WhatsApp עדיין לא מחובר לעסק הזה",
    "noPhone": "לליד הזה אין מספר טלפון",
    "windowClosed": "אפשר לענות בוואטסאפ רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח. כדי לפנות מחדש, התקשרו אליו.",
    "sendFailed": "ההודעה לא נשלחה. נסו שוב בעוד רגע",
    "alreadyCustomer": "המספר כבר משויך ללקוח במערכת. כדי להסיר אותו, מחקו את הליד.",
    "notPersonal": "אפשר לבטל רק סימון של מספר פרטי",
    "messengerNotConnected": "פייסבוק עדיין לא מחובר לעסק הזה",
    "emailNotConnected": "המייל עדיין לא מחובר לעסק הזה",
    "emailNotConfigured": "שליחת מייל עוד לא הוגדרה בשרת, ולכן אי אפשר לענות כאן.",
    "messengerWindowClosed": "אפשר לענות בפייסבוק רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח.",
    "instagramNotConnected": "אינסטגרם עדיין לא מחובר לעסק הזה",
    "instagramWindowClosed": "אפשר לענות באינסטגרם רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח.",
}
M = MESSAGES


def _text(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if not s:
        raise ValueError(M["textRequired"])
    if len(s) > WHATSAPP_TEXT_MAX:
        raise ValueError(M["textTooLong"])
    return s


class SendRequest(_Request):
    text: Annotated[str, BeforeValidator(_text)] = ""


class PauseBotRequest(BaseModel):
    paused: bool


class ClassifyRequest(BaseModel):
    as_: Literal["BUSINESS", "PERSONAL"] = Field(alias="as")


class Sender(BaseModel):
    id: str
    name: str


class MessageOut(Wire):
    id: str
    direction: Literal["IN", "OUT"]
    body: str
    status: Literal["received", "queued", "sent", "delivered", "read", "failed"]
    subject: str | None = None
    sender: Sender | None
    createdAt: str
    channel: Literal["whatsapp", "messenger", "instagram", "email"] | None = None


class ThreadResponse(Wire):
    connected: bool
    messages: list[MessageOut]
    replyUntil: str | None
    botPaused: bool
    channel: Literal["whatsapp", "messenger", "instagram", "email"] | None = None


class SendResponse(BaseModel):
    message: MessageOut


class InboxNumber(Wire):
    id: str
    phone: str
    channel: Literal["whatsapp", "messenger", "instagram", "email"] | None = None
    profileName: str | None
    messages: list[MessageOut]
    lastMessageAt: str


class InboxResponse(BaseModel):
    connected: bool
    numbers: list[InboxNumber]


class PersonalNumber(Wire):
    id: str
    phone: str
    channel: Literal["whatsapp", "messenger", "instagram", "email"] | None = None
    name: str | None = None
    classifiedAt: str | None


class PersonalNumbersResponse(BaseModel):
    numbers: list[PersonalNumber]


class ClassifyResponse(BaseModel):
    status: Literal["UNCLASSIFIED", "BUSINESS", "PERSONAL"]
    leadId: str | None


class EmailInbound(BaseModel):
    """F27: an email to a business's forwarding address (provider-neutral)."""

    to: str
    from_: str = Field(alias="from")
    fromName: str | None = None
    subject: str = ""
    text: str = ""
    messageId: str
    inReplyTo: str | None = None
    autoSubmitted: bool = False
    receivedAt: str | None = None
