"""Outbound WhatsApp messages: Meta's Cloud API and an in-memory adapter (local development and
tests). Implementations never log message texts or phone numbers."""

import hashlib
import hmac
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.config import Settings


@dataclass
class WhatsAppChoice:
    """A tappable choice in an interactive message; `id` comes back in the customer's reply."""

    id: str
    title: str  # up to 24 characters in a list, 20 on a button (longer ones are cut)
    description: str | None = None  # list rows only, up to 72 characters


class WhatsAppSender(Protocol):
    async def send_text(self, to: str, text: str, preview: bool = False) -> dict[str, str]: ...
    async def send_image(self, to: str, jpeg: bytes, caption: str = "") -> dict[str, str]: ...
    async def send_video(self, to: str, mp4: bytes, caption: str = "") -> dict[str, str]: ...
    async def send_buttons(self, to: str, body: str, buttons: list[WhatsAppChoice]) -> dict[str, str]: ...
    async def send_list(
        self, to: str, body: str, button: str, rows: list[WhatsAppChoice]
    ) -> dict[str, str]: ...


@dataclass
class SentMessage:
    id: str
    to: str
    text: str
    choices: list[WhatsAppChoice] | None = None  # buttons or list rows of an interactive message
    image_bytes: int | None = None
    video_bytes: int | None = None


@dataclass
class MemoryWhatsAppSender:
    """Keeps sent messages in memory instead of calling Meta (local development and tests)."""

    sent: list[SentMessage] = field(default_factory=list)
    fail_with: Exception | None = None  # when set, sending raises this (to test send failures)

    def _record(self, **message: Any) -> dict[str, str]:
        if self.fail_with:
            raise self.fail_with
        mid = f"wamid.local-{uuid.uuid4()}"
        self.sent.append(SentMessage(id=mid, **message))
        return {"id": mid}

    async def send_text(self, to: str, text: str, preview: bool = False) -> dict[str, str]:
        return self._record(to=to, text=text)

    async def send_image(self, to: str, jpeg: bytes, caption: str = "") -> dict[str, str]:
        return self._record(to=to, text=caption, image_bytes=len(jpeg))

    async def send_video(self, to: str, mp4: bytes, caption: str = "") -> dict[str, str]:
        return self._record(to=to, text=caption, video_bytes=len(mp4))

    async def send_buttons(self, to: str, body: str, buttons: list[WhatsAppChoice]) -> dict[str, str]:
        return self._record(to=to, text=body, choices=buttons)

    async def send_list(self, to: str, body: str, button: str, rows: list[WhatsAppChoice]) -> dict[str, str]:
        return self._record(to=to, text=body, choices=rows)

    def clear(self) -> None:
        self.sent.clear()
        self.fail_with = None


class WhatsAppSendError(Exception):
    """Meta refused a message. Carries Meta's numeric code only, never its text."""

    def __init__(self, status: int, code: int | None) -> None:
        super().__init__(f"WhatsApp send failed ({status}{f'/{code}' if code else ''})")
        self.status, self.code = status, code


class CloudWhatsAppSender:
    """Meta's WhatsApp Cloud API (Graph API `/{phone-number-id}/messages`)."""

    def __init__(
        self,
        phone_number_id: str,
        access_token: str,
        graph_version: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.phone_number_id, self.access_token, self.graph_version = (
            phone_number_id,
            access_token,
            graph_version,
        )
        self._client = client

    async def _request(self, method: str, url: str, timeout: float, **kwargs: Any) -> httpx.Response:
        headers = {"authorization": f"Bearer {self.access_token}", **kwargs.pop("headers", {})}
        if self._client is not None:
            return await self._client.request(method, url, headers=headers, timeout=timeout, **kwargs)
        async with httpx.AsyncClient() as client:
            return await client.request(method, url, headers=headers, timeout=timeout, **kwargs)

    @staticmethod
    def _json(res: httpx.Response) -> dict[str, Any]:
        try:
            body = res.json()
            return body if isinstance(body, dict) else {}
        except ValueError:
            return {}

    async def _post(self, to: str, message: dict[str, Any]) -> dict[str, str]:
        res = await self._request(
            "POST",
            f"https://graph.facebook.com/{self.graph_version}/{self.phone_number_id}/messages",
            10,
            json={
                "messaging_product": "whatsapp",
                "to": to.removeprefix("+"),
                **message,
            },  # Meta wants no "+"
        )
        body = self._json(res)
        msgs = body.get("messages") or [{}]
        mid = msgs[0].get("id") if isinstance(msgs, list) and msgs else None
        if res.status_code >= 400 or not mid:
            raise WhatsAppSendError(res.status_code, (body.get("error") or {}).get("code"))
        return {"id": mid}

    async def send_text(self, to: str, text: str, preview: bool = False) -> dict[str, str]:
        return await self._post(to, {"type": "text", "text": {"body": text, "preview_url": preview}})

    async def _upload(self, body: bytes, mime: str, name: str, timeout: float) -> str:
        res = await self._request(
            "POST",
            f"https://graph.facebook.com/{self.graph_version}/{self.phone_number_id}/media",
            timeout,
            data={"messaging_product": "whatsapp", "type": mime},
            files={"file": (name, body, mime)},
        )
        parsed = self._json(res)
        if res.status_code >= 400 or not parsed.get("id"):
            raise WhatsAppSendError(res.status_code, (parsed.get("error") or {}).get("code"))
        return parsed["id"]

    async def send_image(self, to: str, jpeg: bytes, caption: str = "") -> dict[str, str]:
        """Uploads the photo to Meta (no public URL needed), then sends it by its media id."""
        media_id = await self._upload(jpeg, "image/jpeg", "photo.jpg", 20)
        return await self._post(
            to,
            {"type": "image", "image": {"id": media_id, **({"caption": caption[:1024]} if caption else {})}},
        )

    async def send_video(self, to: str, mp4: bytes, caption: str = "") -> dict[str, str]:
        media_id = await self._upload(mp4, "video/mp4", "video.mp4", 60)
        return await self._post(
            to,
            {"type": "video", "video": {"id": media_id, **({"caption": caption[:1024]} if caption else {})}},
        )

    async def send_buttons(self, to: str, body: str, buttons: list[WhatsAppChoice]) -> dict[str, str]:
        return await self._post(
            to,
            {
                "type": "interactive",
                "interactive": {
                    "type": "button",
                    "body": {"text": body},
                    "action": {
                        "buttons": [
                            {"type": "reply", "reply": {"id": b.id, "title": b.title[:20]}}
                            for b in buttons[:3]
                        ]
                    },
                },
            },
        )

    async def send_list(self, to: str, body: str, button: str, rows: list[WhatsAppChoice]) -> dict[str, str]:
        return await self._post(
            to,
            {
                "type": "interactive",
                "interactive": {
                    "type": "list",
                    "body": {"text": body},
                    "action": {
                        "button": button[:20],
                        "sections": [
                            {
                                "rows": [
                                    {
                                        "id": r.id,
                                        "title": r.title[:24],
                                        **({"description": r.description[:72]} if r.description else {}),
                                    }
                                    for r in rows[:10]
                                ]
                            }
                        ],
                    },
                },
            },
        )


def create_whatsapp_sender(settings: Settings) -> WhatsAppSender:
    """Picks the adapter from `WHATSAPP_PROVIDER`."""
    if settings.WHATSAPP_PROVIDER == "cloud":
        assert settings.WHATSAPP_PHONE_NUMBER_ID and settings.WHATSAPP_ACCESS_TOKEN
        return CloudWhatsAppSender(
            settings.WHATSAPP_PHONE_NUMBER_ID, settings.WHATSAPP_ACCESS_TOKEN, settings.WHATSAPP_GRAPH_VERSION
        )
    return MemoryWhatsAppSender()


def sign_webhook_body(raw_body: bytes, app_secret: str) -> str:
    """`sha256=<hex>` HMAC of the raw request body with the app secret (Meta's webhook signature)."""
    return "sha256=" + hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()


def verify_webhook_signature(raw_body: bytes, header: str | None, app_secret: str) -> bool:
    if not header:
        return False
    return hmac.compare_digest(sign_webhook_body(raw_body, app_secret).encode(), header.encode())
