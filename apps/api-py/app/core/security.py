"""Password hashing and tokens (apps/api/src/lib/crypto.ts).

argon2id with the OWASP baseline (m = 19 MiB, t = 2, p = 1). The PHC strings are the same
format the Node API stored, so existing accounts verify unchanged.
"""

import asyncio
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)

# Login verifies against this when the email is unknown, so timing doesn't reveal accounts.
DUMMY_PASSWORD_HASH = (
    "$argon2id$v=19$m=19456,t=2,p=1$yNwPP7VlqzZ8Tx9za2uaKg$T/HrqzvvEjzK+PWWJHKReS/FHV7piTvKzaOPXNFGP/A"
)


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str, password: str) -> bool:
    """False (never raises) for a wrong password or a malformed stored hash."""

    def check() -> bool:
        try:
            return _hasher.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    return await asyncio.to_thread(check)


def generate_token() -> str:
    """32 random bytes as base64url without padding: always 43 chars."""
    return secrets.token_urlsafe(32)
