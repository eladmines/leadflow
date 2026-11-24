"""Plumbing ported from the Node API: health, error shape, CSRF, session and tenant scope."""

import re
import uuid

from fastapi import APIRouter

from app.deps import Auth, Tenant, require_permission, tenant_router
from tests.conftest import HEADERS, cookies, make_business, make_user_session

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
    res = await client.get("/api/v1/_probe/me", cookies=cookies("x" * 43))
    assert res.status_code == 401
    assert "lf_session" in res.headers.get("set-cookie", "")


async def test_valid_session_resolves_the_user(app, client, db):
    mount_probe_routes(app)
    user, token = await make_user_session(db, "me")
    res = await client.get("/api/v1/_probe/me", cookies=cookies(token))
    assert res.status_code == 200 and res.json()["email"] == user.email


async def test_tenant_scope_404s_outsiders_and_non_uuids(app, client, db):
    mount_probe_routes(app)
    owner, _ = await make_user_session(db, "o")
    biz = await make_business(db, owner)
    _, outsider = await make_user_session(db, "x")
    url = f"/api/v1/businesses/{biz.id}/probe"
    assert (await client.get(url, cookies=cookies(outsider))).status_code == 404
    assert (
        await client.get("/api/v1/businesses/not-a-uuid/probe", cookies=cookies(outsider))
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/businesses/{uuid.uuid4()}/probe", cookies=cookies(outsider))
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
    assert (await client.get(f"{base}/probe", cookies=cookies(owner_token))).json() == {
        "role": "OWNER"
    }
    assert (await client.get(f"{base}/probe", cookies=cookies(emp_token))).json() == {
        "role": "EMPLOYEE"
    }
    assert (
        await client.post(f"{base}/owner-only", headers=HEADERS, cookies=cookies(owner_token))
    ).status_code == 200
    forbidden = await client.post(f"{base}/owner-only", headers=HEADERS, cookies=cookies(emp_token))
    assert forbidden.status_code == 403 and forbidden.json()["error"]["code"] == "FORBIDDEN"
