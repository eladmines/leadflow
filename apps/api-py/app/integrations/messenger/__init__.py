"""Facebook Messenger / Instagram DMs for a Page (F23, F28): Meta's Graph API and an in-memory
adapter. Implementations never log message texts or page-scoped ids."""

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol
from urllib.parse import quote

import httpx

from app.config import Settings


class MessengerSender(Protocol):
    async def send_text(self, psid: str, text: str) -> dict[str, str]:
        """Sends a text reply to a sender (by page-scoped id); returns Meta's message id."""
        ...

    async def profile_name(self, psid: str) -> str | None:
        """The sender's name from their profile, or None when Meta doesn't share it."""
        ...


@dataclass
class SentToPage:
    id: str
    to: str
    text: str


@dataclass
class MemoryMessengerSender:
    sent: list[SentToPage] = field(default_factory=list)
    names: dict[str, str] = field(default_factory=dict)  # profile names to return, by PSID (tests)
    fail_with: Exception | None = None

    async def send_text(self, psid: str, text: str) -> dict[str, str]:
        if self.fail_with:
            raise self.fail_with
        mid = f"m_local-{uuid.uuid4()}"
        self.sent.append(SentToPage(mid, psid, text))
        return {"id": mid}

    async def profile_name(self, psid: str) -> str | None:
        return self.names.get(psid)

    def clear(self) -> None:
        self.sent.clear()
        self.names.clear()
        self.fail_with = None


class MessengerSendError(Exception):
    """Meta refused a message. Carries Meta's numeric code only, never its text."""

    def __init__(self, status: int, code: int | None) -> None:
        super().__init__(f"Messenger send failed ({status}{f'/{code}' if code else ''})")
        self.status, self.code = status, code


class CloudMessengerSender:
    """Meta's Messenger Platform (Graph API `/{page-id}/messages`, Send API)."""

    def __init__(
        self,
        page_id: str,
        page_access_token: str,
        graph_version: str,
        kind: Literal["messenger", "instagram"] = "messenger",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.page_id, self.token, self.graph_version, self.kind = (
            page_id,
            page_access_token,
            graph_version,
            kind,
        )
        self._client = client

    async def _request(self, method: str, url: str, timeout: float, **kwargs: Any) -> httpx.Response:
        headers = {"authorization": f"Bearer {self.token}"}
        if self._client is not None:
            return await self._client.request(method, url, headers=headers, timeout=timeout, **kwargs)
        async with httpx.AsyncClient() as client:
            return await client.request(method, url, headers=headers, timeout=timeout, **kwargs)

    async def send_text(self, psid: str, text: str) -> dict[str, str]:
        res = await self._request(
            "POST",
            f"https://graph.facebook.com/{self.graph_version}/{self.page_id}/messages",
            10,
            json={
                "recipient": {"id": psid},
                "messaging_type": "RESPONSE",  # a reply inside the 24-hour window the customer's message opened
                "message": {"text": text[:2000]},
            },
        )
        try:
            body = res.json()
        except ValueError:
            body = {}
        mid = body.get("message_id") if isinstance(body, dict) else None
        if res.status_code >= 400 or not mid:
            raise MessengerSendError(res.status_code, ((body or {}).get("error") or {}).get("code"))
        return {"id": mid}

    async def profile_name(self, psid: str) -> str | None:
        fields = "name,username" if self.kind == "instagram" else "first_name,last_name"
        try:
            res = await self._request(
                "GET",
                f"https://graph.facebook.com/{self.graph_version}/{quote(psid, safe='')}?fields={fields}",
                5,
            )
            if res.status_code >= 400:
                return None
            j = res.json()
            if self.kind == "instagram":
                name = (j.get("name") or j.get("username") or "").strip()
            else:
                name = " ".join(x for x in (j.get("first_name"), j.get("last_name")) if x).strip()
            return name or None
        except Exception:
            return None  # no name is fine: the sender shows as "Facebook user" / "Instagram user"


def create_messenger_sender(settings: Settings) -> MessengerSender:
    """Picks the adapter from `MESSENGER_PROVIDER` (F23)."""
    if settings.MESSENGER_PROVIDER == "cloud":
        assert settings.MESSENGER_PAGE_ID and settings.MESSENGER_PAGE_ACCESS_TOKEN
        return CloudMessengerSender(
            settings.MESSENGER_PAGE_ID, settings.MESSENGER_PAGE_ACCESS_TOKEN, settings.WHATSAPP_GRAPH_VERSION
        )
    return MemoryMessengerSender()
