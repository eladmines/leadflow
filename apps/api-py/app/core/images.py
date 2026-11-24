"""Decodes an upload for real (the declared MIME type and file name are not trusted), then
re-encodes it: auto-rotate, fit within MAX_IMAGE_EDGE, WebP, all metadata (EXIF/GPS) stripped.

Port of apps/api/src/lib/images.ts (sharp → Pillow)."""

import io
import re
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError
from app.modules.media.schemas import MAX_IMAGE_EDGE, MEDIA_MESSAGES

Image.MAX_IMAGE_PIXELS = 50_000_000
ACCEPTED_FORMATS = {"JPEG", "PNG", "WEBP"}
_SVG = re.compile(rb"^\s*(<\?xml[^>]*>\s*)?(<!--.*?-->\s*)*<svg[\s>]", re.I | re.S)


@dataclass
class ProcessedImage:
    data: bytes
    width: int
    height: int
    mime: str = "image/webp"


def process_image(raw: bytes) -> ProcessedImage:
    if _SVG.match(raw[:2048].lstrip(b"\xef\xbb\xbf")):
        raise AppError("VALIDATION_ERROR", MEDIA_MESSAGES["wrongType"])  # could carry script
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError) as err:
        raise AppError("VALIDATION_ERROR", MEDIA_MESSAGES["unreadable"]) from err
    if fmt not in ACCEPTED_FORMATS:
        raise AppError("VALIDATION_ERROR", MEDIA_MESSAGES["wrongType"])

    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img) or img
        img.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.Resampling.LANCZOS)  # inside, never enlarges
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() or img.mode == "P" else "RGB")
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=82)  # no exif/icc passed: metadata stays out
        return ProcessedImage(data=out.getvalue(), width=img.width, height=img.height)
    except (OSError, ValueError, Image.DecompressionBombError) as err:
        raise AppError("VALIDATION_ERROR", MEDIA_MESSAGES["unreadable"]) from err
