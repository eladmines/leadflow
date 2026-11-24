"""Meta's Graph API for connecting channels (F25, D-159): Facebook sign-in, the person's Pages,
subscribing a Page to the app's webhook, and checking a WhatsApp number. Implementations never log
tokens or Meta's error texts."""

from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote, urlencode

import httpx

from app.config import Settings


@dataclass
class MetaPage:
    """A Facebook Page the signed-in person manages, with its Page access token."""

    id: str
    name: str
    access_token: str
    instagram: dict[str, str] | None = None  # the linked Instagram professional account, if any

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "name": self.name, "accessToken": self.access_token}
        if self.instagram:
            out["instagram"] = self.instagram
        return out

    @staticmethod
    def from_json(raw: dict[str, Any]) -> "MetaPage":
        return MetaPage(raw["id"], raw["name"], raw["accessToken"], raw.get("instagram"))


class MetaApi(Protocol):
    async def exchange_code(self, code: str, redirect_uri: str) -> str: ...
    async def pages(self, user_token: str) -> list[MetaPage]: ...
    async def instagram_of(self, page_id: str, page_token: str) -> dict[str, str] | None: ...
    async def subscribe_page(self, page_id: str, page_token: str) -> None: ...
    async def unsubscribe_page(self, page_id: str, page_token: str) -> None: ...
    async def whatsapp_number(self, phone_number_id: str, access_token: str) -> str | None: ...


@dataclass
class MemoryMetaApi:
    """Stands in for Meta (local development and tests)."""

    pages_to_return: list[MetaPage] = field(
        default_factory=lambda: [MetaPage("100200300", "דף לבדיקה", "page-token")]
    )
    subscribed: set[str] = field(default_factory=set)
    instagram: dict[str, dict[str, str]] = field(default_factory=dict)  # by Page id (tests)
    numbers: dict[str, str] = field(default_factory=lambda: {"555000111": "+1 555-000-1111"})

    async def exchange_code(self, code: str, redirect_uri: str = "") -> str:
        if code != "good-code":
            raise ValueError("bad code")
        return "user-token"

    async def pages(self, user_token: str = "") -> list[MetaPage]:
        return self.pages_to_return

    async def instagram_of(self, page_id: str, page_token: str = "") -> dict[str, str] | None:
        return self.instagram.get(page_id)

    async def subscribe_page(self, page_id: str, page_token: str = "") -> None:
        self.subscribed.add(page_id)

    async def unsubscribe_page(self, page_id: str, page_token: str = "") -> None:
        self.subscribed.discard(page_id)

    async def whatsapp_number(self, phone_number_id: str, access_token: str = "") -> str | None:
        return self.numbers.get(phone_number_id)


class MetaApiError(Exception):
    """Meta refused a call. Carries Meta's numeric code only, never its text."""

    def __init__(self, status: int, code: int | None) -> None:
        super().__init__(f"Meta API failed ({status}{f'/{code}' if code else ''})")
        self.status, self.code = status, code


class CloudMetaApi:
    def __init__(
        self, app_id: str, app_secret: str, graph_version: str, client: httpx.AsyncClient | None = None
    ) -> None:
        self.app_id, self.app_secret, self.graph_version = app_id, app_secret, graph_version
        self._client = client

    def _url(self, path: str, query: dict[str, str] | None = None) -> str:
        q = urlencode(query or {})
        return f"https://graph.facebook.com/{self.graph_version}/{path}{'?' + q if q else ''}"

    async def _call(self, url: str, method: str = "GET", token: str | None = None) -> dict[str, Any]:
        headers = {"authorization": f"Bearer {token}"} if token else {}
        if self._client is not None:
            res = await self._client.request(method, url, headers=headers, timeout=10)
        else:
            async with httpx.AsyncClient() as client:
                res = await client.request(method, url, headers=headers, timeout=10)
        try:
            body = res.json()
        except ValueError:
            body = None
        if res.status_code >= 400 or not isinstance(body, dict):
            raise MetaApiError(
                res.status_code,
                ((body or {}).get("error") or {}).get("code") if isinstance(body, dict) else None,
            )
        return body

    async def exchange_code(self, code: str, redirect_uri: str) -> str:
        body = await self._call(
            self._url(
                "oauth/access_token",
                {
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
        )
        if not body.get("access_token"):
            raise MetaApiError(200, None)
        return body["access_token"]

    async def pages(self, user_token: str) -> list[MetaPage]:
        body = await self._call(
            self._url(
                "me/accounts",
                {"fields": "id,name,access_token,instagram_business_account{id,username}", "limit": "100"},
            ),
            token=user_token,
        )
        out = []
        for p in body.get("data", []):
            ig = p.get("instagram_business_account")
            out.append(
                MetaPage(
                    p["id"],
                    p["name"],
                    p["access_token"],
                    {"id": ig["id"], "username": ig.get("username") or ig["id"]} if ig else None,
                )
            )
        return out

    async def instagram_of(self, page_id: str, page_token: str) -> dict[str, str] | None:
        try:
            body = await self._call(
                self._url(quote(page_id, safe=""), {"fields": "instagram_business_account{id,username}"}),
                token=page_token,
            )
        except Exception:
            return None
        ig = body.get("instagram_business_account")
        return {"id": ig["id"], "username": ig.get("username") or ig["id"]} if ig else None

    async def subscribe_page(self, page_id: str, page_token: str) -> None:
        await self._call(
            self._url(f"{quote(page_id, safe='')}/subscribed_apps", {"subscribed_fields": "messages"}),
            "POST",
            page_token,
        )

    async def unsubscribe_page(self, page_id: str, page_token: str) -> None:
        await self._call(self._url(f"{quote(page_id, safe='')}/subscribed_apps"), "DELETE", page_token)

    async def whatsapp_number(self, phone_number_id: str, access_token: str) -> str | None:
        try:
            body = await self._call(
                self._url(quote(phone_number_id, safe=""), {"fields": "display_phone_number"}),
                token=access_token,
            )
        except Exception:
            return None
        return body.get("display_phone_number")


def create_meta_api(settings: Settings) -> MetaApi:
    """Real Meta when a channel uses the cloud provider and the app is known; else the stand-in."""
    cloud = settings.WHATSAPP_PROVIDER == "cloud" or settings.MESSENGER_PROVIDER == "cloud"
    if cloud and settings.WHATSAPP_APP_SECRET:
        return CloudMetaApi(
            settings.META_APP_ID or "", settings.WHATSAPP_APP_SECRET, settings.WHATSAPP_GRAPH_VERSION
        )
    return MemoryMetaApi()
