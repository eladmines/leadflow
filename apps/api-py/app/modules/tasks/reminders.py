"""Checks for due task reminders every minute (in-process; safe with several instances)."""

import asyncio
import contextlib
import logging

from fastapi import FastAPI

from app.modules.tasks.service import TaskService

log = logging.getLogger("simplecatch")


def start_task_reminders(app: FastAPI, interval_s: float = 60) -> "asyncio.Task[None]":
    """Starts the loop and returns its task; cancel it to stop."""

    async def loop() -> None:
        running = False
        while True:
            await asyncio.sleep(interval_s)
            if running:
                continue
            running = True
            try:
                async with app.state.sessionmaker() as db:
                    await TaskService(db).send_due_reminders(app.state.email, app.state.settings)
            except Exception:
                log.exception("task reminder run failed")
            finally:
                running = False

    return asyncio.create_task(loop())


async def stop(task: "asyncio.Task[None]") -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
