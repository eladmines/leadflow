import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter()
log = logging.getLogger("simplecatch")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/db")
async def health_db(request: Request):  # type: ignore[no-untyped-def]
    try:
        async with request.app.state.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        log.exception("database health check failed")
        return JSONResponse({"status": "unavailable"}, status_code=503)
