"""Auth, ported from apps/api/src/modules/auth/*.test.ts."""

import asyncio
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from app.core.crypto import sha256_hex
from app.core.security import generate_token
from app.core.timeutil import now_ms
from app.db import models
from app.errors import DEFAULT_MESSAGES
from app.modules.auth.schemas import AUTH_MESSAGES
from tests.conftest import (
    HEADERS,
    ORIGIN,
    PASSWORD,
    clears_session_cookie,
    get,
    last_email_token,
    make_settings,
    post,
    register_body,
    register_user,
    session_cookie_of,
    session_token_of,
)

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"
VERIFY = "/api/v1/auth/verify-email"
RESEND = "/api/v1/auth/resend-verification"
RESET_REQ = "/api/v1/auth/password-reset/request"
RESET_CONFIRM = "/api/v1/auth/password-reset/confirm"
PROFILE = "/api/v1/auth/profile"
PASSWORD_PATH = "/api/v1/auth/password"


async def session_row(db, token: str) -> models.Session:
    return (
        await db.execute(select(models.Session).where(models.Session.token_hash == sha256_hex(token)))
    ).scalar_one()


async def audit_actions(db) -> list[str]:
    rows = await db.execute(select(models.AuditLog.action))
    return sorted(r[0] for r in rows)


# --------------------------------------------------------------------------- register


async def test_register_201_sets_cookie_sends_verify_email_and_audits(client, db, email):
    res = await post(client, REGISTER, register_body())
    assert res.status_code == 201
    body = res.json()
    assert body == {
        "user": {
            "id": body["user"]["id"],
            "email": "dana@example.com",
            "fullName": "דנה כהן",
            "emailVerified": False,
            "createdAt": body["user"]["createdAt"],
        },
        "emailVerification": True,
    }
    assert re.match(r"^\d{4}-\d{2}-\d{2}T.*Z$", body["user"]["createdAt"])

    morsel, raw = session_cookie_of(res)
    assert re.match(r"^[A-Za-z0-9_-]{43}$", morsel.value)
    assert "httponly" in raw.lower() and "samesite=lax" in raw.lower() and "path=/" in raw.lower()
    assert morsel["max-age"] == str(90 * 24 * 3600)
    assert "secure" not in raw.lower().replace("samesite", "")

    # Only the hash is stored.
    session = await session_row(db, morsel.value)
    assert str(session.user_id) == body["user"]["id"] and session.ip
    user = (await db.execute(select(models.User))).scalar_one()
    assert user.password_hash.startswith("$argon2id$")
    assert user.status == models.UserStatus.ACTIVE and user.email_verified_at is None

    mails = email.to("dana@example.com")
    assert len(mails) == 1
    assert mails[0].subject == "אימות כתובת האימייל שלך ב-SimpleCatch"
    assert re.search(r"http://localhost:5173/verify-email\?token=[A-Za-z0-9_-]{43}", mails[0].text)

    assert await audit_actions(db) == ["auth.email_verification.sent", "auth.register"]
    reg = (
        await db.execute(select(models.AuditLog).where(models.AuditLog.action == "auth.register"))
    ).scalar_one()
    assert str(reg.actor_user_id) == body["user"]["id"] and reg.business_id is None
    assert sorted(reg.metadata_) == ["ip", "userAgent"]


async def test_register_sets_secure_when_configured(app):
    from httpx import ASGITransport, AsyncClient

    from app.integrations.email import MemoryEmailSender
    from app.main import create_app

    secure = create_app(make_settings(COOKIE_SECURE=True), email=MemoryEmailSender())
    async with AsyncClient(transport=ASGITransport(app=secure), base_url="http://test") as c:
        res = await post(c, REGISTER, register_body())
    assert res.status_code == 201
    assert (
        "secure" in session_cookie_of(res)[1].lower().split("samesite")[0] + session_cookie_of(res)[1].lower()
    )
    await secure.state.engine.dispose()


async def test_register_normalises_the_email(client):
    res = await post(client, REGISTER, register_body(email="  Dana@X.com "))
    assert res.status_code == 201 and res.json()["user"]["email"] == "dana@x.com"
    assert (await post(client, LOGIN, {"email": "dana@x.com", "password": PASSWORD})).status_code == 200
    dup = await post(client, REGISTER, register_body(email="DANA@x.com"))
    assert dup.status_code == 409
    assert dup.json()["error"]["fields"] == {"email": AUTH_MESSAGES["emailTaken"]}


async def test_duplicate_email_is_409_with_field_and_no_cookie(client):
    await register_user(client)
    res = await post(client, REGISTER, register_body())
    assert res.status_code == 409
    err = res.json()["error"]
    assert err["code"] == "CONFLICT" and err["message"] == DEFAULT_MESSAGES["CONFLICT"]
    assert err["fields"] == {"email": AUTH_MESSAGES["emailTaken"]} and err["requestId"]
    assert session_cookie_of(res) is None


async def test_concurrent_registrations_of_one_email(client, db):
    results = await asyncio.gather(*[post(client, REGISTER, register_body()) for _ in range(3)])
    assert sorted(r.status_code for r in results) == [201, 409, 409]
    assert (await db.execute(select(func.count()).select_from(models.User))).scalar_one() == 1


async def test_register_reports_all_missing_fields(client):
    res = await post(client, REGISTER, {})
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    assert err["fields"] == {
        "fullName": AUTH_MESSAGES["fullNameRequired"],
        "email": AUTH_MESSAGES["emailRequired"],
        "password": AUTH_MESSAGES["passwordRequired"],
        "acceptTerms": AUTH_MESSAGES["acceptTermsRequired"],
    }


async def test_register_validation_messages(client):
    res = await post(
        client,
        REGISTER,
        register_body(fullName="א", email="not-an-email", password="short", acceptTerms=False),
    )
    assert res.json()["error"]["fields"] == {
        "fullName": AUTH_MESSAGES["fullNameTooShort"],
        "email": AUTH_MESSAGES["emailInvalid"],
        "password": AUTH_MESSAGES["passwordTooShort"],
        "acceptTerms": AUTH_MESSAGES["acceptTermsRequired"],
    }


async def test_register_succeeds_when_the_verification_email_fails(client, email, db):
    email.fail_with = RuntimeError("smtp down")
    res = await post(client, REGISTER, register_body())
    assert res.status_code == 201 and session_token_of(res)
    assert await audit_actions(db) == ["auth.register"]


async def test_register_while_signed_in_revokes_the_previous_session(client, db):
    _, old, _ = await register_user(client)
    res = await post(client, REGISTER, register_body(email="second@example.com"), token=old)
    assert res.status_code == 201
    assert (await session_row(db, old)).revoked_at is not None
    assert (await get(client, ME, old)).status_code == 401


# --------------------------------------------------------------------------- login


async def test_login_200_sets_a_new_session_and_audits(client, db):
    await register_user(client)
    res = await post(client, LOGIN, {"email": "dana@example.com", "password": PASSWORD})
    assert res.status_code == 200 and res.json()["user"]["email"] == "dana@example.com"
    assert session_token_of(res)
    assert "auth.login.succeeded" in await audit_actions(db)


async def test_login_failures_are_identical(client, db):
    await register_user(client)
    blocked_email = "blocked@example.com"
    await register_user(client, email=blocked_email)
    await db.execute(update(models.User).where(models.User.email == blocked_email).values(status="BLOCKED"))
    await db.commit()

    bodies = []
    for creds in (
        {"email": "nobody@example.com", "password": PASSWORD},
        {"email": "dana@example.com", "password": "Wrong-password-1"},
        {"email": blocked_email, "password": PASSWORD},
    ):
        res = await post(client, LOGIN, creds)
        assert res.status_code == 401 and session_cookie_of(res) is None
        err = res.json()["error"]
        bodies.append((err["code"], err["message"]))
    assert len(set(bodies)) == 1 and bodies[0][1] == AUTH_MESSAGES["invalidCredentials"]

    reasons = sorted(
        r[0]["reason"]
        for r in await db.execute(
            select(models.AuditLog.metadata_).where(models.AuditLog.action == "auth.login.failed")
        )
    )
    assert reasons == ["bad_password", "blocked", "unknown_email"]


async def test_login_does_not_apply_the_new_password_minimum(client, db):
    await register_user(client)
    user = (await db.execute(select(models.User))).scalar_one()
    from app.core.security import hash_password

    user.password_hash = await hash_password("short")
    await db.commit()
    res = await post(client, LOGIN, {"email": "dana@example.com", "password": "short"})
    assert res.status_code == 200


async def test_login_400_for_missing_password_or_bad_email(client):
    res = await post(client, LOGIN, {"email": "nope", "password": ""})
    assert res.status_code == 400
    assert res.json()["error"]["fields"] == {
        "email": AUTH_MESSAGES["emailInvalid"],
        "password": AUTH_MESSAGES["passwordRequired"],
    }


async def test_login_while_signed_in_revokes_the_previous_session(client, db):
    _, old, _ = await register_user(client)
    res = await post(client, LOGIN, {"email": "dana@example.com", "password": PASSWORD}, token=old)
    assert (await session_row(db, old)).revoked_at is not None
    assert session_token_of(res) != old


# --------------------------------------------------------------------------- me and session validity


async def test_me_is_401_without_a_cookie_and_sets_none(client):
    res = await get(client, ME)
    assert res.status_code == 401 and session_cookie_of(res) is None


async def test_me_returns_the_user_without_internals(client):
    _, token, user = await register_user(client)
    res = await get(client, ME, token)
    assert res.status_code == 200
    assert res.json() == {"user": user, "emailVerification": True}
    assert "password" not in res.text and "hash" not in res.text.lower()


async def _expect_cleared_401(client, token):
    res = await get(client, ME, token)
    assert res.status_code == 401 and clears_session_cookie(res)


async def test_idle_expired_session_is_401_and_cleared(client, db):
    _, token, _ = await register_user(client)
    await db.execute(update(models.Session).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    await db.commit()
    await _expect_cleared_401(client, token)


async def test_absolute_expired_session_is_401_and_cleared(client, db):
    _, token, _ = await register_user(client)
    await db.execute(
        update(models.Session).values(absolute_expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await db.commit()
    await _expect_cleared_401(client, token)


async def test_revoked_session_is_401_and_cleared(client, db):
    _, token, _ = await register_user(client)
    await db.execute(update(models.Session).values(revoked_at=datetime.now(UTC)))
    await db.commit()
    await _expect_cleared_401(client, token)


async def test_tampered_or_unknown_token_is_401_and_cleared(client):
    _, token, _ = await register_user(client)
    await _expect_cleared_401(client, token[:-1] + ("A" if token[-1] != "A" else "B"))
    await _expect_cleared_401(client, generate_token())
    await _expect_cleared_401(client, "not-a-token")


async def test_blocked_user_session_is_401_and_cleared(client, db):
    _, token, _ = await register_user(client)
    await db.execute(update(models.User).values(status="BLOCKED"))
    await db.commit()
    await _expect_cleared_401(client, token)


async def test_sliding_session_moves_expiry_at_most_hourly_and_does_not_resend_the_cookie(client, db):
    _, token, _ = await register_user(client)
    row = await session_row(db, token)
    old_seen = datetime.now(UTC) - timedelta(hours=2)
    await db.execute(
        update(models.Session)
        .where(models.Session.id == row.id)
        .values(last_seen_at=old_seen, expires_at=datetime.now(UTC) + timedelta(days=1))
    )
    await db.commit()
    res = await get(client, ME, token)
    assert res.status_code == 200 and session_cookie_of(res) is None
    db.expire_all()
    after = await session_row(db, token)
    assert after.last_seen_at > old_seen and after.expires_at > datetime.now(UTC) + timedelta(days=29)

    # A second request within the hour doesn't write again.
    seen = after.last_seen_at
    await get(client, ME, token)
    db.expire_all()
    assert (await session_row(db, token)).last_seen_at == seen


async def test_sliding_never_passes_the_absolute_expiry(client, db):
    _, token, _ = await register_user(client)
    absolute = now_ms() + timedelta(days=2)
    await db.execute(
        update(models.Session).values(
            last_seen_at=datetime.now(UTC) - timedelta(hours=2), absolute_expires_at=absolute
        )
    )
    await db.commit()
    assert (await get(client, ME, token)).status_code == 200
    db.expire_all()
    assert (await session_row(db, token)).expires_at <= absolute


# --------------------------------------------------------------------------- logout


async def test_logout_204_revokes_clears_and_audits(client, db):
    _, token, _ = await register_user(client)
    res = await post(client, LOGOUT, token=token)
    assert res.status_code == 204 and clears_session_cookie(res)
    assert (await session_row(db, token)).revoked_at is not None
    assert "auth.logout" in await audit_actions(db)
    assert (await get(client, ME, token)).status_code == 401


async def test_logout_is_idempotent(client):
    assert (await post(client, LOGOUT)).status_code == 204
    assert (await post(client, LOGOUT, token=generate_token())).status_code == 204


async def test_logout_leaves_other_sessions_alive(client):
    _, first, _ = await register_user(client)
    login = await post(client, LOGIN, {"email": "dana@example.com", "password": PASSWORD})
    second = session_token_of(login)
    await post(client, LOGOUT, token=first)
    assert (await get(client, ME, first)).status_code == 401
    assert (await get(client, ME, second)).status_code == 200


# --------------------------------------------------------------------------- CSRF and rate limits


async def test_state_changes_without_the_csrf_marker_are_403_before_validation(client, db):
    res = await client.post(REGISTER, json=register_body(), headers={"Origin": ORIGIN})
    assert res.status_code == 403
    assert (await db.execute(select(func.count()).select_from(models.User))).scalar_one() == 0


async def test_logout_needs_the_marker_so_a_cross_site_form_cannot_sign_users_out(client):
    _, token, _ = await register_user(client)
    res = await client.post(LOGOUT, headers={"cookie": f"lf_session={token}"})
    assert res.status_code == 403
    assert (await get(client, ME, token)).status_code == 200


async def test_get_me_needs_neither_header_nor_origin(client):
    _, token, _ = await register_user(client)
    assert (await get(client, ME, token)).status_code == 200


async def test_cors_allows_the_listed_origin_with_credentials_only(client):
    ok = await client.get("/health", headers={"Origin": ORIGIN})
    assert ok.headers["access-control-allow-origin"] == ORIGIN
    assert ok.headers["access-control-allow-credentials"] == "true"
    foreign = await client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in foreign.headers


async def test_rate_limit_429_in_the_shared_shape_failures_count_and_routes_are_separate(client):
    for _ in range(10):
        res = await post(client, LOGIN, {"email": "nobody@example.com", "password": PASSWORD})
        assert res.status_code == 401
    limited = await post(client, LOGIN, {"email": "nobody@example.com", "password": PASSWORD})
    assert limited.status_code == 429
    err = limited.json()["error"]
    assert err["code"] == "RATE_LIMITED" and err["message"] == DEFAULT_MESSAGES["RATE_LIMITED"]
    # Another route has its own counter; /me and logout are not limited at all.
    assert (await post(client, REGISTER, register_body())).status_code == 201
    for _ in range(12):
        assert (await get(client, ME)).status_code == 401
        assert (await post(client, LOGOUT)).status_code == 204


# --------------------------------------------------------------------------- email verification


async def test_verify_email_204_marks_verified_consumes_and_audits(client, email, db):
    _, _, user = await register_user(client)
    token = last_email_token(email, "dana@example.com")
    res = await post(client, VERIFY, {"token": token})
    assert res.status_code == 204
    row = (await db.execute(select(models.User))).scalar_one()
    assert row.email_verified_at is not None
    assert "auth.email.verified" in await audit_actions(db)
    assert str(row.id) == user["id"]
    again = await post(client, VERIFY, {"token": token})
    assert again.status_code == 400
    assert again.json()["error"]["fields"] == {"token": AUTH_MESSAGES["tokenInvalid"]}


async def test_verify_email_rejects_expired_malformed_unknown_and_wrong_type_tokens(client, email, db):
    await register_user(client)
    token = last_email_token(email, "dana@example.com")
    await db.execute(update(models.AuthToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    await db.commit()
    for bad in (token, "short", generate_token()):
        res = await post(client, VERIFY, {"token": bad})
        assert res.status_code == 400
        assert res.json()["error"]["fields"] == {"token": AUTH_MESSAGES["tokenInvalid"]}
    assert (await post(client, VERIFY, {})).status_code == 400
    assert (await db.execute(select(models.User.email_verified_at))).scalar_one() is None

    # A password-reset token does not verify an email.
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await asyncio.sleep(0.05)
    reset_token = last_email_token(email, "dana@example.com")
    assert (await post(client, VERIFY, {"token": reset_token})).status_code == 400


async def test_verifying_consumes_the_other_outstanding_links(client, email):
    _, token, _ = await register_user(client)
    first = last_email_token(email, "dana@example.com")
    assert (await post(client, RESEND, token=token)).status_code == 204
    second = last_email_token(email, "dana@example.com")
    assert first != second
    assert (await post(client, VERIFY, {"token": first})).status_code == 204
    assert (await post(client, VERIFY, {"token": second})).status_code == 400


async def test_resend_verification(client, email, db):
    assert (await post(client, RESEND)).status_code == 401
    _, token, _ = await register_user(client)
    assert (await post(client, RESEND, token=token)).status_code == 204
    assert len(email.to("dana@example.com")) == 2
    sent = (
        await db.execute(
            select(models.AuditLog.metadata_).where(models.AuditLog.action == "auth.email_verification.sent")
        )
    ).all()
    assert sorted(r[0]["trigger"] for r in sent) == ["register", "resend"]
    await post(client, VERIFY, {"token": last_email_token(email, "dana@example.com")})
    assert (await post(client, RESEND, token=token)).status_code == 204
    assert len(email.to("dana@example.com")) == 2


# --------------------------------------------------------------------------- password reset


async def _wait_for_mail(email, to, count):
    for _ in range(100):
        if len(email.to(to)) >= count:
            return
        await asyncio.sleep(0.02)


async def test_reset_request_is_204_for_everyone_and_mails_only_active_users(client, email, db):
    await register_user(client)
    email.clear()
    res = await post(client, RESET_REQ, {"email": "  Dana@Example.com "})
    assert res.status_code == 204
    await _wait_for_mail(email, "dana@example.com", 1)
    assert len(email.to("dana@example.com")) == 1
    assert "auth.password_reset.requested" in await audit_actions(db)

    email.clear()
    assert (await post(client, RESET_REQ, {"email": "nobody@example.com"})).status_code == 204
    await asyncio.sleep(0.1)
    assert email.sent == []

    await db.execute(update(models.User).values(status="BLOCKED"))
    await db.commit()
    assert (await post(client, RESET_REQ, {"email": "dana@example.com"})).status_code == 204
    await asyncio.sleep(0.1)
    assert email.sent == []

    assert (await post(client, RESET_REQ, {"email": "not-an-email"})).status_code == 400


async def test_reset_request_is_204_even_when_the_email_fails(client, email):
    await register_user(client)
    email.fail_with = RuntimeError("smtp down")
    assert (await post(client, RESET_REQ, {"email": "dana@example.com"})).status_code == 204


async def test_only_the_newest_reset_link_works(client, email):
    await register_user(client)
    email.clear()
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await _wait_for_mail(email, "dana@example.com", 1)
    first = last_email_token(email, "dana@example.com")
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await _wait_for_mail(email, "dana@example.com", 2)
    second = last_email_token(email, "dana@example.com")
    new = "Brand-new-password-1"
    assert (await post(client, RESET_CONFIRM, {"token": first, "newPassword": new})).status_code == 400
    assert (await post(client, RESET_CONFIRM, {"token": second, "newPassword": new})).status_code == 204


async def test_reset_confirm_sets_the_password_revokes_sessions_and_verifies(client, email, db):
    _, session, _ = await register_user(client)
    email.clear()
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await _wait_for_mail(email, "dana@example.com", 1)
    token = last_email_token(email, "dana@example.com")
    new = "Brand-new-password-1"
    res = await post(client, RESET_CONFIRM, {"token": token, "newPassword": new}, token=session)
    assert res.status_code == 204 and clears_session_cookie(res)
    assert (await post(client, LOGIN, {"email": "dana@example.com", "password": PASSWORD})).status_code == 401
    assert (await post(client, LOGIN, {"email": "dana@example.com", "password": new})).status_code == 200
    assert (await get(client, ME, session)).status_code == 401
    assert (await db.execute(select(models.User.email_verified_at))).scalar_one() is not None
    assert "auth.password_reset.completed" in await audit_actions(db)
    assert (await post(client, RESET_CONFIRM, {"token": token, "newPassword": new})).status_code == 400


async def test_concurrent_reset_confirms_let_exactly_one_win(client, email):
    await register_user(client)
    email.clear()
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await _wait_for_mail(email, "dana@example.com", 1)
    token = last_email_token(email, "dana@example.com")
    results = await asyncio.gather(
        *[
            post(client, RESET_CONFIRM, {"token": token, "newPassword": f"Brand-new-password-{i}"})
            for i in range(3)
        ]
    )
    assert sorted(r.status_code for r in results) == [204, 400, 400]


async def test_reset_confirm_rejects_weak_passwords_without_consuming_the_token(client, email):
    await register_user(client)
    email.clear()
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await _wait_for_mail(email, "dana@example.com", 1)
    token = last_email_token(email, "dana@example.com")
    weak = await post(client, RESET_CONFIRM, {"token": token, "newPassword": "short"})
    assert weak.status_code == 400
    assert weak.json()["error"]["fields"] == {"newPassword": AUTH_MESSAGES["passwordTooShort"]}
    assert (
        await post(client, RESET_CONFIRM, {"token": token, "newPassword": "Long-enough-pass-1"})
    ).status_code == 204


async def test_reset_confirm_rejects_expired_and_malformed_tokens(client, email, db):
    await register_user(client)
    email.clear()
    await post(client, RESET_REQ, {"email": "dana@example.com"})
    await _wait_for_mail(email, "dana@example.com", 1)
    token = last_email_token(email, "dana@example.com")
    await db.execute(update(models.AuthToken).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    await db.commit()
    for bad in (token, "bad"):
        res = await post(client, RESET_CONFIRM, {"token": bad, "newPassword": "Long-enough-pass-1"})
        assert res.status_code == 400
        assert res.json()["error"]["fields"] == {"token": AUTH_MESSAGES["tokenInvalid"]}


# --------------------------------------------------------------------------- account settings


async def test_update_profile_validates_and_returns_the_user(client, db):
    _, token, _ = await register_user(client)
    assert (await client.patch(PROFILE, json={"fullName": "X"}, headers={**HEADERS})).status_code == 401
    bad = await client.patch(
        PROFILE, json={"fullName": "א"}, headers={**HEADERS, "cookie": f"lf_session={token}"}
    )
    assert bad.status_code == 400
    ok = await client.patch(
        PROFILE, json={"fullName": "  דנה לוי  "}, headers={**HEADERS, "cookie": f"lf_session={token}"}
    )
    assert ok.status_code == 200 and ok.json()["user"]["fullName"] == "דנה לוי"
    assert "auth.profile.updated" in await audit_actions(db)


async def test_change_password_signs_out_other_devices_keeps_this_one_and_sends_a_notice(client, email, db):
    _, mine, _ = await register_user(client)
    other = session_token_of(await post(client, LOGIN, {"email": "dana@example.com", "password": PASSWORD}))
    email.clear()
    new = "Another-strong-pass-1"

    wrong = await post(
        client, PASSWORD_PATH, {"currentPassword": "nope-nope-nope", "newPassword": new}, token=mine
    )
    assert wrong.status_code == 400 and "currentPassword" in wrong.json()["error"]["fields"]
    same = await post(
        client, PASSWORD_PATH, {"currentPassword": PASSWORD, "newPassword": PASSWORD}, token=mine
    )
    assert same.status_code == 400 and "newPassword" in same.json()["error"]["fields"]

    ok = await post(client, PASSWORD_PATH, {"currentPassword": PASSWORD, "newPassword": new}, token=mine)
    assert ok.status_code == 204
    assert (await get(client, ME, mine)).status_code == 200
    assert (await get(client, ME, other)).status_code == 401
    assert (await post(client, LOGIN, {"email": "dana@example.com", "password": new})).status_code == 200
    mails = email.to("dana@example.com")
    assert len(mails) == 1 and mails[0].subject == "הסיסמה שלך ב-SimpleCatch שונתה"
    assert "auth.password.changed" in await audit_actions(db)


async def test_account_emails_follow_the_app_language(client, email):
    res = await post(client, REGISTER, register_body(), headers={"X-SimpleCatch-Locale": "en"})
    assert res.status_code == 201
    assert email.to("dana@example.com")[0].subject == "Verify your email address for SimpleCatch"
