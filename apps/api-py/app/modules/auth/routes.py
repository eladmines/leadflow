"""F01 auth endpoints. Same paths, bodies and responses as the Node API."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.core.ratelimit import client_ip, rate_limited
from app.deps import (
    Auth,
    AuthState,
    Db,
    clear_session_cookie,
    optional_auth,
    set_session_cookie,
)
from app.modules.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    UpdateProfileRequest,
    VerifyEmailRequest,
)
from app.modules.auth.service import (
    IP_MAX,
    USER_AGENT_MAX,
    AuthService,
    RequestMeta,
    to_auth_user,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

Current = Annotated[AuthState | None, Depends(optional_auth)]


def _meta(request: Request) -> RequestMeta:
    ua = request.headers.get("user-agent")
    return RequestMeta(
        ip=client_ip(request)[:IP_MAX],
        user_agent=ua[:USER_AGENT_MAX] if ua else None,
        lang="en" if request.headers.get("x-simplecatch-locale") == "en" else "he",
    )


def _service(request: Request, db: Db) -> AuthService:
    return AuthService(db, request.app.state.email, request.app.state.settings)


def _me(request: Request, user) -> MeResponse:  # type: ignore[no-untyped-def]
    return MeResponse(user=to_auth_user(user), emailVerification=request.app.state.settings.verification_on)


@router.post(
    "/register",
    status_code=201,
    response_model=MeResponse,
    dependencies=[Depends(rate_limited("register"))],
)
async def register(body: RegisterRequest, request: Request, response: Response, db: Db, current: Current):
    result = await _service(request, db).register(body, _meta(request), current)
    set_session_cookie(request, response, result.session_token)
    return _me(request, result.user)


@router.post("/login", response_model=MeResponse, dependencies=[Depends(rate_limited("login"))])
async def login(body: LoginRequest, request: Request, response: Response, db: Db, current: Current):
    result = await _service(request, db).login(body.email, body.password, _meta(request), current)
    set_session_cookie(request, response, result.session_token)
    return _me(request, result.user)


@router.post("/logout", status_code=204)
async def logout(request: Request, db: Db, current: Current):
    await _service(request, db).logout(current, _meta(request))
    resp = Response(status_code=204)
    clear_session_cookie(request, resp)
    return resp


@router.get("/me", response_model=MeResponse)
async def me(request: Request, auth: Auth):
    return _me(request, auth.user)


@router.post("/verify-email", status_code=204, dependencies=[Depends(rate_limited("verify-email"))])
async def verify_email(body: VerifyEmailRequest, request: Request, db: Db):
    await _service(request, db).verify_email(body.token, _meta(request))


@router.post(
    "/resend-verification",
    status_code=204,
    dependencies=[Depends(rate_limited("resend-verification"))],
)
async def resend_verification(request: Request, db: Db, auth: Auth):
    await _service(request, db).resend_verification(auth.user, _meta(request))


@router.post(
    "/password-reset/request",
    status_code=204,
    dependencies=[Depends(rate_limited("password-reset-request"))],
)
async def password_reset_request(body: PasswordResetRequest, request: Request, db: Db):
    await _service(request, db).request_password_reset(body.email, _meta(request))


@router.post(
    "/password-reset/confirm",
    status_code=204,
    dependencies=[Depends(rate_limited("password-reset-confirm"))],
)
async def password_reset_confirm(body: PasswordResetConfirm, request: Request, db: Db):
    await _service(request, db).confirm_password_reset(body.token, body.newPassword, _meta(request))
    # All sessions were revoked, including this browser's.
    resp = Response(status_code=204)
    clear_session_cookie(request, resp)
    return resp


@router.patch("/profile", response_model=MeResponse)
async def update_profile(body: UpdateProfileRequest, request: Request, db: Db, auth: Auth):
    user = await _service(request, db).update_profile(auth, body.fullName)
    return _me(request, user)


@router.post("/password", status_code=204, dependencies=[Depends(rate_limited("password"))])
async def change_password(body: ChangePasswordRequest, request: Request, db: Db, auth: Auth):
    await _service(request, db).change_password(auth, body.currentPassword, body.newPassword, _meta(request))
