"""Expected, user-facing errors; the body is `{ error: { code, message, fields?, requestId } }`."""

from typing import Literal

ErrorCode = Literal[
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
]

STATUS_BY_CODE: dict[str, int] = {
    "VALIDATION_ERROR": 400,
    "UNAUTHENTICATED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "RATE_LIMITED": 429,
    "INTERNAL_ERROR": 500,
}

DEFAULT_MESSAGES: dict[str, str] = {
    "VALIDATION_ERROR": "חלק מהשדות אינם תקינים",
    "UNAUTHENTICATED": "יש להתחבר כדי להמשיך",
    "FORBIDDEN": "אין לך הרשאה לבצע פעולה זו",
    "NOT_FOUND": "הפריט המבוקש לא נמצא",
    "CONFLICT": "הפעולה מתנגשת בנתונים קיימים",
    "RATE_LIMITED": "יותר מדי ניסיונות. נסו שוב בעוד מספר דקות",
    "INTERNAL_ERROR": "אירעה שגיאה בלתי צפויה. נסו שוב מאוחר יותר",
}


class AppError(Exception):
    """Expected, user-facing error. Anything else is treated as an internal error."""

    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message or DEFAULT_MESSAGES[code]
        self.fields = fields
        self.status_code = STATUS_BY_CODE[code]
        super().__init__(self.message)
