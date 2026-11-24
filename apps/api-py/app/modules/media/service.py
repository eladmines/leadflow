"""Image library of a business (F05). Port of apps/api/src/modules/media/service.ts."""

import asyncio
import re
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.images import process_image
from app.core.timeutil import iso, now_ms
from app.db.models import Asset, Site
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.storage import StorageProvider, new_key
from app.modules.media import schemas as s

_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)


def asset_url(settings: Settings, key: str) -> str:
    return f"{settings.MEDIA_PUBLIC_BASE}/{key}"


class MediaService:
    def __init__(self, db: AsyncSession, storage: StorageProvider, settings: Settings) -> None:
        self.db = db
        self.storage = storage
        self.settings = settings

    def _dto(self, a: Asset) -> s.AssetOut:
        return s.AssetOut(
            id=str(a.id),
            url=asset_url(self.settings, a.key),
            width=a.width,
            height=a.height,
            sizeBytes=a.size_bytes,
            originalName=a.original_name,
            createdAt=iso(a.created_at),
        )

    async def _used_bytes(self, business_id: uuid.UUID) -> int:
        return (
            await self.db.execute(
                select(func.coalesce(func.sum(Asset.size_bytes), 0)).where(Asset.business_id == business_id)
            )
        ).scalar_one()

    async def list_assets(self, ctx: TenantContext) -> s.AssetListResponse:
        rows = (
            (
                await self.db.execute(
                    select(Asset)
                    .where(Asset.business_id == ctx.business_id)
                    .order_by(Asset.created_at.desc())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        return s.AssetListResponse(
            assets=[self._dto(r) for r in rows],
            usedBytes=await self._used_bytes(ctx.business_id),
            quotaBytes=self.settings.MEDIA_QUOTA_BYTES,
        )

    async def upload(self, ctx: TenantContext, file: bytes, original_name: str | None) -> s.AssetOut:
        # Decoding and re-encoding are CPU work: off the event loop.
        image = await asyncio.to_thread(process_image, file)
        if await self._used_bytes(ctx.business_id) + len(image.data) > self.settings.MEDIA_QUOTA_BYTES:
            raise AppError("CONFLICT", s.MEDIA_MESSAGES["quotaExceeded"])
        asset_id, key = new_key(ctx.business_id)
        await self.storage.put(key, image.data, image.mime)
        try:
            row = Asset(
                id=asset_id,
                business_id=ctx.business_id,
                key=key,
                mime=image.mime,
                size_bytes=len(image.data),
                width=image.width,
                height=image.height,
                original_name=original_name[:200] if original_name else None,
                created_by_id=ctx.user_id,
                created_at=now_ms(),
            )
            self.db.add(row)
            await self.db.commit()
            return self._dto(row)
        except Exception:
            await self.db.rollback()
            try:
                await self.storage.delete(key)
            except Exception:
                pass
            raise

    async def remove(self, ctx: TenantContext, asset_id: str) -> None:
        """Refuses while the image is used by the draft or the live version (a deletion would
        break it)."""
        asset = None
        if _UUID.match(asset_id):
            asset = (
                await self.db.execute(
                    select(Asset).where(Asset.id == uuid.UUID(asset_id), Asset.business_id == ctx.business_id)
                )
            ).scalar_one_or_none()
        if asset is None:
            raise AppError("NOT_FOUND")
        site = (
            await self.db.execute(select(Site).where(Site.business_id == ctx.business_id))
        ).scalar_one_or_none()
        in_draft: list[str] = []
        in_live: list[str] = []
        if site:
            in_draft = s.referenced_asset_ids(
                {"theme": site.theme, "sections": site.sections, "pages": site.pages}
            )
            await self.db.refresh(site, ["published_version"])
            live = site.published_version.content if site.published_version else None
            if isinstance(live, dict) and live.get("theme") and live.get("sections"):
                in_live = s.referenced_asset_ids(live)
        if str(asset.id) in in_draft or str(asset.id) in in_live:
            raise AppError("CONFLICT", s.MEDIA_MESSAGES["inUse"])
        key = asset.key
        await self.db.execute(delete(Asset).where(Asset.id == asset.id))
        await self.db.commit()
        try:
            await self.storage.delete(key)
        except Exception:
            pass


async def assert_own_assets(db: AsyncSession, business_id: uuid.UUID, ids: list[str]) -> None:
    """Every referenced id must be an asset of this business (no borrowing another tenant's
    images)."""
    if not ids:
        return
    try:
        wanted = [uuid.UUID(i) for i in ids]
    except ValueError as err:
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["foreignAsset"]) from err
    count = (
        await db.execute(
            select(func.count())
            .select_from(Asset)
            .where(Asset.business_id == business_id, Asset.id.in_(wanted))
        )
    ).scalar_one()
    if count != len(wanted):
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["foreignAsset"])


async def media_map_for(
    db: AsyncSession, settings: Settings, business_id: uuid.UUID, ids: list[str]
) -> dict[str, dict[str, object]]:
    """Resolves ids to URLs + sizes for rendering (only this business's assets)."""
    if not ids:
        return {}
    try:
        wanted = [uuid.UUID(i) for i in ids]
    except ValueError:
        return {}
    rows = (
        await db.execute(select(Asset).where(Asset.business_id == business_id, Asset.id.in_(wanted)))
    ).scalars()
    return {
        str(r.id): {"url": asset_url(settings, r.key), "width": r.width, "height": r.height} for r in rows
    }
