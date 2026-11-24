"""The deployable server: the API and the public customer sites on one port.

Customer sites answer on their own subdomain (`PUBLIC_SITE_MODE=host`) or under `/s/<name>` on the
app's address (`path`); everything else is the API. Run it with:

    uvicorn app.server:create_server --factory --port 4000
"""

from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings, get_settings
from app.main import create_app
from app.public.app import create_public_app


class SiteDispatcher:
    def __init__(self, api: ASGIApp, public: ASGIApp, settings: Settings) -> None:
        self.api, self.public = api, public
        self.by_path = settings.PUBLIC_SITE_MODE == "path"
        self.suffix = f".{settings.PUBLIC_SITE_HOST.lower()}"

    def _is_site(self, scope: Scope) -> bool:
        if self.by_path:
            return scope["path"].startswith("/s/")
        host = next((v.decode() for k, v in scope["headers"] if k == b"host"), "").lower().rstrip(".")
        return host.endswith(self.suffix)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self._is_site(scope):
            await self.public(scope, receive, send)
        else:
            # Lifespan and everything else belong to the API (it owns the database pool).
            await self.api(scope, receive, send)


def create_server(settings: Settings | None = None) -> ASGIApp:
    settings = settings or get_settings()
    api = create_app(settings)
    public = create_public_app(
        settings, api.state.sessionmaker, api.state.email, api.state.site_cache, api.state.storage
    )
    return SiteDispatcher(api, public, settings)
