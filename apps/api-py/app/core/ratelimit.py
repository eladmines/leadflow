"""In-memory fixed-window rate limit per client IP and per route (D-023)."""

import time
from collections import defaultdict

from fastapi import Request

from app.errors import AppError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], list[float]] = defaultdict(list)

    def hit(self, route: str, ip: str, limit: int, window_s: float) -> None:
        now = time.monotonic()
        key = (route, ip)
        recent = [t for t in self._hits[key] if now - t < window_s]
        if len(recent) >= limit:
            self._hits[key] = recent
            raise AppError("RATE_LIMITED")
        recent.append(now)
        self._hits[key] = recent


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limited(route: str):
    """Dependency factory: counts requests per IP for this route (failures count too)."""

    async def check(request: Request) -> None:
        s = request.app.state.settings
        request.app.state.rate_limiter.hit(
            route, client_ip(request), s.AUTH_RATE_LIMIT_MAX, s.AUTH_RATE_LIMIT_WINDOW / 1000
        )

    return check
