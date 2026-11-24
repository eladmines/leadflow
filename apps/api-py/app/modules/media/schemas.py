"""F05 media contract (packages/shared/src/media.ts)."""

from typing import Any

from pydantic import BaseModel

MEDIA_PATH = "/media"
STOCK_MEDIA_PATH = "/media/stock"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ACCEPTED_IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_IMAGE_EDGE = 1920

MEDIA_MESSAGES = {
    "tooLarge": "הקובץ גדול מדי (עד 8MB)",
    "wrongType": "אפשר להעלות רק תמונות JPG, PNG או WebP",
    "unreadable": "לא הצלחנו לקרוא את התמונה. נסו קובץ אחר",
    "quotaExceeded": "נגמר מקום האחסון של העסק. מחקו תמונות שלא בשימוש",
    "inUse": "התמונה בשימוש באתר. הסירו אותה מהאתר לפני המחיקה",
    "foreignAsset": "אחת התמונות אינה שייכת לעסק",
    "noFile": "לא נבחר קובץ",
}


class AssetOut(BaseModel):
    id: str
    url: str
    width: int
    height: int
    sizeBytes: int
    originalName: str | None
    createdAt: str


class AssetResponse(BaseModel):
    asset: AssetOut


class AssetListResponse(BaseModel):
    assets: list[AssetOut]
    usedBytes: int
    quotaBytes: int


def referenced_asset_ids(draft: dict[str, Any]) -> list[str]:
    """Every asset id a site draft references (theme logo, hero/about images, gallery)."""
    ids: dict[str, None] = {}
    theme = draft.get("theme") or {}
    if isinstance(theme, dict) and theme.get("logoAssetId"):
        ids[theme["logoAssetId"]] = None
    sections = list(draft.get("sections") or [])
    for page in draft.get("pages") or []:
        sections.extend(page.get("sections") or [] if isinstance(page, dict) else [])
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        if isinstance(sec.get("imageAssetId"), str):
            ids[sec["imageAssetId"]] = None
        if sec.get("type") == "gallery" and isinstance(sec.get("items"), list):
            for item in sec["items"]:
                if isinstance(item, dict) and isinstance(item.get("assetId"), str):
                    ids[item["assetId"]] = None
    return list(ids)
