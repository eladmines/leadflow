"""RDAP: `.com`, `.net`, `.org` and about 1,200 other endings."""

import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx

BOOTSTRAP = "https://data.iana.org/rdap/dns.json"  # which RDAP server answers for which ending
DAY = 86_400


def expiry_from_rdap(body: Any) -> datetime | None:
    """The `expiration` event of an RDAP domain answer, or None."""
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        return None
    for e in events:
        if (
            isinstance(e, dict)
            and e.get("eventAction") == "expiration"
            and isinstance(e.get("eventDate"), str)
        ):
            try:
                return datetime.fromisoformat(e["eventDate"].replace("Z", "+00:00")).astimezone(UTC)
            except ValueError:
                return None
    return None


class RdapLookup:
    def __init__(self, client: httpx.AsyncClient | None = None, timeout_s: float = 10.0) -> None:
        self._client = client
        self._timeout = timeout_s
        self._bootstrap: tuple[float, dict[str, str]] | None = None

    async def _get(self, url: str) -> httpx.Response:
        headers = {"accept": "application/rdap+json, application/json"}
        if self._client is not None:
            return await self._client.get(url, headers=headers, timeout=self._timeout, follow_redirects=True)
        async with httpx.AsyncClient() as client:
            return await client.get(url, headers=headers, timeout=self._timeout, follow_redirects=True)

    async def _base_url(self, domain: str) -> str | None:
        tld = domain.split(".")[-1]
        if self._bootstrap is None or time.monotonic() - self._bootstrap[0] > DAY:
            res = await self._get(BOOTSTRAP)
            if res.status_code >= 400:
                raise RuntimeError("rdap bootstrap failed")
            by_tld: dict[str, str] = {}
            for tlds, urls in res.json().get("services", []):
                https = next((u for u in urls if u.startswith("https://")), urls[0] if urls else None)
                if https:
                    for t in tlds:
                        by_tld[t.lower()] = https
            self._bootstrap = (time.monotonic(), by_tld)
        return self._bootstrap[1].get(tld)

    async def supports(self, domain: str) -> bool:
        """True when RDAP has a server for this ending."""
        return await self._base_url(domain) is not None

    async def lookup(self, domain: str):  # type: ignore[no-untyped-def]
        from app.integrations.domain import DomainLookup

        try:
            base = await self._base_url(domain)
            if not base:
                return DomainLookup("unsupported")
            url = f"{base.rstrip('/')}/domain/{quote(domain, safe='')}"
            res = await self._get(url)
            if res.status_code >= 400:
                return DomainLookup("failed")
            expires = expiry_from_rdap(res.json())
            return DomainLookup("ok", expires) if expires else DomainLookup("failed")
        except Exception:
            return DomainLookup("failed")
