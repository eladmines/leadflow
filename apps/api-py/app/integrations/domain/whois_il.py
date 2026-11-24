"""ISOC-IL's WHOIS for the `.il` ending (there is no RDAP for it)."""

import asyncio
import re
from datetime import UTC, datetime

HOST = "whois.isoc.org.il"


def expiry_from_isoc_whois(text: str) -> datetime | None:
    """`validity:     17-01-2027` → that date (UTC); None when the answer has none."""
    m = re.search(r"^\s*validity:\s*(\d{2})-(\d{2})-(\d{4})\s*$", text, re.I | re.M)
    if not m:
        return None
    try:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), tzinfo=UTC)
    except ValueError:
        return None


class IsocWhoisLookup:
    """One question per domain, over TCP port 43, with a time limit. Used at most once a day per
    domain."""

    def __init__(self, host: str = HOST, port: int = 43, timeout_s: float = 10.0) -> None:
        self.host, self.port, self.timeout = host, port, timeout_s

    async def lookup(self, domain: str):  # type: ignore[no-untyped-def]
        from app.integrations.domain import DomainLookup

        async def ask() -> bytes:
            reader, writer = await asyncio.open_connection(self.host, self.port)
            try:
                writer.write(f"{domain}\r\n".encode())
                await writer.drain()
                data = b""
                while chunk := await reader.read(4096):
                    data += chunk
                    if len(data) > 64_000:
                        raise ValueError("answer too long")
                return data
            finally:
                writer.close()

        try:
            data = await asyncio.wait_for(ask(), self.timeout)
        except Exception:
            return DomainLookup("failed")
        expires = expiry_from_isoc_whois(data.decode("utf-8", errors="replace"))
        return DomainLookup("ok", expires) if expires else DomainLookup("failed")
