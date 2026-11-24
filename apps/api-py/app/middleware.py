"""Request id and CSRF guard (apps/api/src/plugins/csrf.ts)."""

import re
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.constants import CSRF_HEADER_NAME
from app.deps import clear_session_cookie
from app.errors import DEFAULT_MESSAGES

STATE_CHANGING = {"POST", "PUT", "PATCH", "DELETE"}
_REQ_ID = re.compile(r"^[\w-]{8,64}$")

# Webhooks and public forms: no cookies, authenticated by a signature or key instead.
CSRF_EXEMPT = {
    "/api/v1/whatsapp/webhook",
    "/api/v1/whatsapp/messenger-webhook",
    "/api/v1/embed/lead",
    "/api/v1/embed/visit",
    "/api/v1/embed/event",
}


def error_response(
    code: str, status: int, request_id: str, message: str | None = None, **extra: object
) -> JSONResponse:
    body = {
        "error": {
            "code": code,
            "message": message or DEFAULT_MESSAGES[code],
            **extra,
            "requestId": request_id,
        }
    }
    return JSONResponse(body, status_code=status, headers={"x-request-id": request_id})


async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
    incoming = request.headers.get("x-request-id", "")
    request.state.request_id = incoming if _REQ_ID.match(incoming) else str(uuid.uuid4())

    # CSRF: every state-changing request needs a non-empty X-Requested-With, and an Origin, if
    # present, must be one of WEB_ORIGINS. Runs before auth and body validation.
    if request.method in STATE_CHANGING and request.url.path not in CSRF_EXEMPT:
        marker = request.headers.get(CSRF_HEADER_NAME.lower(), "")
        origin = request.headers.get("origin")
        allowed = request.app.state.settings.allowed_origins
        if not marker.strip() or (origin is not None and origin not in allowed):
            return error_response("FORBIDDEN", 403, request.state.request_id)

    response = await call_next(request)
    if getattr(request.state, "clear_session_cookie", False):
        clear_session_cookie(request, response)
    response.headers["x-request-id"] = request.state.request_id
    return response
