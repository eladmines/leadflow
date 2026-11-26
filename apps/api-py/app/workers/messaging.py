"""The messaging worker (D-202): a separate process that serves no HTTP.

It runs the scheduled background jobs (`app.jobs`, phase 0) and, with `MESSAGE_BUS=rabbitmq`,
consumes the inbound webhook events the API stored (phase 1, `app.modules.inbound`).
See docs/MESSAGING_SERVICE.md.

    uv run python -m app.workers.messaging

It builds the same application state as the API (`create_app`: database pool, email, WhatsApp
and Messenger senders, …) and enters its lifespan with the jobs switched on, so jobs see exactly
what they saw inside the API. Stops cleanly on SIGINT/SIGTERM.
"""

import asyncio
import logging
import signal

from app.config import Settings, get_settings
from app.jobs import JOB_NAMES
from app.main import create_app
from app.modules.inbound.service import handle

log = logging.getLogger("simplecatch")


async def run(settings: Settings | None = None, stop: asyncio.Event | None = None) -> None:
    settings = (settings or get_settings()).model_copy(update={"RUN_BACKGROUND_JOBS": True})
    stop = stop or asyncio.Event()
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        if app.state.bus is not None:
            await app.state.bus.consume(lambda body: handle(app.state, body))
        log.info(
            "messaging worker started",
            extra={"jobs": ", ".join(JOB_NAMES), "consuming": app.state.bus is not None},
        )
        await stop.wait()
    log.info("messaging worker stopped")


async def main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await run(stop=stop)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
