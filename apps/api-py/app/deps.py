"""Request dependencies: session auth, tenant scope and permission checks.

Mirrors apps/api/src/plugins/{session,tenant}.ts. Tenant routes live on `tenant_router`; the
business id comes only from the URL and only after membership is verified (404 for outsiders).
"""

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    AUTH_TOKEN_PATTERN,
    SESSION_ABSOLUTE_TTL_S,
    SESSION_COOKIE_NAME,
    SESSION_IDLE_TTL_S,
    SESSION_TOUCH_INTERVAL_S,
)
from app.core.crypto import sha256_hex
from app.core.permissions import can
from app.db.models import Membership as MembershipRow
from app.db.models import MembershipStatus, Session, User, UserStatus
from app.db.session import db_session
from app.errors import AppError

Db = Annotated[AsyncSession, Depends(db_session)]

TENANT_PREFIX = "/api/v1/businesses/{business_id}"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


@dataclass
class AuthState:
    user: User
    session: Session


@dataclass
class TenantContext:
    """Who is acting, in which business, with which role. Every tenant service takes this."""

    business_id: uuid.UUID
    user_id: uuid.UUID
    role: str


def cookie_options(request: Request) -> dict:
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": request.app.state.settings.cookie_secure,
        "path": "/",
    }


def set_session_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME, token, max_age=SESSION_ABSOLUTE_TTL_S, **cookie_options(request)
    )


def clear_session_cookie(request: Request, response: Response) -> None:
    opts = cookie_options(request)
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path=opts["path"],
        secure=opts["secure"],
        httponly=opts["httponly"],
        samesite=opts["samesite"],
    )


async def _resolve_session(db: AsyncSession, token: str) -> AuthState | None:
    """Valid = not revoked, now < expires_at, now < absolute_expires_at, user ACTIVE.
    Sliding: last_seen_at older than an hour moves expires_at to min(now + 30 d, absolute)."""
    if not AUTH_TOKEN_PATTERN.match(token):
        return None
    row = (
        await db.execute(
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.token_hash == sha256_hex(token))
        )
    ).first()
    if row is None:
        return None
    session, user = row
    now = datetime.now(UTC)
    if (
        session.revoked_at is not None
        or session.expires_at <= now
        or session.absolute_expires_at <= now
        or user.status != UserStatus.ACTIVE
    ):
        return None
    if (now - session.last_seen_at).total_seconds() > SESSION_TOUCH_INTERVAL_S:
        expires_at = min(now + timedelta(seconds=SESSION_IDLE_TTL_S), session.absolute_expires_at)
        # Conditional update: concurrent requests don't both write.
        await db.execute(
            update(Session)
            .where(Session.id == session.id, Session.last_seen_at == session.last_seen_at)
            .values(last_seen_at=now, expires_at=expires_at)
        )
        await db.commit()
        session.last_seen_at = now
        session.expires_at = expires_at
    return AuthState(user=user, session=session)


async def optional_auth(request: Request, db: Db) -> AuthState | None:
    """The signed-in user and session, or None. A presented but invalid cookie is cleared
    (by the request middleware, so it also happens when the request then fails with a 401)."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        return None
    auth = await _resolve_session(db, token)
    request.state.clear_session_cookie = auth is None
    return auth


async def require_auth(auth: Annotated[AuthState | None, Depends(optional_auth)]) -> AuthState:
    """401 UNAUTHENTICATED unless the request has a valid session."""
    if auth is None:
        raise AppError("UNAUTHENTICATED")
    return auth


Auth = Annotated[AuthState, Depends(require_auth)]


async def tenant_context(business_id: str, auth: Auth, db: Db) -> TenantContext:
    """Membership check for `/businesses/{business_id}/...`: anonymous → 401; not an ACTIVE
    member (or not a UUID) → 404, never 403, so other businesses' existence is not revealed."""
    if not _UUID.match(business_id):
        raise AppError("NOT_FOUND")
    bid = uuid.UUID(business_id)
    role = (
        await db.execute(
            select(MembershipRow.role).where(
                MembershipRow.business_id == bid,
                MembershipRow.user_id == auth.user.id,
                MembershipRow.status == MembershipStatus.ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if role is None:
        raise AppError("NOT_FOUND")
    return TenantContext(business_id=bid, user_id=auth.user.id, role=role.value)


Tenant = Annotated[TenantContext, Depends(tenant_context)]


def require_permission(permission: str):
    """Route-level guard: 403 when the caller's role lacks the permission."""

    async def guard(ctx: Tenant) -> TenantContext:
        if not can(ctx.role, permission):
            raise AppError("FORBIDDEN")
        return ctx

    return Depends(guard)


def tenant_router() -> APIRouter:
    """A router for tenant-scoped routes (membership is checked before anything else)."""
    return APIRouter(prefix=TENANT_PREFIX, dependencies=[Depends(tenant_context)])
