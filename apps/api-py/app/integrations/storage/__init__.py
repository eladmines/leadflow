"""Object storage for uploaded media (apps/api/src/integrations/storage).

Cloudflare R2 is added at deployment behind this same interface.
"""

import asyncio
import re
import uuid
from pathlib import Path
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.core.timeutil import now_ms
from app.db.models import StoredObject

# Keys we generate: `<uuid>/<uuid>.webp` (images) or `.mp4` (status videos). Anything else is
# rejected (no path traversal).
STORAGE_KEY = re.compile(r"^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|mp4)$")
# Only images are served publicly at /media; videos stay inside the app.
IMAGE_KEY = re.compile(r"^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$")


class StorageProvider(Protocol):
    async def put(self, key: str, body: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes | None:
        """The object's bytes, or None when it doesn't exist."""
        ...

    async def delete(self, key: str) -> None: ...


class LocalDiskStorage:
    def __init__(self, directory: str) -> None:
        self.root = Path(directory).resolve()

    def _file(self, key: str) -> Path:
        full = (self.root / key).resolve()
        if self.root not in full.parents:
            raise ValueError("invalid storage key")
        return full

    async def put(self, key: str, body: bytes, content_type: str = "") -> None:
        file = self._file(key)

        def write() -> None:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(body)

        await asyncio.to_thread(write)

    async def get(self, key: str) -> bytes | None:
        file = self._file(key)
        try:
            return await asyncio.to_thread(file.read_bytes)
        except FileNotFoundError:
            return None

    async def delete(self, key: str) -> None:
        file = self._file(key)
        await asyncio.to_thread(lambda: file.unlink(missing_ok=True))


class DatabaseStorage:
    """Images in Postgres, for hosting whose disk doesn't survive a restart."""

    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self.sessionmaker = sessionmaker

    async def put(self, key: str, body: bytes, content_type: str) -> None:
        async with self.sessionmaker() as db:
            stmt = pg_insert(StoredObject).values(
                key=key, body=body, content_type=content_type, created_at=now_ms()
            )
            await db.execute(
                stmt.on_conflict_do_update(
                    index_elements=["key"], set_={"body": body, "content_type": content_type}
                )
            )
            await db.commit()

    async def get(self, key: str) -> bytes | None:
        async with self.sessionmaker() as db:
            return (
                await db.execute(select(StoredObject.body).where(StoredObject.key == key))
            ).scalar_one_or_none()

    async def delete(self, key: str) -> None:
        async with self.sessionmaker() as db:
            await db.execute(delete(StoredObject).where(StoredObject.key == key))
            await db.commit()


def create_storage(settings: Settings, sessionmaker: async_sessionmaker[AsyncSession]) -> StorageProvider:
    if settings.STORAGE_DRIVER == "database":
        return DatabaseStorage(sessionmaker)
    return LocalDiskStorage(settings.MEDIA_DIR)


def new_key(business_id: uuid.UUID) -> tuple[uuid.UUID, str]:
    asset_id = uuid.uuid4()
    return asset_id, f"{business_id}/{asset_id}.webp"
