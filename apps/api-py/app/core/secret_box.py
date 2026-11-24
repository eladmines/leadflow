"""Encrypts secrets kept in the database (F25: channel access tokens) with AES-256-GCM.

Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url), the same format the Node API wrote, so existing
rows open unchanged. The key is `CHANNEL_SECRETS_KEY` (32 bytes, base64), or one derived from
`FORM_TOKEN_SECRET` when it isn't set.
"""

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import Settings


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def secret_key(settings: Settings) -> bytes:
    if settings.CHANNEL_SECRETS_KEY:
        return base64.b64decode(settings.CHANNEL_SECRETS_KEY)
    return hashlib.sha256(f"leadflow-channel-secrets:{settings.FORM_TOKEN_SECRET}".encode()).digest()


def seal_secret(plain: str, key: bytes) -> str:
    iv = os.urandom(12)
    sealed = AESGCM(key).encrypt(iv, plain.encode(), None)  # ciphertext followed by the 16-byte tag
    data, tag = sealed[:-16], sealed[-16:]
    return ".".join(["v1", _b64(iv), _b64(tag), _b64(data)])


def open_secret(box: str, key: bytes) -> str:
    """Raises when the box was tampered with or sealed with another key."""
    parts = box.split(".")
    if len(parts) != 4 or parts[0] != "v1" or not all(parts[1:]):
        raise ValueError("Unknown secret format")
    iv, tag, data = (_unb64(p) for p in parts[1:])
    try:
        return AESGCM(key).decrypt(iv, data + tag, None).decode()
    except InvalidTag as err:
        raise ValueError("Secret could not be opened") from err
