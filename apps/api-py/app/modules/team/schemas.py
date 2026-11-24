"""F09 team contract (packages/shared/src/team.ts)."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator

from app.core.constants import AUTH_TOKEN_PATTERN
from app.modules.auth.schemas import Email, _Request

INVITE_TTL_S = 7 * 24 * 60 * 60
INVITE_WEB_PATH = "/invite"
MAX_PENDING_INVITES = 50
INVITABLE_ROLES = ("MANAGER", "EMPLOYEE")
InvitableRole = Literal["MANAGER", "EMPLOYEE"]

TEAM_MESSAGES = {
    "alreadyMember": "האדם הזה כבר חבר בצוות",
    "tooManyInvites": "יש יותר מדי הזמנות פתוחות. בטלו חלק מהן ונסו שוב",
    "cannotChangeOwner": "אי אפשר לשנות או להסיר את בעל/ת העסק",
    "inviteInvalid": "ההזמנה אינה תקפה. בקשו מבעל/ת העסק לשלוח הזמנה חדשה",
    "wrongAccount": "ההזמנה נשלחה לכתובת אימייל אחרת. התחברו עם החשבון שאליו נשלחה ההזמנה",
}


def _role(v: Any) -> str:
    if v not in INVITABLE_ROLES:
        raise ValueError("יש לבחור תפקיד")
    return v


def _invite_token(v: Any) -> str:
    if not isinstance(v, str) or not AUTH_TOKEN_PATTERN.match(v):
        raise ValueError(TEAM_MESSAGES["inviteInvalid"])
    return v


Role = Annotated[str, BeforeValidator(_role)]
InviteToken = Annotated[str, BeforeValidator(_invite_token)]


class InviteRequest(_Request):
    email: Email = ""
    role: Role = ""


class UpdateMemberRequest(_Request):
    role: Role = ""


class InviteTokenRequest(_Request):
    """The token travels in the body (never in a logged URL)."""

    token: InviteToken = ""


class Invitation(BaseModel):
    id: str
    email: str
    role: InvitableRole
    invitedBy: str | None
    expiresAt: str
    createdAt: str


class InvitationResponse(BaseModel):
    invitation: Invitation


class InvitationListResponse(BaseModel):
    invitations: list[Invitation]


class InvitePreview(BaseModel):
    status: Literal["valid", "expired", "used", "revoked"]
    businessName: str
    email: str
    role: InvitableRole
    invitedBy: str | None


class InvitePreviewResponse(BaseModel):
    invite: InvitePreview


class AcceptInviteResponse(BaseModel):
    businessId: str
