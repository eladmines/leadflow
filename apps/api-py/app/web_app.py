"""Serves the built web app (apps/web/dist) from the API's own port, so one service hosts everything
and the session cookie stays same-origin. Real files are sent as they are (hashed `/assets/*` cached
for a year); any other page path gets index.html for the client router. Returns None for requests it
doesn't own (the API's JSON 404 answers those). Port of apps/api/src/lib/web-app.ts."""

import asyncio
from pathlib import Path
from urllib.parse import unquote

from starlette.requests import Request
from starlette.responses import Response

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".woff2": "font/woff2",
}


class WebApp:
    def __init__(self, directory: str) -> None:
        self.root = Path(directory).resolve()
        self.index = self.root / "index.html"

    async def handle(self, request: Request) -> Response | None:
        if request.method not in ("GET", "HEAD"):
            return None
        url_path = unquote(request.url.path)
        if url_path.startswith(("/api/", "/media/")):
            return None
        file = (self.root / f".{url_path}").resolve()
        inside = file == self.root or self.root in file.parents
        is_file = inside and await asyncio.to_thread(file.is_file)
        # A missing asset is a real 404, not the app shell (a stale tab after a deploy).
        if not is_file and url_path.startswith("/assets/"):
            return None
        target = file if is_file else self.index
        body = await asyncio.to_thread(target.read_bytes)
        immutable = is_file and url_path.startswith("/assets/")
        return Response(
            body,
            media_type=None,
            headers={
                "content-type": TYPES.get(target.suffix, "application/octet-stream"),
                "cache-control": "public, max-age=31536000, immutable" if immutable else "no-cache",
                "x-content-type-options": "nosniff",
                "referrer-policy": "strict-origin-when-cross-origin",
                "x-frame-options": "DENY",
            },
        )
