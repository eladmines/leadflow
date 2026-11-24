"""F33: when a domain expires, read from its registry. Behind an interface like the other
integrations, so tests and an "off" mode never touch the network."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.config import Settings


@dataclass(frozen=True)
class DomainLookup:
    status: Literal["ok", "unsupported", "failed"]  # unsupported: no public lookup; failed: try later
    expires_at: datetime | None = None


class DomainExpiry(Protocol):
    async def lookup(self, domain: str) -> DomainLookup:
        """`domain` is a registrable domain (`shiran.co.il`). Never raises."""
        ...


class MemoryDomainExpiry:
    """For tests and the "off" mode: answers from a table, never from the network."""

    def __init__(self, answers: dict[str, DomainLookup] | None = None) -> None:
        self.answers = answers or {}
        self.asked: list[str] = []

    def set(self, domain: str, answer: DomainLookup) -> None:
        self.answers[domain] = answer

    async def lookup(self, domain: str) -> DomainLookup:
        self.asked.append(domain)
        return self.answers.get(domain, DomainLookup("unsupported"))


class RegistryDomainExpiry:
    """`.il` goes to ISOC-IL's WHOIS; everything RDAP knows goes to RDAP; the rest isn't supported."""

    def __init__(self, rdap: "RdapLookup | None" = None, isoc: "IsocWhoisLookup | None" = None) -> None:
        from app.integrations.domain.rdap import RdapLookup
        from app.integrations.domain.whois_il import IsocWhoisLookup

        self.rdap = rdap or RdapLookup()
        self.isoc = isoc or IsocWhoisLookup()

    async def lookup(self, domain: str) -> DomainLookup:
        if domain.endswith(".il"):
            return await self.isoc.lookup(domain)
        return await self.rdap.lookup(domain)


def create_domain_expiry(settings: Settings) -> DomainExpiry:
    """The registries (`DOMAIN_LOOKUP=live`), or nothing at all (`off`: every ending reads as unsupported)."""
    return RegistryDomainExpiry() if settings.DOMAIN_LOOKUP == "live" else MemoryDomainExpiry()


from app.integrations.domain.rdap import RdapLookup, expiry_from_rdap  # noqa: E402
from app.integrations.domain.whois_il import IsocWhoisLookup, expiry_from_isoc_whois  # noqa: E402

__all__ = [
    "DomainExpiry",
    "DomainLookup",
    "IsocWhoisLookup",
    "MemoryDomainExpiry",
    "RdapLookup",
    "RegistryDomainExpiry",
    "create_domain_expiry",
    "expiry_from_isoc_whois",
    "expiry_from_rdap",
]
