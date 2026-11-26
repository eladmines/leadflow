"""The scheduled background jobs, in one place (D-202).

They run in the messaging worker (`python -m app.workers.messaging`). The API runs them too
while `RUN_BACKGROUND_JOBS` is on, which is the default so a deployment without a worker keeps
working. Run them in one place only: set it off on the API wherever the worker runs.
"""

import asyncio
from typing import Any

from app.modules.domain.service import start_domain_watch, stop_task
from app.modules.tasks.reminders import start_task_reminders
from app.modules.whatsapp.gmail_sync import start_gmail_sync
from app.modules.whatsapp.nudges import start_booking_nudges

JOB_NAMES = ("task reminders", "domain watch", "gmail sync", "booking nudges")


def start_background_jobs(app: Any) -> "list[asyncio.Task[None]]":
    """Starts every job loop on `app.state` (sessionmaker, senders, settings); returns their tasks."""
    return [
        start_task_reminders(app),
        start_domain_watch(app),
        start_gmail_sync(app),
        start_booking_nudges(app),
    ]


async def stop_background_jobs(jobs: "list[asyncio.Task[None]]") -> None:
    for job in jobs:
        await stop_task(job)
