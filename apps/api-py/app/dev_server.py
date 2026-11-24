"""Local development server: the API on PORT and the customer sites on PUBLIC_PORT (the way the
Node API ran them: `http://<name>.lvh.me:4100`), from one process so both share the same caches.

    uv run python -m app.dev_server            # PORT (default 4000) and PUBLIC_PORT (default 4100)

Production uses one port instead (`uvicorn app.server:create_server --factory`, PUBLIC_SITE_MODE=path).
"""

import asyncio
import os

import uvicorn

from app.config import get_settings
from app.server import create_server


async def main() -> None:
    settings = get_settings()
    app = create_server(settings)
    api = uvicorn.Server(
        uvicorn.Config(app, host=None, port=int(os.environ.get("PORT", "4000")), log_level="warning")
    )
    # The second listener shares the app: its lifespan and signals belong to the first.
    sites = uvicorn.Server(
        uvicorn.Config(app, host=None, port=settings.PUBLIC_PORT, log_level="warning", lifespan="off")
    )
    sites.install_signal_handlers = lambda: None  # type: ignore[method-assign]

    async def run_sites() -> None:
        await sites.serve()

    task = asyncio.create_task(run_sites())
    try:
        await api.serve()
    finally:
        sites.should_exit = True
        await task


if __name__ == "__main__":
    asyncio.run(main())
