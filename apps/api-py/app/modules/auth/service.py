"""Auth: register, login, sessions, email verification, password reset, account settings.

Port of apps/api/src/modules/auth/{service,repo}.ts. Users, sessions and auth tokens are
platform-level (not tenant-owned), so nothing here takes a TenantContext.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.constants import SESSION_ABSOLUTE_TTL_S, SESSION_IDLE_TTL_S
from app.core.crypto import sha256_hex
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    generate_token,
    hash_password,
    verify_password,
)
from app.core.timeutil import iso, now_ms
from app.db.models import AuthToken, AuthTokenType, Session, User, UserStatus
from app.deps import AuthState
from app.errors import AppError
from app.integrations.email import EmailSender
from app.integrations.email.templates import (
    Language,
    password_changed_template,
    password_reset_template,
    verify_email_template,
)
from app.modules.audit import add_audit, record_audit_safe
from app.modules.auth.schemas import ACCOUNT_MESSAGES, AUTH_MESSAGES, AuthUser, RegisterRequest

log = logging.getLogger("simplecatch")

EMAIL_VERIFY_TOKEN_TTL_S = 24 * 60 * 60
PASSWORD_RESET_TOKEN_TTL_S = 30 * 60
USER_AGENT_MAX = 512
IP_MAX = 45

WEB_PATHS = {
    "verifyEmail": "/verify-email",
    "resetPassword": "/reset-password",
    "forgotPassword": "/forgot-password",
}

# Background sends (password reset) are kept referenced until they finish.
_background: set[asyncio.Task] = set()


@dataclass
class RequestMeta:
    """Per-request context the service needs (never contains secrets)."""

    ip: str | None
    user_agent: str | None
    lang: Language = "he"


@dataclass
class SignedIn:
    user: User
    session_token: str


def to_auth_user(user: User) -> AuthUser:
    return AuthUser(
        id=str(user.id),
        email=user.email,
        fullName=user.full_name,
        emailVerified=user.email_verified_at is not None,
        createdAt=iso(user.created_at),
    )


def _invalid_token() -> AppError:
    return AppError("VALIDATION_ERROR", None, {"token": AUTH_MESSAGES["tokenInvalid"]})


def _invalid_credentials() -> AppError:
    return AppError("UNAUTHENTICATED", AUTH_MESSAGES["invalidCredentials"])


def _email_taken() -> AppError:
    return AppError("CONFLICT", None, {"email": AUTH_MESSAGES["emailTaken"]})


class AuthService:
    def __init__(self, db: AsyncSession, email: EmailSender, settings: Settings) -> None:
        self.db = db
        self.email = email
        self.settings = settings

    # -- helpers -------------------------------------------------------------

    async def _user_by_email(self, email: str) -> User | None:
        return (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    async def _revoke_session(self, session_id: uuid.UUID, now: datetime) -> None:
        await self.db.execute(
            update(Session)
            .where(Session.id == session_id, Session.revoked_at.is_(None))
            .values(revoked_at=now)
        )

    def _add_session(self, user_id: uuid.UUID, meta: RequestMeta, now: datetime) -> tuple[str, uuid.UUID]:
        token = generate_token()
        row = Session(
            id=uuid.uuid4(),
            user_id=user_id,
            token_hash=sha256_hex(token),
            expires_at=now + timedelta(seconds=SESSION_IDLE_TTL_S),
            absolute_expires_at=now + timedelta(seconds=SESSION_ABSOLUTE_TTL_S),
            last_seen_at=now,
            created_at=now,
            ip=meta.ip,
            user_agent=meta.user_agent,
        )
        self.db.add(row)
        return token, row.id

    def _add_auth_token(
        self, user_id: uuid.UUID, kind: AuthTokenType, token: str, ttl_s: int, now: datetime
    ) -> None:
        self.db.add(
            AuthToken(
                id=uuid.uuid4(),
                user_id=user_id,
                type=kind,
                token_hash=sha256_hex(token),
                expires_at=now + timedelta(seconds=ttl_s),
                created_at=now,
            )
        )

    async def _consume_token(self, token_id: uuid.UUID, now: datetime) -> bool:
        """Marks one token used only if still unused (single use under concurrency)."""
        res = await self.db.execute(
            update(AuthToken).where(AuthToken.id == token_id, AuthToken.used_at.is_(None)).values(used_at=now)
        )
        return res.rowcount == 1

    async def _mark_unused_used(self, user_id: uuid.UUID, kind: AuthTokenType, now: datetime) -> None:
        await self.db.execute(
            update(AuthToken)
            .where(
                AuthToken.user_id == user_id,
                AuthToken.type == kind,
                AuthToken.used_at.is_(None),
            )
            .values(used_at=now)
        )

    async def _find_token(self, token: str, kind: AuthTokenType, now: datetime) -> AuthToken:
        row = (
            await self.db.execute(
                select(AuthToken, User)
                .join(User, User.id == AuthToken.user_id)
                .where(AuthToken.token_hash == sha256_hex(token))
            )
        ).first()
        if row is None:
            raise _invalid_token()
        auth_token, user = row
        if (
            auth_token.type != kind
            or auth_token.used_at is not None
            or auth_token.expires_at <= now
            or user.status != UserStatus.ACTIVE
        ):
            raise _invalid_token()
        return auth_token

    def _web_link(self, path: str, token: str) -> str:
        from urllib.parse import quote

        return f"{self.settings.APP_URL}{path}?token={quote(token, safe='')}"

    # -- register / login / logout ------------------------------------------

    async def register(self, data: RegisterRequest, meta: RequestMeta, current: AuthState | None) -> SignedIn:
        if await self._user_by_email(data.email):
            raise _email_taken()

        password_hash = await hash_password(data.password)
        verify_token = generate_token()
        now = now_ms()
        user = User(
            id=uuid.uuid4(),
            email=data.email,
            password_hash=password_hash,
            full_name=data.fullName,
            created_at=now,
            updated_at=now,
        )
        try:
            if current:
                await self._revoke_session(current.session.id, now)
            self.db.add(user)
            await self.db.flush()
            session_token, _ = self._add_session(user.id, meta, now)
            self._add_auth_token(
                user.id, AuthTokenType.EMAIL_VERIFY, verify_token, EMAIL_VERIFY_TOKEN_TTL_S, now
            )
            add_audit(
                self.db,
                "auth.register",
                actor_user_id=user.id,
                entity_type="user",
                entity_id=user.id,
                metadata={"ip": meta.ip, "userAgent": meta.user_agent},
            )
            await self.db.commit()
        except IntegrityError as err:
            # A concurrent registration of the same email.
            await self.db.rollback()
            raise _email_taken() from err

        if self.settings.verification_on:
            await self._send_verification(user, verify_token, "register", meta)
        return SignedIn(user, session_token)

    async def login(
        self, email: str, password: str, meta: RequestMeta, current: AuthState | None
    ) -> SignedIn:
        user = await self._user_by_email(email)
        if user is None:
            # Same argon2 cost as a real check, so timing doesn't reveal unknown emails.
            await verify_password(DUMMY_PASSWORD_HASH, password)
            await self._login_failed(None, "unknown_email", meta)
            raise _invalid_credentials()
        if not await verify_password(user.password_hash, password):
            await self._login_failed(user.id, "bad_password", meta)
            raise _invalid_credentials()
        if user.status != UserStatus.ACTIVE:
            await self._login_failed(user.id, "blocked", meta)
            raise _invalid_credentials()

        now = now_ms()
        # No session fixation: a sign-in while signed in replaces the old session.
        if current:
            await self._revoke_session(current.session.id, now)
        token, session_id = self._add_session(user.id, meta, now)
        add_audit(
            self.db,
            "auth.login.succeeded",
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            metadata={"ip": meta.ip, "userAgent": meta.user_agent, "sessionId": str(session_id)},
        )
        await self.db.commit()
        return SignedIn(user, token)

    async def logout(self, current: AuthState | None, meta: RequestMeta) -> None:
        """Idempotent: with no valid session there is nothing to revoke."""
        if current is None:
            return
        await self._revoke_session(current.session.id, now_ms())
        await self.db.commit()
        await record_audit_safe(
            self.db,
            "auth.logout",
            actor_user_id=current.user.id,
            entity_type="session",
            entity_id=current.session.id,
            metadata={"ip": meta.ip},
        )

    async def _login_failed(self, user_id: uuid.UUID | None, reason: str, meta: RequestMeta) -> None:
        await record_audit_safe(
            self.db,
            "auth.login.failed",
            entity_type="user",
            entity_id=user_id,
            metadata={"ip": meta.ip, "userAgent": meta.user_agent, "reason": reason},
        )

    # -- email verification --------------------------------------------------

    async def verify_email(self, token: str, meta: RequestMeta) -> None:
        now = now_ms()
        row = await self._find_token(token, AuthTokenType.EMAIL_VERIFY, now)
        if not await self._consume_token(row.id, now):
            await self.db.rollback()
            raise _invalid_token()
        # Any outstanding verify link is now pointless.
        await self._mark_unused_used(row.user_id, AuthTokenType.EMAIL_VERIFY, now)
        await self.db.execute(
            update(User)
            .where(User.id == row.user_id, User.email_verified_at.is_(None))
            .values(email_verified_at=now)
        )
        await self.db.commit()
        await record_audit_safe(
            self.db,
            "auth.email.verified",
            entity_type="user",
            entity_id=row.user_id,
            metadata={"ip": meta.ip},
        )

    async def resend_verification(self, user: User, meta: RequestMeta) -> None:
        """Already verified, or verification off → no-op. Earlier unused links stay valid."""
        if user.email_verified_at is not None or not self.settings.verification_on:
            return
        token = generate_token()
        self._add_auth_token(user.id, AuthTokenType.EMAIL_VERIFY, token, EMAIL_VERIFY_TOKEN_TTL_S, now_ms())
        await self.db.commit()
        await self._send_verification(user, token, "resend", meta)

    async def _send_verification(self, user: User, token: str, trigger: str, meta: RequestMeta) -> None:
        """A send failure is logged (never the token) and doesn't fail the request."""
        message = verify_email_template(
            user.full_name, self._web_link(WEB_PATHS["verifyEmail"], token), meta.lang
        )
        try:
            await self.email.send(_message(user.email, message))
        except Exception as err:
            _log_send_failure("verify_email", err)
            return
        await record_audit_safe(
            self.db,
            "auth.email_verification.sent",
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            metadata={"trigger": trigger},
        )

    # -- password reset ------------------------------------------------------

    async def request_password_reset(self, email: str, meta: RequestMeta) -> None:
        """Always resolves (the route answers 204 either way). Only an existing ACTIVE user gets
        a new link, and only the newest link stays valid."""
        user = await self._user_by_email(email)
        if user is None or user.status != UserStatus.ACTIVE:
            return
        token = generate_token()
        now = now_ms()
        await self._mark_unused_used(user.id, AuthTokenType.PASSWORD_RESET, now)
        self._add_auth_token(user.id, AuthTokenType.PASSWORD_RESET, token, PASSWORD_RESET_TOKEN_TTL_S, now)
        await self.db.commit()
        await record_audit_safe(
            self.db,
            "auth.password_reset.requested",
            entity_type="user",
            entity_id=user.id,
            metadata={"ip": meta.ip},
        )
        message = password_reset_template(
            user.full_name, self._web_link(WEB_PATHS["resetPassword"], token), meta.lang
        )
        # Not awaited: response time must not depend on the mail server, so an existing and an
        # unknown email look the same to the caller.
        task = asyncio.create_task(self._send_quietly(_message(user.email, message), "password_reset"))
        _background.add(task)
        task.add_done_callback(_background.discard)

    async def _send_quietly(self, message, template: str) -> None:  # type: ignore[no-untyped-def]
        try:
            await self.email.send(message)
        except Exception as err:
            _log_send_failure(template, err)

    async def confirm_password_reset(self, token: str, new_password: str, meta: RequestMeta) -> None:
        now = now_ms()
        row = await self._find_token(token, AuthTokenType.PASSWORD_RESET, now)
        password_hash = await hash_password(new_password)
        if not await self._consume_token(row.id, now):
            await self.db.rollback()
            raise _invalid_token()
        await self._mark_unused_used(row.user_id, AuthTokenType.PASSWORD_RESET, now)
        await self.db.execute(
            update(User).where(User.id == row.user_id).values(password_hash=password_hash, updated_at=now)
        )
        # Using the link proves inbox ownership.
        await self.db.execute(
            update(User)
            .where(User.id == row.user_id, User.email_verified_at.is_(None))
            .values(email_verified_at=now)
        )
        revoked = await self.db.execute(
            update(Session)
            .where(Session.user_id == row.user_id, Session.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        add_audit(
            self.db,
            "auth.password_reset.completed",
            entity_type="user",
            entity_id=row.user_id,
            metadata={"ip": meta.ip, "revokedSessions": revoked.rowcount},
        )
        await self.db.commit()

    # -- account settings ----------------------------------------------------

    async def update_profile(self, auth: AuthState, full_name: str) -> User:
        if full_name == auth.user.full_name:
            return auth.user
        auth.user.full_name = full_name
        auth.user.updated_at = now_ms()
        add_audit(
            self.db,
            "auth.profile.updated",
            actor_user_id=auth.user.id,
            entity_type="user",
            entity_id=auth.user.id,
        )
        await self.db.commit()
        return auth.user

    async def change_password(
        self, auth: AuthState, current_password: str, new_password: str, meta: RequestMeta
    ) -> None:
        """Needs the current password. Other sessions are signed out (this one stays), and a
        notice goes to the account email in case it wasn't the owner."""
        if not await verify_password(auth.user.password_hash, current_password):
            msg = ACCOUNT_MESSAGES["currentPasswordWrong"]
            raise AppError("VALIDATION_ERROR", msg, {"currentPassword": msg})
        if current_password == new_password:
            msg = ACCOUNT_MESSAGES["samePassword"]
            raise AppError("VALIDATION_ERROR", msg, {"newPassword": msg})
        password_hash = await hash_password(new_password)
        now = now_ms()
        auth.user.password_hash = password_hash
        auth.user.updated_at = now
        revoked = await self.db.execute(
            update(Session)
            .where(
                Session.user_id == auth.user.id,
                Session.revoked_at.is_(None),
                Session.id != auth.session.id,
            )
            .values(revoked_at=now)
        )
        add_audit(
            self.db,
            "auth.password.changed",
            actor_user_id=auth.user.id,
            entity_type="user",
            entity_id=auth.user.id,
            metadata={"ip": meta.ip, "revokedSessions": revoked.rowcount},
        )
        await self.db.commit()
        message = password_changed_template(
            auth.user.full_name, f"{self.settings.APP_URL}{WEB_PATHS['forgotPassword']}", meta.lang
        )
        await self._send_quietly(_message(auth.user.email, message), "password_changed")


def _message(to: str, rendered):  # type: ignore[no-untyped-def]
    from app.integrations.email import EmailMessage

    return EmailMessage(to=to, subject=rendered.subject, html=rendered.html, text=rendered.text)


def _log_send_failure(template: str, err: Exception) -> None:
    """Logs only the error's name/code: provider errors could echo message contents."""
    log.error(
        "email send failed",
        extra={"template": template, "errName": type(err).__name__},
    )
