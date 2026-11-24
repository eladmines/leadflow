"""F30: a business's public embed key = `<business id without dashes>.<hmac>`. Stateless (no column,
no migration); signed with FORM_TOKEN_SECRET, so it can't be guessed for another business. It is
public (it sits in the site's HTML) and only lets leads in."""

import base64
import hashlib
import hmac
import re
import uuid
from typing import Any


def _sign(secret: str, ident: str) -> str:
    mac = hmac.new(secret.encode(), f"embed.{ident}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode()[:22]


def create_embed_key(secret: str, business_id: uuid.UUID | str) -> str:
    ident = str(business_id).replace("-", "")
    return f"{ident}.{_sign(secret, ident)}"


def read_embed_key(secret: str, key: Any) -> uuid.UUID | None:
    """The business id inside a valid key, or None."""
    if not isinstance(key, str):
        return None
    m = re.match(r"^([0-9a-f]{32})\.([A-Za-z0-9_-]{22})$", key)
    if not m or not hmac.compare_digest(_sign(secret, m.group(1)), m.group(2)):
        return None
    return uuid.UUID(m.group(1))
