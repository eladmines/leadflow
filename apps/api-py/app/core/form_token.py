"""Per-page-view token for public lead forms: `<issuedAtMs>.<nonce>.<hmac>` (lib/form-token.ts).

- bound to the subdomain (a token from site A can't be replayed on site B),
- proves when the page was served (minimum fill time → simple bot filter, no JavaScript needed),
- the nonce is the idempotency key, so a double-submit creates one lead.
"""

import base64
import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any

FORM_MIN_FILL_MS = 3000  # submissions faster than this after the page was served are bots
FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000  # older tokens: the page was open too long

_TOKEN = re.compile(r"^(\d{13})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{32})$")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _sign(secret: str, subdomain: str, issued_at: int, nonce: str) -> str:
    mac = hmac.new(secret.encode(), f"{subdomain}.{issued_at}.{nonce}".encode(), hashlib.sha256).digest()
    return _b64url(mac)[:32]


def create_form_token(secret: str, subdomain: str, now_ms: int | None = None) -> str:
    issued = now_ms if now_ms is not None else int(time.time() * 1000)
    nonce = _b64url(secrets.token_bytes(12))
    return f"{issued}.{nonce}.{_sign(secret, subdomain, issued, nonce)}"


@dataclass
class FormTokenCheck:
    ok: bool
    nonce: str = ""
    too_fast: bool = False
    reason: str = ""  # 'invalid' | 'expired'


def verify_form_token(secret: str, subdomain: str, token: Any, now_ms: int | None = None) -> FormTokenCheck:
    if not isinstance(token, str):
        return FormTokenCheck(False, reason="invalid")
    m = _TOKEN.match(token)
    if not m:
        return FormTokenCheck(False, reason="invalid")
    issued, nonce, given = int(m.group(1)), m.group(2), m.group(3)
    if not hmac.compare_digest(_sign(secret, subdomain, issued, nonce), given):
        return FormTokenCheck(False, reason="invalid")
    age = (now_ms if now_ms is not None else int(time.time() * 1000)) - issued
    if age < -60_000 or age > FORM_TOKEN_MAX_AGE_MS:
        return FormTokenCheck(False, reason="expired")
    return FormTokenCheck(True, nonce=nonce, too_fast=age < FORM_MIN_FILL_MS)
