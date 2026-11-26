"""The messaging worker's health endpoint (D-202 phase 3): GET /health on WORKER_HEALTH_PORT.

Counts and ages only (no message content, ids or phone numbers):

- `database` / `broker`: reachable or not. Either one down → HTTP 503, so a platform restarts the
  worker. Everything else answers 200 with `"status": "degraded"` and the reason, because a
  restart would not fix a backlog or a dead-lettered message.
- `inbound`: events waiting to be processed, the oldest one's age, events that used up their
  attempts.
- `outbound`: messages queued to send, the oldest one's age, messages failed in the last 24 h.
- `queues`: RabbitMQ depths of the work, retry and dead-letter queues of both streams.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.db.models import InboundEvent, WhatsAppDirection, WhatsAppMessage
from app.integrations.queue import STREAMS, dead_letter_queue
from app.modules.inbound.service import MAX_ATTEMPTS as INBOUND_MAX_ATTEMPTS
from app.modules.outbound.service import QUEUED

log = logging.getLogger("simplecatch")

# Older than this and the worker is probably not keeping up (or not running).
STALE_S = 120


def _age_s(oldest: datetime | None, now: datetime) -> float | None:
    return round((now - oldest).total_seconds(), 1) if oldest else None


async def snapshot(state: Any, now: datetime | None = None) -> tuple[int, dict[str, Any]]:
    now = now or datetime.now(UTC)
    problems: list[str] = []
    body: dict[str, Any] = {"database": "ok", "broker": "off" if state.bus is None else "ok"}
    try:
        async with state.sessionmaker() as db:
            await db.execute(text("SELECT 1"))
            waiting, oldest_event = (
                await db.execute(
                    select(func.count(), func.min(InboundEvent.received_at)).where(
                        InboundEvent.processed_at.is_(None), InboundEvent.attempts < INBOUND_MAX_ATTEMPTS
                    )
                )
            ).one()
            gave_up = (
                await db.execute(
                    select(func.count()).where(
                        InboundEvent.processed_at.is_(None), InboundEvent.attempts >= INBOUND_MAX_ATTEMPTS
                    )
                )
            ).scalar_one()
            queued, oldest_queued = (
                await db.execute(
                    select(func.count(), func.min(WhatsAppMessage.created_at)).where(
                        WhatsAppMessage.status == QUEUED
                    )
                )
            ).one()
            failed_today = (
                await db.execute(
                    select(func.count()).where(
                        WhatsAppMessage.direction == WhatsAppDirection.OUT,
                        WhatsAppMessage.status == "failed",
                        WhatsAppMessage.created_at > now - timedelta(days=1),
                    )
                )
            ).scalar_one()
    except Exception as err:
        log.error("worker health: database unreachable", extra={"errName": type(err).__name__})
        return 503, {"status": "down", "database": "unreachable"}

    body["inbound"] = {
        "waiting": waiting,
        "oldestAgeSeconds": _age_s(oldest_event, now),
        "gaveUp": gave_up,
    }
    body["outbound"] = {
        "queued": queued,
        "oldestAgeSeconds": _age_s(oldest_queued, now),
        "failedLast24h": failed_today,
    }
    if (body["inbound"]["oldestAgeSeconds"] or 0) > STALE_S:
        problems.append("inbound backlog")
    if (body["outbound"]["oldestAgeSeconds"] or 0) > STALE_S:
        problems.append("outbound backlog")
    if gave_up:
        problems.append("inbound events gave up")

    if state.bus is not None:
        try:
            depths = await state.bus.depths()
        except Exception as err:
            log.error("worker health: broker unreachable", extra={"errName": type(err).__name__})
            body.update(status="down", broker="unreachable")
            return 503, body
        body["queues"] = depths
        if any(depths.get(dead_letter_queue(s), 0) for s in STREAMS):
            problems.append("dead-lettered messages")

    body["status"] = "degraded" if problems else "ok"
    if problems:
        body["problems"] = problems
    return 200, body


def health_app(state: Any) -> Starlette:
    async def health(_: Request) -> JSONResponse:
        status, body = await snapshot(state)
        return JSONResponse(body, status_code=status, headers={"cache-control": "no-store"})

    return Starlette(routes=[Route("/health", health)])
