import os
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.constants import CSRF_HEADER_NAME, CSRF_HEADER_VALUE, SESSION_COOKIE_NAME
from app.core.crypto import sha256_hex
from app.db import models
from app.main import create_app

ORIGIN = "http://localhost:5173"
HEADERS = {CSRF_HEADER_NAME: CSRF_HEADER_VALUE, "Origin": ORIGIN}


def _test_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        # Reuse the Node API's .env so both stacks test against the same local database.
        for line in open("../api/.env"):
            if line.startswith("TEST_DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    assert url, "TEST_DATABASE_URL is not set"
    return url


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(DATABASE_URL=_test_url(), WEB_ORIGINS=[ORIGIN], NODE_ENV="test")


@pytest_asyncio.fixture
async def app(settings: Settings):
    app = create_app(settings)
    yield app
    await app.state.engine.dispose()


@pytest_asyncio.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
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


async def make_business(
    db: AsyncSession, owner: models.User, role: str = "OWNER"
) -> models.Business:
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


def cookies(token: str) -> dict[str, str]:
    return {SESSION_COOKIE_NAME: token}
