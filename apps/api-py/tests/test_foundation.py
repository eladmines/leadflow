"""Plumbing ported from the Node API: health, error shape, CSRF, session and tenant scope."""

import re
import uuid

from fastapi import APIRouter

from app.deps import Auth, Tenant, require_permission, tenant_router
from tests.conftest import HEADERS, cookie, make_business, make_user_session

UUID_RE = re.compile(r"^[\w-]{8,64}$")


def mount_probe_routes(app):
    r = tenant_router()

    @r.get("/probe")
    async def probe(ctx: Tenant):
        return {"role": ctx.role}

    @r.post("/owner-only", dependencies=[require_permission("business.update")])
    async def owner_only():
        return {"ok": True}

    me = APIRouter()

    @me.get("/api/v1/_probe/me")
    async def whoami(auth: Auth):
        return {"email": auth.user.email}

    app.include_router(r)
    app.include_router(me)


async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200 and res.json() == {"status": "ok"}
    assert UUID_RE.match(res.headers["x-request-id"])


async def test_health_db(client):
    assert (await client.get("/health/db")).json() == {"status": "ok"}


async def test_request_id_is_echoed_when_valid(client):
    res = await client.get("/health", headers={"x-request-id": "abcd-1234-efgh"})
    assert res.headers["x-request-id"] == "abcd-1234-efgh"


async def test_unknown_route_uses_the_shared_error_shape(client):
    res = await client.get("/nope")
    body = res.json()["error"]
    assert res.status_code == 404 and body["code"] == "NOT_FOUND" and body["requestId"]


async def test_csrf_blocks_state_changes_without_the_marker(client):
    res = await client.post("/anything", headers={"Origin": "http://localhost:5173"})
    assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"


async def test_csrf_blocks_a_foreign_origin(client):
    res = await client.post(
        "/anything", headers={"X-Requested-With": "SimpleCatch", "Origin": "https://evil.example"}
    )
    assert res.status_code == 403


async def test_csrf_lets_a_marked_request_through(client):
    res = await client.post("/anything", headers=HEADERS)
    assert res.status_code == 404  # past the guard, no such route


async def test_anonymous_is_401(app, client):
    mount_probe_routes(app)
    res = await client.get("/api/v1/_probe/me")
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_a_bad_cookie_is_401_and_cleared(app, client):
    mount_probe_routes(app)
    res = await client.get("/api/v1/_probe/me", headers=cookie("x" * 43))
    assert res.status_code == 401
    assert "lf_session" in res.headers.get("set-cookie", "")


async def test_valid_session_resolves_the_user(app, client, db):
    mount_probe_routes(app)
    user, token = await make_user_session(db, "me")
    res = await client.get("/api/v1/_probe/me", headers=cookie(token))
    assert res.status_code == 200 and res.json()["email"] == user.email


async def test_tenant_scope_404s_outsiders_and_non_uuids(app, client, db):
    mount_probe_routes(app)
    owner, _ = await make_user_session(db, "o")
    biz = await make_business(db, owner)
    _, outsider = await make_user_session(db, "x")
    url = f"/api/v1/businesses/{biz.id}/probe"
    assert (await client.get(url, headers=cookie(outsider))).status_code == 404
    assert (
        await client.get("/api/v1/businesses/not-a-uuid/probe", headers=cookie(outsider))
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/businesses/{uuid.uuid4()}/probe", headers=cookie(outsider))
    ).status_code == 404
    assert (await client.get(url)).status_code == 401


async def test_tenant_scope_and_permissions(app, client, db):
    mount_probe_routes(app)
    owner, owner_token = await make_user_session(db, "own")
    biz = await make_business(db, owner)
    emp, emp_token = await make_user_session(db, "emp")
    await make_business(db, emp)  # their own business, unrelated
    from datetime import UTC, datetime

    from app.db import models

    db.add(
        models.Membership(
            id=uuid.uuid4(),
            user_id=emp.id,
            business_id=biz.id,
            role=models.MembershipRole.EMPLOYEE,
            updated_at=datetime.now(UTC),
        )
    )
    await db.commit()

    base = f"/api/v1/businesses/{biz.id}"
    assert (await client.get(f"{base}/probe", headers=cookie(owner_token))).json() == {"role": "OWNER"}
    assert (await client.get(f"{base}/probe", headers=cookie(emp_token))).json() == {"role": "EMPLOYEE"}
    assert (
        await client.post(f"{base}/owner-only", headers={**HEADERS, **cookie(owner_token)})
    ).status_code == 200
    forbidden = await client.post(f"{base}/owner-only", headers={**HEADERS, **cookie(emp_token)})
    assert forbidden.status_code == 403 and forbidden.json()["error"]["code"] == "FORBIDDEN"


def test_production_config_fails_fast():
    import pytest as _pytest
    from pydantic import ValidationError

    from app.config import Settings

    base = {"DATABASE_URL": "postgresql://u:p@h/db", "NODE_ENV": "production", "_env_file": None}
    with _pytest.raises(ValidationError, match="APP_URL"):
        Settings(**base, FORM_TOKEN_SECRET="x" * 32)
    with _pytest.raises(ValidationError, match="FORM_TOKEN_SECRET"):
        Settings(**base, APP_URL="https://app.example.com")
    with _pytest.raises(ValidationError, match="COOKIE_SECURE"):
        Settings(**base, APP_URL="https://a.example.com", FORM_TOKEN_SECRET="x" * 32, COOKIE_SECURE=False)
    with _pytest.raises(ValidationError, match="memory"):
        Settings(
            **base, APP_URL="https://a.example.com", FORM_TOKEN_SECRET="x" * 32, EMAIL_TRANSPORT="memory"
        )
    ok = Settings(**base, RENDER_EXTERNAL_URL="https://leadflow.onrender.com", FORM_TOKEN_SECRET="x" * 32)
    # Render's address stands in for APP_URL, and its origin is the allowed web origin.
    assert ok.app_url == "https://leadflow.onrender.com"
    assert ok.allowed_origins == {"https://leadflow.onrender.com"}
    assert ok.cookie_secure is True


def test_web_origins_read_from_a_comma_separated_environment_value(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    monkeypatch.setenv("WEB_ORIGINS", "http://localhost:5173, https://app.example.com")
    assert Settings().WEB_ORIGINS == ["http://localhost:5173", "https://app.example.com"]
    monkeypatch.setenv("WEB_ORIGINS", "http://localhost:5173")
    assert Settings().allowed_origins == {"http://localhost:5173"}


def test_cloud_providers_without_an_environment_number_still_start():
    """Render sets WHATSAPP_PROVIDER / MESSENGER_PROVIDER to `cloud` with every number connected per
    business, so no environment number or token exists; the app must boot (it crashed once)."""
    from app.integrations.messenger import create_messenger_sender
    from app.integrations.whatsapp import create_whatsapp_sender
    from tests.conftest import make_settings

    s = make_settings(WHATSAPP_PROVIDER="cloud", MESSENGER_PROVIDER="cloud")
    assert create_whatsapp_sender(s) is not None
    assert create_messenger_sender(s) is not None
    from app.main import create_app

    app = create_app(s)
    assert app.state.whatsapp_sender is not None
