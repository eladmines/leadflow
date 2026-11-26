"""The messaging worker (D-202): a separate process that serves no HTTP.

Phase 0 runs the scheduled background jobs (`app.jobs`) here instead of in the API. Later phases
add the broker consumers for inbound and outbound messages (docs/MESSAGING_SERVICE.md).

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

log = logging.getLogger("simplecatch")


async def run(settings: Settings | None = None, stop: asyncio.Event | None = None) -> None:
    settings = (settings or get_settings()).model_copy(update={"RUN_BACKGROUND_JOBS": True})
    stop = stop or asyncio.Event()
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        log.info("messaging worker started", extra={"jobs": ", ".join(JOB_NAMES)})
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
