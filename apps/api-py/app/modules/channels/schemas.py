"""F25 channels contract (packages/shared/src/channels.ts)."""

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator

from app.modules.auth.schemas import _Request

CHANNELS_MESSAGES = {
    "phoneNumberIdInvalid": "יש להזין את ה-Phone number ID (מספרים בלבד)",
    "tokenRequired": "יש להדביק את טוקן הגישה",
    "whatsappInvalid": "לא הצלחנו להגיע למספר עם הפרטים האלה. בדקו את ה-Phone number ID ואת טוקן הגישה.",
    "alreadyTaken": "המספר או הדף כבר מחוברים לעסק אחר.",
    "facebookUnavailable": "חיבור לפייסבוק עוד לא הוגדר במערכת.",
    "facebookFailed": "החיבור לפייסבוק לא הצליח. נסו שוב.",
    "facebookExpired": "החיבור לפייסבוק פג תוקף. התחילו שוב.",
    "noPages": "לא מצאנו דפי פייסבוק שאתם מנהלים בחשבון הזה.",
    "emailUnavailable": "קבלת מייל עוד לא הוגדרה בשרת.",
    "instagramNoAccount": "לא מצאנו חשבון אינסטגרם עסקי שמקושר לדף הפייסבוק. קשרו אותו בהגדרות הדף ונסו שוב.",
    "instagramFailed": "החיבור לאינסטגרם לא הצליח. נסו שוב.",
    "gmailUnavailable": "חיבור ל-Gmail עוד לא הוגדר במערכת.",
    "gmailFailed": "החיבור ל-Gmail לא הצליח. נסו שוב.",
    "gmailCancelled": "החיבור ל-Gmail בוטל.",
}
M = CHANNELS_MESSAGES
FACEBOOK_CALLBACK = "/api/v1/integrations/facebook/callback"
GMAIL_CALLBACK = "/api/v1/integrations/gmail/callback"
CONNECTION_CHANNELS = ("whatsapp", "messenger", "instagram", "email", "gmail")


def _phone_number_id(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if not re.fullmatch(r"\d{5,30}", s):
        raise ValueError(M["phoneNumberIdInvalid"])
    return s


def _access_token(v: Any) -> str:
    s = v.strip() if isinstance(v, str) else ""
    if len(s) < 20:
        raise ValueError(M["tokenRequired"])
    if len(s) > 4000:
        raise ValueError("Too long")
    return s


class ConnectWhatsAppRequest(_Request):
    phoneNumberId: Annotated[str, BeforeValidator(_phone_number_id)] = ""
    accessToken: Annotated[str, BeforeValidator(_access_token)] = ""


class ConnectFacebookRequest(BaseModel):
    pendingId: str
    pageId: Annotated[
        str,
        BeforeValidator(
            lambda v: (
                v
                if isinstance(v, str) and re.fullmatch(r"\d{1,40}", v)
                else (_ for _ in ()).throw(ValueError("Invalid"))
            )
        ),
    ]


class ConnectInstagramRequest(BaseModel):
    pendingId: str | None = None
    pageId: str | None = None


class ChannelStatus(BaseModel):
    channel: Literal["whatsapp", "messenger", "instagram", "email"]
    connected: bool
    name: str | None
    source: Literal["business", "environment"] | None


class ChannelsResponse(BaseModel):
    whatsapp: ChannelStatus
    messenger: ChannelStatus
    instagram: ChannelStatus
    gmail: ChannelStatus
    email: ChannelStatus
    emailInbound: bool
    facebookLogin: bool
    gmailLogin: bool


class FacebookStartResponse(BaseModel):
    url: str


class FacebookPage(BaseModel):
    id: str
    name: str
    instagram: str | None = None


class FacebookPagesResponse(BaseModel):
    pages: list[FacebookPage]
