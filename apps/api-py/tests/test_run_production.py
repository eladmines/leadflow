"""D-202: the production launcher runs the worker only when the broker is on, and never lets the
API and the worker both run the background jobs."""

import importlib.util
import os
import sys
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_production.py"
spec = importlib.util.spec_from_file_location("run_production", SCRIPT)
run_production = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_production)


def test_inline_runs_only_the_api_which_keeps_the_jobs():
    ((name, cmd, env),) = run_production.plan({"PORT": "1234"})
    assert name == "api" and cmd[1:4] == ["-m", "uvicorn", "app.server:create_server"]
    assert cmd[cmd.index("--port") + 1] == "1234"
    assert "RUN_BACKGROUND_JOBS" not in env


def test_rabbitmq_adds_the_worker_and_moves_the_jobs_to_it():
    (api, worker) = run_production.plan(
        {"PORT": "1234", "MESSAGE_BUS": "rabbitmq", "RABBITMQ_URL": "amqp://x"}
    )
    assert api[0] == "api" and api[2]["RUN_BACKGROUND_JOBS"] == "false"
    assert worker[0] == "worker" and worker[1][1:] == ["-m", "app.workers.messaging"]
    assert "RUN_BACKGROUND_JOBS" not in worker[2]  # the worker always runs the jobs
    assert worker[2]["RABBITMQ_URL"] == "amqp://x"


def test_when_one_process_exits_the_rest_are_stopped_and_its_code_returned(capsys):
    """Stand-ins: the "worker" fails at once, the "api" would run for a minute."""
    py = sys.executable
    started = time.monotonic()
    code = run_production.supervise(
        [
            ("api", [py, "-c", "import time; time.sleep(60)"], dict(os.environ)),
            ("worker", [py, "-c", "import sys; sys.exit(3)"], dict(os.environ)),
        ],
        handle_signals=False,
    )
    assert code == 3
    assert time.monotonic() - started < 15  # the api was stopped, not waited for
    assert "worker exited (3); stopping the rest" in capsys.readouterr().out
