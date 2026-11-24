"""Automatic replies and statuses (D-123, D-166). Every customer message gets the general reply;
when the business is "at an event" (or another status), the status's message instead. Never to
personal numbers, paused customers, or a chat a team member wrote in recently.
Port of apps/api/src/modules/whatsapp/auto-reply.ts."""

import io
import uuid
from datetime import datetime
from typing import Any

from PIL import Image

from app.errors import AppError
from app.shared import whatsapp as w

ReplyMode = str


def mode_of(raw: str | None) -> str:
    return raw if raw in w.REPLY_MODES else "auto_reply"


def language_of(raw: str | None) -> str:
    """A business's language as stored (D-143); anything else is Hebrew."""
    return "en" if raw == "en" else "he"


def _valid_status(s: Any) -> bool:
    return (
        isinstance(s, dict)
        and isinstance(s.get("id"), str)
        and isinstance(s.get("label"), str)
        and isinstance(s.get("text"), str)
        and (s.get("videoKey") is None or isinstance(s["videoKey"], str))
        and (
            s.get("videoBytes") is None
            or (isinstance(s["videoBytes"], int) and not isinstance(s["videoBytes"], bool))
        )
    )


def statuses_of(raw: Any, lang: str = "he") -> list[dict[str, Any]]:
    """The business's statuses; the ready-made ones (in its language) until it saves its own list."""
    if isinstance(raw, list) and all(_valid_status(s) for s in raw):
        return [dict(s) for s in raw]
    return w.status_presets_for(lang)


def questions_of(raw: Any) -> list[dict[str, str]]:
    """The owner's own event questions (none stored or invalid = the built-in questions)."""
    if isinstance(raw, list) and all(
        isinstance(q, dict) and isinstance(q.get("id"), str) and isinstance(q.get("text"), str) for q in raw
    ):
        return [{"id": q["id"], "text": q["text"]} for q in raw]
    return []


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def active_of(raw: Any, statuses: list[dict[str, Any]], now: datetime) -> dict[str, Any] | None:
    """The status on now, if it still exists and hasn't ended."""
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
        return None
    until = raw.get("until")
    if until is not None and not isinstance(until, str):
        return None
    status = next((s for s in statuses if s["id"] == raw["id"]), None)
    if status is None:
        return None
    if until and _parse_iso(until) <= now:
        return None
    return {"status": status, "until": until}


def status_dtos(statuses: list[dict[str, Any]]) -> list[w.StatusOut]:
    return [
        w.StatusOut(id=s["id"], label=s["label"], text=s["text"], preset=s["id"] in w.STATUS_PRESET_IDS)
        for s in statuses
    ]


def merge_statuses(
    old: list[dict[str, Any]], nxt: list[w.ReplyStatus]
) -> tuple[list[dict[str, Any]], list[str]]:
    """A saved list: keeps each status's video by id; returns the videos to delete."""
    merged: list[dict[str, Any]] = []
    for s in nxt:
        prev = next((o for o in old if o["id"] == s.id), None)
        item = {"id": s.id, "label": s.label, "text": s.text}
        if prev and prev.get("videoKey"):
            item["videoKey"] = prev["videoKey"]
            if prev.get("videoBytes") is not None:
                item["videoBytes"] = prev["videoBytes"]
        merged.append(item)
    dropped = [
        o["videoKey"] for o in old if o.get("videoKey") and not any(m["id"] == o["id"] for m in merged)
    ]
    return merged, dropped


def to_whatsapp_jpeg(file: bytes) -> bytes:
    """A library photo as WhatsApp takes it: JPEG, at most 1600 px (the library keeps WebP)."""
    img = Image.open(io.BytesIO(file))
    img.load()
    img.thumbnail((1600, 1600))
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.getchannel("A"))
        img = bg
    else:
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def is_mp4(b: bytes) -> bool:
    """MP4 (ISO media) files carry "ftyp" at byte 4."""
    return len(b) > 12 and b[4:8] == b"ftyp"


def showcase_object(raw: Any) -> dict[str, Any]:
    """The stored showcase JSON as an object (null/invalid = empty)."""
    return dict(raw) if isinstance(raw, dict) else {}


def showcase_video_of(raw: Any) -> dict[str, Any] | None:
    """The "meanwhile" video kept next to the showcase settings (server-only fields)."""
    o = showcase_object(raw)
    key, size = o.get("videoKey"), o.get("videoBytes")
    if isinstance(key, str) and isinstance(size, int) and not isinstance(size, bool):
        return {"key": key, "bytes": size}
    return None


def check_showcase_video(business_id: uuid.UUID, video: bytes) -> str:
    """Checks the "meanwhile" video (D-151) and returns where to store it."""
    if not is_mp4(video):
        raise AppError("VALIDATION_ERROR", w.M["videoInvalid"], {"video": w.M["videoInvalid"]})
    if len(video) > w.SHOWCASE_VIDEO_MAX_BYTES:
        raise AppError("VALIDATION_ERROR", w.M["videoTooLarge"], {"video": w.M["videoTooLarge"]})
    return f"{business_id}/{uuid.uuid4()}.mp4"


def reply_text_of(
    name: str,
    auto_reply_text: str | None,
    statuses_raw: Any,
    active_raw: Any,
    language: str,
    now: datetime,
) -> str:
    """The message a customer gets now: the active status's, else the general reply (D-123)."""
    lang = language_of(language)
    statuses = statuses_of(statuses_raw, lang)
    active = active_of(active_raw, statuses, now)
    text = (
        active["status"]["text"]
        if active
        else (auto_reply_text if auto_reply_text is not None else w.auto_reply_default_for(lang))
    )
    return text.replace("{business}", name)[:4096]
