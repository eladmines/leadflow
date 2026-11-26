"""The message bus between the API and the messaging worker (D-202).

Messages are small JSON objects that carry ids, never message bodies or phone numbers: the
payload stays in Postgres (`inbound_events`).

RabbitMQ topology (default exchange, durable queues, persistent messages):

    messaging.inbound        work queue; a rejected message dead-letters to the DLQ
    messaging.inbound.retry  no consumer; a message waits out its expiration, then dead-letters
                             back to messaging.inbound (delayed retry without a plugin)
    messaging.inbound.dlq    messages that failed every attempt, kept for inspection and replay

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
RETRY = "messaging.inbound.retry"
DLQ = "messaging.inbound.dlq"


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
    async def publish(self, body: dict[str, Any]) -> None: ...
    async def consume(self, handler: Handler, prefetch: int = 10) -> None:
        """Starts consuming in the background and returns."""
        ...

    async def close(self) -> None: ...


@dataclass
class MemoryMessageBus:
    """Tests and local use: a list. `drain()` runs the handler on everything queued, retries
    without waiting, and keeps what the handler gave up on in `dead`."""

    queued: list[dict[str, Any]] = field(default_factory=list)
    published: list[dict[str, Any]] = field(default_factory=list)
    retries: list[tuple[dict[str, Any], float]] = field(default_factory=list)
    dead: list[dict[str, Any]] = field(default_factory=list)
    handler: Handler | None = None

    async def publish(self, body: dict[str, Any]) -> None:
        self.published.append(body)
        self.queued.append(body)

    async def consume(self, handler: Handler, prefetch: int = 10) -> None:
        self.handler = handler

    async def drain(self, handler: Handler | None = None) -> None:
        run = handler or self.handler
        assert run is not None, "no consumer"
        while self.queued:
            body = self.queued.pop(0)
            outcome = await run(body)
            if outcome.kind == "retry":
                self.retries.append((body, outcome.delay_s))
                self.queued.append(body)
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
            await self._channel.declare_queue(
                INBOUND,
                durable=True,
                arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": DLQ},
            )
            await self._channel.declare_queue(
                RETRY,
                durable=True,
                arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": INBOUND},
            )
            await self._channel.declare_queue(DLQ, durable=True)
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

    async def publish(self, body: dict[str, Any]) -> None:
        await self._send(INBOUND, body)

    async def consume(self, handler: Handler, prefetch: int = 10) -> None:
        channel = await self._open()
        await channel.set_qos(prefetch_count=prefetch)
        queue = await channel.get_queue(INBOUND)

        async def on_message(message: Any) -> None:
            try:
                body = json.loads(message.body)
                outcome = await handler(body) if isinstance(body, dict) else DEAD
            except Exception as err:  # the handler catches its own; this is the last guard
                log.error("message handler crashed", extra={"errName": type(err).__name__})
                outcome = DEAD
            if outcome.kind == "retry":
                await self._send(RETRY, body, expiration_s=outcome.delay_s)
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
