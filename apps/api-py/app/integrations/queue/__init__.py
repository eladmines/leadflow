"""The message bus between the API and the messaging worker (D-202).

Messages are small JSON objects that carry ids, never message bodies or phone numbers: the
payload stays in Postgres (`inbound_events`).

Two streams, `messaging.inbound` (webhook events, `{"eventId"}`) and `messaging.outbound`
(conversations with messages waiting to be sent, `{"numberId"}`). Each has the same RabbitMQ
topology (default exchange, durable queues, persistent messages):

    <stream>        work queue; a rejected message dead-letters to the DLQ
    <stream>.retry  no consumer; a message waits out its expiration, then dead-letters back to
                    <stream> (delayed retry without a plugin)
    <stream>.dlq    messages that failed every attempt, kept for inspection and replay

The consumer's handler decides what happens to each message (`Outcome`); the bus only carries that out.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from app.config import Settings

log = logging.getLogger("simplecatch")

INBOUND = "messaging.inbound"
OUTBOUND = "messaging.outbound"
STREAMS = (INBOUND, OUTBOUND)


def retry_queue(stream: str) -> str:
    return f"{stream}.retry"


def dead_letter_queue(stream: str) -> str:
    return f"{stream}.dlq"


RETRY = retry_queue(INBOUND)
DLQ = dead_letter_queue(INBOUND)


@dataclass(frozen=True)
class Outcome:
    kind: Literal["ack", "retry", "dead"]
    delay_s: float = 0.0


ACK = Outcome("ack")
DEAD = Outcome("dead")


def retry_in(delay_s: float) -> Outcome:
    return Outcome("retry", delay_s)


Handler = Callable[[dict[str, Any]], Awaitable[Outcome]]


class MessageBus(Protocol):
    async def publish(self, body: dict[str, Any], stream: str = INBOUND) -> None: ...
    async def consume(self, handler: Handler, stream: str = INBOUND, prefetch: int = 10) -> None:
        """Starts consuming in the background and returns."""
        ...

    async def close(self) -> None: ...


@dataclass
class MemoryMessageBus:
    """Tests and local use: lists per stream. `drain()` runs the handler on everything queued,
    retries without waiting, and keeps what the handler gave up on in `dead`."""

    queued: dict[str, list[dict[str, Any]]] = field(default_factory=lambda: {s: [] for s in STREAMS})
    published: dict[str, list[dict[str, Any]]] = field(default_factory=lambda: {s: [] for s in STREAMS})
    retries: list[tuple[dict[str, Any], float]] = field(default_factory=list)
    dead: list[dict[str, Any]] = field(default_factory=list)
    handlers: dict[str, Handler] = field(default_factory=dict)

    async def publish(self, body: dict[str, Any], stream: str = INBOUND) -> None:
        self.published[stream].append(body)
        self.queued[stream].append(body)

    async def consume(self, handler: Handler, stream: str = INBOUND, prefetch: int = 10) -> None:
        self.handlers[stream] = handler

    async def drain(self, handler: Handler | None = None, stream: str = INBOUND) -> None:
        run = handler or self.handlers.get(stream)
        assert run is not None, "no consumer"
        queue = self.queued[stream]
        while queue:
            body = queue.pop(0)
            outcome = await run(body)
            if outcome.kind == "retry":
                self.retries.append((body, outcome.delay_s))
                queue.append(body)
            elif outcome.kind == "dead":
                self.dead.append(body)

    async def close(self) -> None:
        pass


class RabbitMessageBus:
    def __init__(self, url: str) -> None:
        self.url = url
        self._connection: Any = None
        self._channel: Any = None

    async def _open(self) -> Any:
        if self._channel is None:
            import aio_pika  # only where RabbitMQ is used

            self._connection = await aio_pika.connect_robust(self.url)
            self._channel = await self._connection.channel()
            for stream in STREAMS:
                await self._channel.declare_queue(
                    stream,
                    durable=True,
                    arguments={
                        "x-dead-letter-exchange": "",
                        "x-dead-letter-routing-key": dead_letter_queue(stream),
                    },
                )
                await self._channel.declare_queue(
                    retry_queue(stream),
                    durable=True,
                    arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": stream},
                )
                await self._channel.declare_queue(dead_letter_queue(stream), durable=True)
        return self._channel

    async def _send(self, queue: str, body: dict[str, Any], expiration_s: float | None = None) -> None:
        import aio_pika

        channel = await self._open()
        message = aio_pika.Message(
            json.dumps(body).encode(),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            expiration=expiration_s,
        )
        await channel.default_exchange.publish(message, routing_key=queue)

    async def publish(self, body: dict[str, Any], stream: str = INBOUND) -> None:
        await self._send(stream, body)

    async def consume(self, handler: Handler, stream: str = INBOUND, prefetch: int = 10) -> None:
        channel = await self._open()
        await channel.set_qos(prefetch_count=prefetch)
        queue = await channel.get_queue(stream)

        async def on_message(message: Any) -> None:
            try:
                body = json.loads(message.body)
                outcome = await handler(body) if isinstance(body, dict) else DEAD
            except Exception as err:  # the handler catches its own; this is the last guard
                log.error("message handler crashed", extra={"errName": type(err).__name__})
                outcome = DEAD
            if outcome.kind == "retry":
                await self._send(retry_queue(stream), body, expiration_s=outcome.delay_s)
                await message.ack()
            elif outcome.kind == "dead":
                await message.reject(requeue=False)
            else:
                await message.ack()

        await queue.consume(on_message)

    async def close(self) -> None:
        if self._connection is not None:
            await self._connection.close()
        self._connection = self._channel = None


def create_message_bus(settings: Settings) -> MessageBus | None:
    """None when webhooks are processed inline (no broker)."""
    if settings.MESSAGE_BUS == "rabbitmq":
        return RabbitMessageBus(settings.RABBITMQ_URL)
    return None
