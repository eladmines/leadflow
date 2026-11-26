"""Production start (render.yaml, Dockerfile): the API, plus the messaging worker when it is on.

    python scripts/run_production.py        # after scripts/prepare_db.py

- `MESSAGE_BUS` unset or `inline`: only the API, which also runs the background jobs (as before).
- `MESSAGE_BUS=rabbitmq`: two processes in this one service (D-202: free hosting, one Render
  instance). The API runs with `RUN_BACKGROUND_JOBS=false`, and the messaging worker
  (`python -m app.workers.messaging`) runs the jobs and consumes RabbitMQ (`RABBITMQ_URL`).

They are separate processes that only talk through the broker and the database. Moving the worker
to its own service later means running its command there and no longer here; no code changes.
If either process exits, the other is stopped and this script exits with its code, so the platform
restarts the whole service rather than leaving half of it running.
"""

import os
import signal
import subprocess
import sys
import time
from collections.abc import Mapping

STOP_GRACE_S = 20


def plan(env: Mapping[str, str]) -> list[tuple[str, list[str], dict[str, str]]]:
    """(name, command, environment) for each process to run."""
    python = sys.executable
    api = [
        python,
        "-m",
        "uvicorn",
        "app.server:create_server",
        "--factory",
        "--host",
        "0.0.0.0",
        "--port",
        env.get("PORT", "10000"),
        "--proxy-headers",
        "--forwarded-allow-ips=*",
    ]
    if env.get("MESSAGE_BUS", "inline") != "rabbitmq":
        return [("api", api, dict(env))]
    return [
        ("api", api, {**env, "RUN_BACKGROUND_JOBS": "false"}),
        ("worker", [python, "-m", "app.workers.messaging"], dict(env)),
    ]


def _stop(procs: list[subprocess.Popen[bytes]]) -> None:
    for p in procs:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
    deadline = time.monotonic() + STOP_GRACE_S
    for p in procs:
        try:
            p.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            p.kill()


def supervise(processes: list[tuple[str, list[str], dict[str, str]]], handle_signals: bool = True) -> int:
    """Runs the processes until one exits, then stops the rest; returns that one's exit code."""
    print(f"starting: {', '.join(name for name, _, _ in processes)}", flush=True)
    procs = [subprocess.Popen(cmd, env=env) for _, cmd, env in processes]
    names = {p.pid: name for p, (name, _, _) in zip(procs, processes, strict=True)}
    stopping = False

    def on_signal(signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        for p in procs:
            if p.poll() is None:
                p.send_signal(signum)

    if handle_signals:
        signal.signal(signal.SIGTERM, on_signal)
        signal.signal(signal.SIGINT, on_signal)

    while True:
        for p in procs:
            code = p.poll()
            if code is not None:
                if not stopping:
                    print(f"{names[p.pid]} exited ({code}); stopping the rest", flush=True)
                _stop(procs)
                return code
        time.sleep(0.2)


def main() -> int:
    return supervise(plan(os.environ))


if __name__ == "__main__":
    sys.exit(main())
