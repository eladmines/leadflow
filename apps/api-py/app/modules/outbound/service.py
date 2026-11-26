"""Queued outgoing messages (D-202 phase 2).

Every reply, whether a team member's or the booking bot's, is first stored as a `queued`
`whatsapp_messages` row that says what to send (`send_payload`). Then the conversation's number is
dispatched:

- `MESSAGE_BUS=inline`: flushed at once, inside the request (as before, but recorded).
- `rabbitmq`: `{"numberId"}` is published on `messaging.outbound` and the worker flushes it.

A flush sends one conversation's queued messages oldest first, under a per-number advisory lock,
so the bot's text → list → photo always arrive in order. A message that fails for a passing
reason (network, rate limit, Meta 5xx) stops the flush and is retried with backoff, holding the
ones after it back. A permanent failure (Meta refused it, channel disconnected) or the last attempt
marks it `failed` and the flush goes on. The worker also sweeps for numbers whose dispatch was
lost (`republish_stale`).

Email and Gmail replies are sent directly, as before (they have their own delivery).
"""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from opentelemetry import trace as trace_api
from opentelemetry.trace import SpanKind
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import now_ms
from app.core.tracing import carrier_of, context_of, tracer
from app.db.models import WhatsAppDirection, WhatsAppMessage, WhatsAppNumber
from app.integrations.queue import ACK, DEAD, OUTBOUND, Outcome, retry_in
from app.integrations.whatsapp import WhatsAppChoice, WhatsAppSendError

log = logging.getLogger("simplecatch")

QUEUED = "queued"
MAX_ATTEMPTS = 5
BUSY_RETRY_S = 1.0
STALE_AFTER = timedelta(seconds=30)

Result = Literal["sent", "retry", "failed"]
Dispatch = Callable[[uuid.UUID], Awaitable[None]]  # sends a number's queued messages (or hands them on)


def choices_payload(choices: list[WhatsAppChoice]) -> list[dict[str, Any]]:
    return [{"id": c.id, "title": c.title, "description": c.description} for c in choices]


def _choices(rows: list[dict[str, Any]]) -> list[WhatsAppChoice]:
    return [WhatsAppChoice(r["id"], r["title"], r.get("description")) for r in rows]


def queue_message(
    db: AsyncSession,
    *,
    business_id: uuid.UUID,
    number_id: uuid.UUID,
    contact_id: uuid.UUID | None,
    lead_id: uuid.UUID | None,
    body: str,
    payload: dict[str, Any],
    sender_id: uuid.UUID | None = None,
) -> WhatsAppMessage:
    """Adds the queued row (the caller commits, then dispatches the number).

    Payloads: {"kind": "text", "text", "preview"?} · {"kind": "buttons", "body", "buttons"} ·
    {"kind": "list", "body", "button", "rows"} · {"kind": "image" | "video", "key"} (a storage key;
    images are converted to WhatsApp's JPEG when sent)."""
    row_id = uuid.uuid4()
    row = WhatsAppMessage(
        id=row_id,
        business_id=business_id,
        number_id=number_id,
        contact_id=contact_id,
        lead_id=lead_id,
        direction=WhatsAppDirection.OUT,
        wa_message_id=f"q:{row_id}",  # replaced by the provider's id once sent
        body=body[:4096],
        status=QUEUED,
        sender_id=sender_id,
        send_payload=payload,
        send_seq=func.nextval("whatsapp_messages_send_seq"),
        created_at=now_ms(),
    )
    db.add(row)
    return row


async def dispatch(state: Any, number_id: uuid.UUID) -> None:
    """After the queued rows are committed: send now (inline) or hand them to the worker."""
    with tracer.start_as_current_span(
        "dispatch outbound",
        kind=SpanKind.PRODUCER,
        attributes={
            "outbound.number_id": str(number_id),
            "messaging.bus": "inline" if state.bus is None else "rabbitmq",
        },
    ):
        if state.bus is None:
            await flush_number(state, number_id, retries=False)
            return
        try:
            await state.bus.publish({"numberId": str(number_id), "trace": carrier_of()}, OUTBOUND)
        except Exception as err:  # the rows are saved; the worker's sweep picks them up
            log.error("outbound publish failed", extra={"errName": type(err).__name__})


def _lock_key(number_id: uuid.UUID) -> int:
    return int.from_bytes(number_id.bytes[:8], "big", signed=True)


async def flush_number(state: Any, number_id: uuid.UUID, retries: bool = True) -> Outcome:
    """Sends the number's queued messages in order. Without `retries` (inline, no worker to come
    back later) a passing failure is final too."""
    async with state.sessionmaker() as lock_db:
        got = (
            await lock_db.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": _lock_key(number_id)})
        ).scalar_one()
        if not got:  # another flush of this conversation is running; come back after it
            return retry_in(BUSY_RETRY_S)
        while True:
            async with state.sessionmaker() as db:
                message = (
                    await db.execute(
                        select(WhatsAppMessage)
                        .where(WhatsAppMessage.number_id == number_id, WhatsAppMessage.status == QUEUED)
                        .order_by(WhatsAppMessage.send_seq)
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if message is None:
                    break
                result = await _send_one(state, db, message, retries)
                if result == "retry":
                    await lock_db.commit()
                    return retry_in(backoff_s(message.send_attempts))
        await lock_db.commit()
        return ACK


def backoff_s(attempts: int) -> float:
    return float(min(2**attempts, 60))


def _permanent(err: Exception) -> bool:
    """Meta refused the message itself (4xx other than rate limiting): trying again won't help."""
    status = getattr(err, "status", None)
    return isinstance(err, WhatsAppSendError | ValueError) and (
        not isinstance(status, int) or (400 <= status < 500 and status != 429)
    )


async def _sender_for(state: Any, db: AsyncSession, number: WhatsAppNumber) -> Any:
    from app.modules.whatsapp.service import build_service  # avoids an import cycle

    channels = build_service(state, db).channels
    channel = number.channel or "whatsapp"
    lookup = (
        channels.instagram
        if channel == "instagram"
        else channels.messenger
        if channel == "messenger"
        else channels.whatsapp
    )
    return await lookup(number.business_id)


async def _send(state: Any, via: Any, number: WhatsAppNumber, payload: dict[str, Any]) -> dict[str, str]:
    from app.modules.whatsapp import auto_reply as ar
    from app.modules.whatsapp.service import is_social, psid_of

    social = is_social(number.channel)
    to = psid_of(number.phone) if social else number.phone
    kind = payload.get("kind")
    if kind == "text":
        if social:
            return await via.send_text(to, payload["text"])
        return await via.send_text(to, payload["text"], bool(payload.get("preview")))
    if kind == "buttons":
        return await via.send_buttons(to, payload["body"], _choices(payload["buttons"]))
    if kind == "list":
        return await via.send_list(to, payload["body"], payload["button"], _choices(payload["rows"]))
    if kind in ("image", "video"):
        data = await state.storage.get(payload["key"])
        if not data:
            raise ValueError("media is gone")
        if kind == "image":
            return await via.send_image(to, ar.to_whatsapp_jpeg(data))
        return await via.send_video(to, data)
    raise ValueError("unknown payload")


async def _send_one(state: Any, db: AsyncSession, message: WhatsAppMessage, retries: bool) -> Result:
    with tracer.start_as_current_span(
        "send message",
        attributes={
            "outbound.message_id": str(message.id),
            "outbound.kind": str((message.send_payload or {}).get("kind")),
            "outbound.attempt": message.send_attempts + 1,
        },
    ) as span:
        result = await _send_one_traced(state, db, message, retries)
        span.set_attribute("outbound.result", result)
        if result != "sent":
            span.set_status(trace_api.StatusCode.ERROR)
        return result


async def _send_one_traced(state: Any, db: AsyncSession, message: WhatsAppMessage, retries: bool) -> Result:
    number = await db.get(WhatsAppNumber, message.number_id)
    if number is not None:
        trace_api.get_current_span().set_attribute("messaging.channel", number.channel or "whatsapp")
    payload = message.send_payload or {}
    try:
        via = await _sender_for(state, db, number) if number else None
        if via is None:
            raise ValueError("channel not connected")
        sent = await _send(state, via, number, payload)
    except Exception as err:
        message.send_attempts += 1
        final = _permanent(err) or not retries or message.send_attempts >= MAX_ATTEMPTS
        log.error(
            "outbound send failed",
            extra={
                "messageId": str(message.id),
                "attempts": message.send_attempts,
                "final": final,
                "errName": type(err).__name__,
                "status": getattr(err, "status", None),
                "code": getattr(err, "code", None),
            },
        )
        if final:
            message.status, message.send_payload = "failed", None
        await db.commit()
        return "failed" if final else "retry"
    # Messenger's echo of this very message can land first and be stored without a sender; ours
    # (with the team member and the original time) is the one to keep.
    await db.execute(
        delete(WhatsAppMessage).where(
            WhatsAppMessage.wa_message_id == sent["id"], WhatsAppMessage.id != message.id
        )
    )
    message.wa_message_id = sent["id"]
    message.status, message.send_payload = "sent", None
    await db.commit()
    return "sent"


async def handle(state: Any, body: dict[str, Any]) -> Outcome:
    """The worker's consumer for `messaging.outbound`."""
    try:
        number_id = uuid.UUID(str(body.get("numberId")))
    except ValueError:
        return DEAD
    with tracer.start_as_current_span(
        "send queued messages",
        context=context_of(body.get("trace")),
        kind=SpanKind.CONSUMER,
        attributes={"outbound.number_id": str(number_id)},
    ) as span:
        outcome = await flush_number(state, number_id)
        span.set_attribute("outbound.outcome", outcome.kind)
        return outcome


async def republish_stale(state: Any, now: datetime | None = None) -> int:
    """Numbers with a message queued for a while (a lost dispatch, or a worker that stopped):
    published again. Returns how many."""
    cutoff = (now or datetime.now(UTC)) - STALE_AFTER
    async with state.sessionmaker() as db:
        ids = (
            (
                await db.execute(
                    select(WhatsAppMessage.number_id)
                    .where(WhatsAppMessage.status == QUEUED)
                    .group_by(WhatsAppMessage.number_id)
                    .having(func.min(WhatsAppMessage.created_at) < cutoff)
                )
            )
            .scalars()
            .all()
        )
    for number_id in ids:
        await state.bus.publish({"numberId": str(number_id), "trace": carrier_of()}, OUTBOUND)
    return len(ids)


def start_outbound_sweep(app: Any, interval_s: float = 60) -> "asyncio.Task[None]":
    async def loop() -> None:
        while True:
            await asyncio.sleep(interval_s)
            try:
                await republish_stale(app.state)
            except Exception as err:
                log.error("outbound sweep failed", extra={"errName": type(err).__name__})

    return asyncio.create_task(loop())
