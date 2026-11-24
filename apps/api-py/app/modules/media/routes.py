"""Image library of a business (tenant scope) and the public image serving (F05)."""

import asyncio
import re
from pathlib import Path

from fastapi import APIRouter, Request, Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.errors import AppError
from app.integrations.storage import IMAGE_KEY
from app.modules.media import schemas as s
from app.modules.media.service import MediaService

tenant = tenant_router()


def _svc(request: Request, db: Db) -> MediaService:
    return MediaService(db, request.app.state.storage, request.app.state.settings)


@tenant.get("/assets", response_model=s.AssetListResponse, dependencies=[require_permission("site.view")])
async def list_assets(ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).list_assets(ctx)


@tenant.post(
    "/assets", status_code=201, response_model=s.AssetResponse, dependencies=[require_permission("site.edit")]
)
async def upload_asset(ctx: Tenant, request: Request, db: Db):
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["noFile"])
    declared = request.headers.get("content-length")
    # Refuse an oversized body before reading it (the multipart framing adds a little).
    if declared and declared.isdigit() and int(declared) > s.MAX_UPLOAD_BYTES + 64 * 1024:
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["tooLarge"])
    try:
        form = await request.form(max_files=1, max_fields=5)
    except Exception as err:
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["noFile"]) from err
    upload = next((v for v in form.values() if hasattr(v, "read") and hasattr(v, "filename")), None)
    if upload is None:
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["noFile"])
    data = await upload.read(s.MAX_UPLOAD_BYTES + 1)
    if len(data) > s.MAX_UPLOAD_BYTES:
        raise AppError("VALIDATION_ERROR", s.MEDIA_MESSAGES["tooLarge"])
    return {"asset": await _svc(request, db).upload(ctx, data, upload.filename or None)}


@tenant.delete("/assets/{asset_id}", status_code=204, dependencies=[require_permission("site.edit")])
async def delete_asset(asset_id: str, ctx: Tenant, request: Request, db: Db):
    await _svc(request, db).remove(ctx, asset_id)
    return Response(status_code=204)


# Stored images at `/media/<key>` (same origin as the page, so a strict CSP still allows them).
# Keys are immutable, so responses are cached for a year.
public = APIRouter(tags=["media"])
_STOCK_NAME = re.compile(r"^[a-z]+-(hero|about)\.webp$")


@public.get("/media/stock/{name}")
async def stock_image(name: str, request: Request):
    """Bundled template photos, for the template picker's preview (D-069). Fixed names only."""
    path = Path(request.app.state.settings.SITE_STOCK_DIR) / name
    body = None
    if _STOCK_NAME.match(name):
        body = await asyncio.to_thread(lambda: path.read_bytes() if path.is_file() else None)
    if body is None:
        return Response("Not found", status_code=404, headers={"cache-control": "no-store"})
    return Response(
        body,
        media_type="image/webp",
        headers={"cache-control": "public, max-age=86400", "x-content-type-options": "nosniff"},
    )


@public.get("/media/{key:path}")
async def media_image(key: str, request: Request):
    body = await request.app.state.storage.get(key) if IMAGE_KEY.match(key) else None
    if body is None:
        return Response(
            "Not found", status_code=404, media_type="text/plain", headers={"cache-control": "no-store"}
        )
    return Response(
        body,
        media_type="image/webp",
        headers={
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'",
        },
    )
