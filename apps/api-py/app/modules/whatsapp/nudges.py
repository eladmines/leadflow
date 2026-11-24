"""Every minute: booking conversations that stopped in the middle get the business's showcase
(D-106). In-process like the task reminders."""

import asyncio
import logging
from typing import Any

from app.modules.whatsapp.service import build_service

log = logging.getLogger("simplecatch")


def start_booking_nudges(app: Any, interval_s: float = 60) -> "asyncio.Task[None]":
    async def loop() -> None:
        while True:
            await asyncio.sleep(interval_s)
            try:
                async with app.state.sessionmaker() as db:
                    await build_service(app.state, db).nudge_abandoned_bookings()
            except Exception as err:
                log.error("booking nudge run failed", extra={"errName": type(err).__name__})

    return asyncio.create_task(loop())
