"""D-202 phase 0: the scheduled jobs run in the messaging worker; the API runs them only when asked."""

import asyncio

import pytest

import app.main as main_module
from app.main import create_app
from app.workers import messaging
from tests.conftest import make_settings


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    """Replaces the job loops with a recorder, so no real job runs during the test."""
    calls = {"started": 0, "stopped": 0}

    def start(_app: object) -> list[object]:
        calls["started"] += 1
        return ["job"]

    async def stop(jobs: list[object]) -> None:
        if jobs:
            calls["stopped"] += 1

    monkeypatch.setattr(main_module, "start_background_jobs", start)
    monkeypatch.setattr(main_module, "stop_background_jobs", stop)
    return calls


async def test_worker_starts_the_jobs_even_when_settings_turn_them_off(recorded: dict[str, int]) -> None:
    stop = asyncio.Event()
    worker = asyncio.create_task(messaging.run(make_settings(RUN_BACKGROUND_JOBS=False), stop))
    for _ in range(50):
        if recorded["started"]:
            break
        await asyncio.sleep(0.01)
    assert recorded == {"started": 1, "stopped": 0}

    stop.set()
    await asyncio.wait_for(worker, timeout=5)
    assert recorded == {"started": 1, "stopped": 1}


async def test_api_does_not_start_jobs_when_switched_off(recorded: dict[str, int]) -> None:
    app = create_app(make_settings(RUN_BACKGROUND_JOBS=False))
    async with app.router.lifespan_context(app):
        pass
    assert recorded == {"started": 0, "stopped": 0}


async def test_api_starts_jobs_by_default_for_deployments_without_a_worker(recorded: dict[str, int]) -> None:
    app = create_app(make_settings(RUN_BACKGROUND_JOBS=True))
    async with app.router.lifespan_context(app):
        assert recorded["started"] == 1
    assert recorded == {"started": 1, "stopped": 1}
