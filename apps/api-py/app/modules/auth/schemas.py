"""Auth request/response schemas (packages/shared/src/auth.ts), with the same Hebrew messages.

Every field has a "" default and a `before` validator, so a missing or non-string value gets the
same "required" message the Zod schemas gave (rather than Pydantic's English "Field required").
Emails are trimmed and lowercased; passwords are never altered.
"""

import re
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.core.constants import AUTH_TOKEN_PATTERN

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 128
EMAIL_MAX_LENGTH = 254
FULL_NAME_MIN_LENGTH = 2
FULL_NAME_MAX_LENGTH = 100

AUTH_MESSAGES = {
    "fullNameRequired": "יש להזין שם מלא",
    "fullNameTooShort": f"השם המלא צריך להכיל לפחות {FULL_NAME_MIN_LENGTH} תווים",
    "fullNameTooLong": f"השם המלא יכול להכיל עד {FULL_NAME_MAX_LENGTH} תווים",
    "emailRequired": "יש להזין כתובת אימייל",
    "emailInvalid": "כתובת האימייל אינה תקינה",
    "emailTooLong": f"כתובת האימייל יכולה להכיל עד {EMAIL_MAX_LENGTH} תווים",
    "passwordRequired": "יש להזין סיסמה",
    "passwordTooShort": f"הסיסמה צריכה להכיל לפחות {PASSWORD_MIN_LENGTH} תווים",
    "passwordTooLong": f"הסיסמה יכולה להכיל עד {PASSWORD_MAX_LENGTH} תווים",
    "acceptTermsRequired": "יש לאשר את תנאי השימוש ומדיניות הפרטיות",
    # Same text for a missing, malformed, unknown, used or expired token.
    "tokenInvalid": "הקישור אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש",
    # 401 on login: identical for an unknown email, a wrong password and a blocked user.
    "invalidCredentials": "האימייל או הסיסמה שגויים",
    # 409 on register, returned as fields.email.
    "emailTaken": "כתובת האימייל הזו כבר רשומה. אפשר להתחבר או לאפס סיסמה",
}
ACCOUNT_MESSAGES = {
    "currentPasswordWrong": "הסיסמה הנוכחית שגויה",
    "samePassword": "הסיסמה החדשה זהה לנוכחית",
}

_EMAIL = re.compile(
    r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)


def _str(v: object, required_msg: str) -> str:
    if not isinstance(v, str):
        raise ValueError(required_msg)
    return v


def _email(v: object) -> str:
    s = _str(v, AUTH_MESSAGES["emailRequired"]).strip().lower()
    if not s:
        raise ValueError(AUTH_MESSAGES["emailRequired"])
    if len(s) > EMAIL_MAX_LENGTH:
        raise ValueError(AUTH_MESSAGES["emailTooLong"])
    if not _EMAIL.match(s):
        raise ValueError(AUTH_MESSAGES["emailInvalid"])
    return s


def _new_password(v: object) -> str:
    s = _str(v, AUTH_MESSAGES["passwordRequired"])
    if not s:
        raise ValueError(AUTH_MESSAGES["passwordRequired"])
    if len(s) < PASSWORD_MIN_LENGTH:
        raise ValueError(AUTH_MESSAGES["passwordTooShort"])
    if len(s) > PASSWORD_MAX_LENGTH:
        raise ValueError(AUTH_MESSAGES["passwordTooLong"])
    return s


def _login_password(v: object) -> str:
    """Only presence and the max bound: a policy change never locks out existing users."""
    s = _str(v, AUTH_MESSAGES["passwordRequired"])
    if not s:
        raise ValueError(AUTH_MESSAGES["passwordRequired"])
    if len(s) > PASSWORD_MAX_LENGTH:
        raise ValueError(AUTH_MESSAGES["passwordTooLong"])
    return s


def _full_name(v: object) -> str:
    s = _str(v, AUTH_MESSAGES["fullNameRequired"]).strip()
    if not s:
        raise ValueError(AUTH_MESSAGES["fullNameRequired"])
    if len(s) < FULL_NAME_MIN_LENGTH:
        raise ValueError(AUTH_MESSAGES["fullNameTooShort"])
    if len(s) > FULL_NAME_MAX_LENGTH:
        raise ValueError(AUTH_MESSAGES["fullNameTooLong"])
    return s


def _token(v: object) -> str:
    s = _str(v, AUTH_MESSAGES["tokenInvalid"])
    if not AUTH_TOKEN_PATTERN.match(s):
        raise ValueError(AUTH_MESSAGES["tokenInvalid"])
    return s


def _accept_terms(v: object) -> bool:
    if v is not True:
        raise ValueError(AUTH_MESSAGES["acceptTermsRequired"])
    return True


Email = Annotated[str, BeforeValidator(_email)]
NewPassword = Annotated[str, BeforeValidator(_new_password)]
LoginPassword = Annotated[str, BeforeValidator(_login_password)]
FullName = Annotated[str, BeforeValidator(_full_name)]
AuthToken = Annotated[str, BeforeValidator(_token)]
AcceptTerms = Annotated[bool, BeforeValidator(_accept_terms)]


class _Request(BaseModel):
    # Validate the "" defaults too, so a missing field gets its Hebrew 'required' message.
    model_config = ConfigDict(validate_default=True)


class RegisterRequest(_Request):
    fullName: FullName = ""
    email: Email = ""
    password: NewPassword = ""
    acceptTerms: AcceptTerms = False


class LoginRequest(_Request):
    email: Email = ""
    password: LoginPassword = ""


class VerifyEmailRequest(_Request):
    token: AuthToken = ""


class PasswordResetRequest(_Request):
    email: Email = ""


class PasswordResetConfirm(_Request):
    token: AuthToken = ""
    newPassword: NewPassword = ""


class UpdateProfileRequest(_Request):
    fullName: FullName = ""


class ChangePasswordRequest(_Request):
    currentPassword: LoginPassword = ""
    newPassword: NewPassword = ""


class AuthUser(BaseModel):
    """The only user shape that leaves the API. Never includes hashes or status internals."""

    id: str
    email: str
    fullName: str
    emailVerified: bool
    createdAt: str


class MeResponse(BaseModel):
    user: AuthUser
    emailVerification: bool
