"""Google's Gmail API for the connected inbox (F29, D-188): sign-in, reading new mail, replying.
Implementations never log tokens, addresses or message texts."""

import base64
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote, urlencode

import httpx

from app.config import Settings


@dataclass
class GmailMessage:
    """One inbox message, already parsed (F29)."""

    id: str  # Gmail's own id
    thread_id: str
    message_id: str  # the RFC 5322 Message-ID header (without angle brackets); empty if none
    from_: str
    from_name: str | None
    subject: str
    text: str
    received_at: int  # when Gmail received it (ms since epoch)
    skip: bool  # mail we shouldn't answer or file: bulk, lists, auto-replies, no-reply senders


@dataclass
class GmailTokens:
    refresh_token: str
    email: str  # the Gmail address that signed in


@dataclass
class GmailOutgoing:
    from_: str
    to: str
    subject: str
    text: str
    in_reply_to: str | None = None  # Message-ID of the mail being answered, for threading
    thread_id: str | None = None


class GmailApi(Protocol):
    def auth_url(self, redirect_uri: str, state: str) -> str: ...
    async def exchange_code(self, code: str, redirect_uri: str) -> GmailTokens: ...
    async def access_token(self, refresh_token: str) -> str: ...
    async def list_inbox(self, access_token: str, after_ms: int) -> list[GmailMessage]: ...
    async def send(self, access_token: str, mail: GmailOutgoing) -> dict[str, str]: ...
    async def revoke(self, refresh_token: str) -> None: ...


@dataclass
class MemoryGmailApi:
    """Stands in for Google (local development and tests)."""

    sign_in: GmailTokens = field(default_factory=lambda: GmailTokens("refresh-token", "owner@gmail.com"))
    inbox: list[GmailMessage] = field(
        default_factory=list
    )  # newest last; only messages after the cursor are listed
    sent: list[tuple[GmailOutgoing, str]] = field(default_factory=list)
    revoked: list[str] = field(default_factory=list)
    reject_token: bool = False  # when true the refresh token is rejected (to test a revoked grant)

    def auth_url(self, redirect_uri: str, state: str) -> str:
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {"redirect_uri": redirect_uri, "state": state}
        )

    async def exchange_code(self, code: str, redirect_uri: str = "") -> GmailTokens:
        if code != "good-code":
            raise ValueError("bad code")
        return self.sign_in

    async def access_token(self, refresh_token: str = "") -> str:
        if self.reject_token:
            raise ValueError("invalid_grant")
        return "access-token"

    async def list_inbox(self, access_token: str, after_ms: int) -> list[GmailMessage]:
        return sorted((m for m in self.inbox if m.received_at > after_ms), key=lambda m: m.received_at)

    async def send(self, access_token: str, mail: GmailOutgoing) -> dict[str, str]:
        mid = f"gm-{uuid.uuid4()}"
        self.sent.append((mail, mid))
        return {"id": mid}

    async def revoke(self, refresh_token: str) -> None:
        self.revoked.append(refresh_token)

    def clear(self) -> None:
        self.inbox.clear()
        self.sent.clear()
        self.revoked.clear()
        self.reject_token = False
        self.sign_in = GmailTokens("refresh-token", "owner@gmail.com")


class GmailApiError(Exception):
    """Google refused a call. Carries the HTTP status only, never Google's text."""

    def __init__(self, status: int) -> None:
        super().__init__(f"Gmail API failed ({status})")
        self.status = status


SCOPES = " ".join(
    [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
    ]
)
# Mail Gmail itself files away from the person's main inbox.
SKIPPED_LABELS = ("CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS")
MAX_BATCH = 25


def _b64(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _find(part: dict[str, Any], mime: str) -> str | None:
    if part.get("mimeType") == mime and (part.get("body") or {}).get("data"):
        return _b64(part["body"]["data"])
    for child in part.get("parts") or []:
        hit = _find(child, mime)
        if hit is not None:
            return hit
    return None


def _body_of(part: dict[str, Any] | None) -> str:
    """The plain-text body, else the HTML reduced to text."""
    if not part:
        return ""
    text = _find(part, "text/plain")
    if text is not None:
        return text
    html = _find(part, "text/html")
    if html is None:
        return ""
    html = re.sub(r"<(style|script)[\s\S]*?</\1>", "", html, flags=re.I)
    html = re.sub(r"<br\s*/?>|</(p|div|tr|li)>", "\n", html, flags=re.I)
    html = re.sub(r"<[^>]+>", "", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\n{3,}", "\n\n", html).strip()


def _parse_from(value: str) -> tuple[str | None, str]:
    """ "Dana <dana@x.com>" → name and address."""
    m = re.match(r'^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$', value)
    address = (m.group(2) if m else value).strip().lower()
    name = m.group(1).strip() if m else ""
    return (name or None), address


def to_message(raw: dict[str, Any]) -> GmailMessage:
    headers = {h["name"].lower(): h["value"] for h in (raw.get("payload") or {}).get("headers", [])}
    name, address = _parse_from(headers.get("from", ""))
    precedence = headers.get("precedence", "").lower()
    auto = headers.get("auto-submitted", "no").lower() != "no"
    labels = raw.get("labelIds") or []
    skip = (
        auto
        or "list-unsubscribe" in headers
        or "x-autoreply" in headers
        or precedence in ("bulk", "list", "junk")
        or bool(re.match(r"^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@", address))
        or any(label in SKIPPED_LABELS or label in ("SPAM", "DRAFT") for label in labels)
    )
    return GmailMessage(
        id=raw["id"],
        thread_id=raw["threadId"],
        message_id=re.sub(r"^<|>$", "", headers.get("message-id", "")).strip(),
        from_=address,
        from_name=name,
        subject=headers.get("subject", ""),
        text=_body_of(raw.get("payload")),
        received_at=int(raw.get("internalDate") or time.time() * 1000),
        skip=skip,
    )


class CloudGmailApi:
    """Google's OAuth and Gmail REST APIs."""

    def __init__(self, client_id: str, client_secret: str, client: httpx.AsyncClient | None = None) -> None:
        self.client_id, self.client_secret = client_id, client_secret
        self._client = client

    async def _call(self, url: str, method: str = "GET", **kwargs: Any) -> Any:
        if self._client is not None:
            res = await self._client.request(method, url, timeout=15, **kwargs)
        else:
            async with httpx.AsyncClient() as client:
                res = await client.request(method, url, timeout=15, **kwargs)
        try:
            body = res.json()
        except ValueError:
            body = None
        if res.status_code >= 400 or body is None:
            raise GmailApiError(res.status_code)
        return body

    async def _token(self, params: dict[str, str]) -> dict[str, Any]:
        return await self._call(
            "https://oauth2.googleapis.com/token",
            "POST",
            data={"client_id": self.client_id, "client_secret": self.client_secret, **params},
        )

    def auth_url(self, redirect_uri: str, state: str) -> str:
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": SCOPES,
                "access_type": "offline",
                "prompt": "consent",  # always ask, so Google returns a refresh token every time
                "state": state,
            }
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> GmailTokens:
        tokens = await self._token(
            {"code": code, "redirect_uri": redirect_uri, "grant_type": "authorization_code"}
        )
        if not tokens.get("access_token") or not tokens.get("refresh_token"):
            raise GmailApiError(200)
        profile = await self._call(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"authorization": f"Bearer {tokens['access_token']}"},
        )
        if not profile.get("emailAddress"):
            raise GmailApiError(200)
        return GmailTokens(tokens["refresh_token"], profile["emailAddress"].lower())

    async def access_token(self, refresh_token: str) -> str:
        tokens = await self._token({"refresh_token": refresh_token, "grant_type": "refresh_token"})
        if not tokens.get("access_token"):
            raise GmailApiError(200)
        return tokens["access_token"]

    async def list_inbox(self, access_token: str, after_ms: int) -> list[GmailMessage]:
        auth = {"authorization": f"Bearer {access_token}"}
        # `after:` takes seconds; one second back so a message at the boundary is never missed
        # (the caller drops what it has already seen).
        q = f"in:inbox after:{max(0, after_ms // 1000 - 1)}"
        listing = await self._call(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?"
            + urlencode({"q": q, "maxResults": str(MAX_BATCH)}),
            headers=auth,
        )
        out = []
        for m in listing.get("messages", []):
            raw = await self._call(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{quote(m['id'], safe='')}?format=full",
                headers=auth,
            )
            out.append(to_message(raw))
        return sorted(out, key=lambda m: m.received_at)

    async def send(self, access_token: str, mail: GmailOutgoing) -> dict[str, str]:
        def header(v: str) -> str:
            return re.sub(r"[\r\n]+", " ", v)

        subject = "=?UTF-8?B?" + base64.b64encode(header(mail.subject).encode()).decode() + "?="
        lines = [f"From: {header(mail.from_)}", f"To: {header(mail.to)}", f"Subject: {subject}"]
        if mail.in_reply_to:
            lines += [
                f"In-Reply-To: <{header(mail.in_reply_to)}>",
                f"References: <{header(mail.in_reply_to)}>",
            ]
        lines += [
            "MIME-Version: 1.0",
            'Content-Type: text/plain; charset="UTF-8"',
            "Content-Transfer-Encoding: base64",
            "",
            base64.b64encode(mail.text.encode()).decode(),
        ]
        raw = base64.urlsafe_b64encode("\r\n".join(lines).encode()).rstrip(b"=").decode()
        body = await self._call(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            "POST",
            headers={"authorization": f"Bearer {access_token}"},
            json={"raw": raw, **({"threadId": mail.thread_id} if mail.thread_id else {})},
        )
        if not body.get("id"):
            raise GmailApiError(200)
        return {"id": body["id"]}

    async def revoke(self, refresh_token: str) -> None:
        try:
            await self._call(
                "https://oauth2.googleapis.com/revoke?" + urlencode({"token": refresh_token}), "POST"
            )
        except Exception:
            return None


def create_gmail_api(settings: Settings) -> GmailApi:
    """Google when the OAuth client is configured; otherwise a stand-in whose sign-in is off."""
    if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
        return CloudGmailApi(settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET)
    return MemoryGmailApi()
