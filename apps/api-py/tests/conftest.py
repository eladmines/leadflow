import asyncio
import os
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from http.cookiejar import DefaultCookiePolicy

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import Settings
from app.core.constants import CSRF_HEADER_NAME, CSRF_HEADER_VALUE, SESSION_COOKIE_NAME
from app.core.crypto import sha256_hex
from app.db import models
from app.integrations.email import MemoryEmailSender
from app.integrations.storage import LocalDiskStorage
from app.main import create_app

ORIGIN = "http://localhost:5173"
HEADERS = {CSRF_HEADER_NAME: CSRF_HEADER_VALUE, "Origin": ORIGIN}


def _test_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        # The same local .env the server reads.
        with open(".env") as env:
            for line in env:
                if line.startswith("TEST_DATABASE_URL="):
                    url = line.split("=", 1)[1].strip()
    assert url, "TEST_DATABASE_URL is not set"
    return url


def make_settings(**overrides) -> Settings:
    base = {
        "DATABASE_URL": _test_url(),
        "WEB_ORIGINS": [ORIGIN],
        "NODE_ENV": "test",
        "APP_URL": ORIGIN,
        "EMAIL_TRANSPORT": "memory",
        "EMAIL_VERIFICATION": "on",
        "RUN_BACKGROUND_JOBS": False,
        "WORKER_HEALTH_PORT": 0,
        "SITE_STOCK_IMAGES": False,
        "DOMAIN_LOOKUP": "off",
        "LEAD_FORM_RATE_LIMIT_MAX": 1000,
    }
    # `_env_file=None`: a developer's local .env never leaks into the tests.
    return Settings(**{**base, **overrides}, _env_file=None)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest_asyncio.fixture(autouse=True)
async def clean_db(settings: Settings):
    """Every test starts from empty tables (same approach as the Node API's resetDb)."""
    engine = create_async_engine(settings.DATABASE_URL)
    # A fire-and-forget task of the previous test (a notification email, a count) may still hold
    # locks; if Postgres picks the truncate as the deadlock victim, run it again.
    for attempt in range(6):
        try:
            async with engine.begin() as conn:
                rows = await conn.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'alembic_version')"
                    )
                )
                tables = ", ".join(f'"public"."{r[0]}"' for r in rows)
                if tables:
                    await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
            break
        except DBAPIError as err:
            if "deadlock" not in str(err).lower() or attempt == 5:
                raise
            await asyncio.sleep(0.2 * (attempt + 1))
    await engine.dispose()


@pytest_asyncio.fixture
async def app(settings: Settings, tmp_path):
    app = create_app(settings, email=MemoryEmailSender(), storage=LocalDiskStorage(str(tmp_path / "media")))
    yield app
    await app.state.engine.dispose()


@pytest.fixture
def email(app) -> MemoryEmailSender:
    return app.state.email


@pytest_asyncio.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        # Tests send the session cookie explicitly; never let the client keep one between calls.
        c.cookies.jar.set_policy(DefaultCookiePolicy(allowed_domains=[]))
        yield c


@pytest_asyncio.fixture
async def db(app) -> AsyncIterator[AsyncSession]:
    async with app.state.sessionmaker() as session:
        yield session


@pytest.fixture
def unique() -> str:
    return secrets.token_hex(4)


async def make_user_session(db: AsyncSession, tag: str) -> tuple[models.User, str]:
    """A user with a live session; returns (user, raw cookie token)."""
    now = datetime.now(UTC)
    user = models.User(
        id=uuid.uuid4(),
        email=f"u-{tag}-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="x",
        full_name="Test User",
        updated_at=now,
    )
    db.add(user)
    await db.flush()
    token = secrets.token_urlsafe(32)
    db.add(
        models.Session(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=sha256_hex(token),
            expires_at=now + timedelta(days=30),
            absolute_expires_at=now + timedelta(days=90),
            last_seen_at=now,
        )
    )
    await db.commit()
    return user, token


async def make_business(db: AsyncSession, owner: models.User, role: str = "OWNER") -> models.Business:
    now = datetime.now(UTC)
    business = models.Business(id=uuid.uuid4(), name="Test Biz", industry="beauty", updated_at=now)
    db.add(business)
    await db.flush()
    db.add(
        models.Membership(
            id=uuid.uuid4(),
            user_id=owner.id,
            business_id=business.id,
            role=models.MembershipRole(role),
            updated_at=now,
        )
    )
    await db.commit()
    return business


def cookie(token: str) -> dict[str, str]:
    """Request headers carrying the session cookie."""
    return {"cookie": f"{SESSION_COOKIE_NAME}={token}"}


# -- HTTP helpers for the auth tests -----------------------------------------------------------

PASSWORD = "Sup3r-secret-pass!"


def register_body(**overrides):
    return {
        "fullName": "דנה כהן",
        "email": "dana@example.com",
        "password": PASSWORD,
        "acceptTerms": True,
        **overrides,
    }


async def post(client, url, body=None, token=None, headers=None):
    """POST with the CSRF marker, an optional JSON body and an optional session token."""
    h = {**HEADERS, **(cookie(token) if token else {}), **(headers or {})}
    return await client.post(url, headers=h, **({"json": body} if body is not None else {}))


async def get(client, url, token=None):
    return await client.get(url, headers=cookie(token) if token else {})


def session_cookie_of(res):
    """The parsed Set-Cookie for the session cookie, or None."""
    from http.cookies import SimpleCookie

    for raw in res.headers.get_list("set-cookie"):
        jar = SimpleCookie()
        jar.load(raw)
        if SESSION_COOKIE_NAME in jar:
            morsel = jar[SESSION_COOKIE_NAME]
            return morsel, raw
    return None


def session_token_of(res) -> str:
    found = session_cookie_of(res)
    assert found and found[0].value, f"no session cookie (status {res.status_code}): {res.text}"
    return found[0].value


def clears_session_cookie(res) -> bool:
    found = session_cookie_of(res)
    return bool(found) and found[0].value == "" and found[0]["max-age"] == "0"


async def register_user(client, **overrides):
    res = await post(client, "/api/v1/auth/register", register_body(**overrides))
    assert res.status_code == 201, res.text
    return res, session_token_of(res), res.json()["user"]


def last_email_token(email: MemoryEmailSender, to: str) -> str:
    import re

    msgs = email.to(to)
    assert msgs, f"no email sent to {to}"
    m = re.search(r"[?&]token=([A-Za-z0-9_-]{43})", msgs[-1].text)
    assert m, "no token link in email"
    return m.group(1)


# -- business helpers --------------------------------------------------------------------------

_seq = 0

BUSINESSES = "/api/v1/businesses"


def business_url(business_id, tail: str = "") -> str:
    return f"{BUSINESSES}/{business_id}{tail}"


async def req(client, method: str, url: str, token: str | None = None, body=None):
    """JSON request with the CSRF marker and an optional session cookie."""
    h = {**HEADERS, **(cookie(token) if token else {})}
    return await client.request(method, url, headers=h, **({"json": body} if body is not None else {}))


async def new_user(client, label: str = "user"):
    """Registers a fresh user (unique email); returns (token, user_id)."""
    global _seq
    _seq += 1
    _, token, user = await register_user(client, email=f"{label}-{_seq}-{uuid.uuid4().hex[:6]}@example.com")
    return token, user["id"]


DEFAULT_BUSINESS = {"name": "מספרת שירן", "industry": "beauty"}


async def create_business(client, token: str, body=None) -> dict:
    res = await req(client, "POST", BUSINESSES, token, body or DEFAULT_BUSINESS)
    assert res.status_code == 201, res.text
    return res.json()["business"]


async def owner_with_business(client, label: str = "owner") -> dict:
    token, user_id = await new_user(client, label)
    return {"token": token, "user_id": user_id, "business": await create_business(client, token)}


async def add_member(db: AsyncSession, business_id: str, user_id: str, role: str) -> None:
    now = datetime.now(UTC)
    db.add(
        models.Membership(
            id=uuid.uuid4(),
            user_id=uuid.UUID(user_id),
            business_id=uuid.UUID(business_id),
            role=models.MembershipRole(role),
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()


async def make_lead(
    db: AsyncSession,
    business_id: str,
    owner_id: str | None = None,
    name: str = "רון לוי",
    phone: str = "+972521112233",
) -> dict:
    """A lead seeded straight into the database (the leads module is not ported yet)."""
    now = datetime.now(UTC)
    bid = uuid.UUID(business_id)
    stage = (
        (await db.execute(select(models.PipelineStage).where(models.PipelineStage.business_id == bid)))
        .scalars()
        .first()
    )
    if stage is None:
        stage = models.PipelineStage(
            id=uuid.uuid4(),
            business_id=bid,
            name="חדש",
            position=0,
            kind=models.StageKind.OPEN,
            created_at=now,
        )
        db.add(stage)
        await db.flush()
    contact = models.Contact(
        id=uuid.uuid4(), business_id=bid, name=name, phone=phone, created_at=now, updated_at=now
    )
    db.add(contact)
    await db.flush()
    lead = models.Lead(
        id=uuid.uuid4(),
        business_id=bid,
        contact_id=contact.id,
        stage_id=stage.id,
        source=models.LeadSource.MANUAL,
        owner_id=uuid.UUID(owner_id) if owner_id else None,
        created_at=now,
        updated_at=now,
    )
    db.add(lead)
    await db.commit()
    return {"id": str(lead.id), "name": name}


async def make_quote(
    db: AsyncSession,
    business_id: str,
    lead_id: str,
    status: str,
    total: int,
    *,
    number: int | None = None,
    sent_at: datetime | None = None,
    valid_until=None,
    created_at: datetime | None = None,
    no_sent_at: bool = False,
) -> models.Quote:
    """A quote seeded straight into the database: one line of `total` agorot, no VAT. SENT and
    decided quotes get `sent_at` = now unless given (`no_sent_at` for an old row without it)."""
    now = datetime.now(UTC)
    bid = uuid.UUID(business_id)
    if number is None:
        last = (
            await db.execute(select(func.max(models.Quote.number)).where(models.Quote.business_id == bid))
        ).scalar_one()
        number = (last or 1000) + 1
    if sent_at is None and status != "DRAFT" and not no_sent_at:
        sent_at = now
    q = models.Quote(
        id=uuid.uuid4(),
        business_id=bid,
        lead_id=uuid.UUID(lead_id),
        number=number,
        title="",
        items=[{"description": "שירות", "quantity": 1, "unitPrice": total}],
        discount=0,
        vat_rate=0,
        notes="",
        status=models.QuoteStatus(status),
        valid_until=valid_until,
        sent_at=sent_at,
        decided_at=now if status in ("ACCEPTED", "REJECTED") else None,
        created_at=created_at or now,
        updated_at=now,
    )
    db.add(q)
    await db.commit()
    return q


async def make_task(
    db: AsyncSession,
    business_id: str,
    lead_id: str | None,
    assignee_id: str,
    title: str,
    due_at: datetime,
    *,
    status: str = "OPEN",
    created_at: datetime | None = None,
) -> models.Task:
    """A task seeded straight into the database."""
    now = datetime.now(UTC)
    task = models.Task(
        id=uuid.uuid4(),
        business_id=uuid.UUID(business_id),
        title=title,
        due_at=due_at,
        status=models.TaskStatus(status),
        assignee_id=uuid.UUID(assignee_id),
        lead_id=uuid.UUID(lead_id) if lead_id else None,
        remind=False,
        completed_at=now if status == "DONE" else None,
        created_at=created_at or now,
        updated_at=now,
    )
    db.add(task)
    await db.commit()
    return task


# -- public site server ------------------------------------------------------------------------

LEAD_FORM_PATH = "/__lead"


def site_host(settings: Settings, sub: str) -> str:
    return f"{sub}.{settings.PUBLIC_SITE_HOST}"


@pytest_asyncio.fixture
async def public(app) -> AsyncIterator[AsyncClient]:
    """The public site server, sharing the API's database, cache, email and storage."""
    from app.public.app import create_public_app

    st = app.state
    papp = create_public_app(st.settings, st.sessionmaker, st.email, st.site_cache, st.storage)
    async with AsyncClient(transport=ASGITransport(app=papp), base_url="http://pub") as c:
        c.cookies.jar.set_policy(DefaultCookiePolicy(allowed_domains=[]))
        yield c


async def wait_for(predicate, timeout: float = 2.0) -> None:
    import asyncio

    for _ in range(int(timeout / 0.02)):
        if predicate():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("condition not met in time")
