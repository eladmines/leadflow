from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(url: str) -> AsyncEngine:
    # `hide_parameters`: a logged SQLAlchemy error never prints bound values (custom lead field
    # values, phones, emails), only the statement (F34 privacy, rule 5).
    return create_async_engine(url, pool_pre_ping=True, hide_parameters=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def db_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, from the app's sessionmaker."""
    async with request.app.state.sessionmaker() as session:
        yield session
