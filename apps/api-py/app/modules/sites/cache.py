"""In-process cache of published pages by subdomain, shared by the API (which invalidates it on
publish / rollback / unpublish / address change) and the public-site server (which reads it).
Single-process MVP; a CDN-fronted object store replaces it in production."""

import time
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class PublishedPage:
    html: str | None
    pages: dict[str, str] = field(default_factory=dict)  # extra pages' HTML by address (D-081)
    version_id: str | None = None
    updated_at: datetime | None = None


class PublishedSiteCache:
    def __init__(self, ttl_s: float = 30.0) -> None:
        self._ttl = ttl_s
        self._entries: dict[str, tuple[PublishedPage, float]] = {}

    def get(self, subdomain: str) -> PublishedPage | None:
        hit = self._entries.get(subdomain)
        if hit is None:
            return None
        page, expires = hit
        if expires <= time.monotonic():
            del self._entries[subdomain]
            return None
        return page

    def set(self, subdomain: str, page: PublishedPage) -> None:
        if self._ttl > 0:
            self._entries[subdomain] = (page, time.monotonic() + self._ttl)

    def invalidate(self, *subdomains: str | None) -> None:
        for s in subdomains:
            if s:
                self._entries.pop(s, None)
