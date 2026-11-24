"""F32: what visitors do on a website with the embed script, as counts: business × local day ×
kind × label. No visitor id, no IP, no sequence of pages. Labels are checked per kind."""

import re
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.embed import normalize_cta_name, normalize_page_path, section_label

# Distinct kind/label combinations kept per business per day (a guard against junk page paths).
MAX_ROWS_PER_DAY = 500

ONE_OF: dict[str, tuple[str, ...]] = {
    "device": ("mobile", "tablet", "desktop"),
    "click": ("phone", "whatsapp", "email"),
    "scroll": ("50", "90"),
    "form": ("start",),
}


def device_of(ua: str | None) -> str:
    """The device class from the user agent (a site without the script can't read the window
    width)."""
    agent = ua or ""
    if re.search(r"ipad|tablet|kindle|silk|playbook", agent, re.I) or (
        re.search(r"android", agent, re.I) and not re.search(r"mobile", agent, re.I)
    ):
        return "tablet"
    if re.search(r"mobi|iphone|ipod|android|windows phone", agent, re.I):
        return "mobile"
    return "desktop"


def event_label(kind: str, label: str | None) -> str | None:
    """The label to store, or None when the event isn't acceptable."""
    if kind in ("page", "landing"):
        return normalize_page_path(label)
    if kind == "cta":
        return normalize_cta_name(label) or None
    if kind in ("section", "sclick"):
        # `<path>#<name>`: rebuilt from its parts, so the stored label is always clean and short.
        text_ = label or ""
        at = text_.find("#")
        return (section_label(text_[:at], text_[at + 1 :]) or None) if at >= 0 else None
    allowed = ONE_OF.get(kind)
    return label if allowed and label is not None and label in allowed else None


async def record_events(
    db: AsyncSession, business_id: uuid.UUID, day: str, events: list[tuple[str, str | None]]
) -> None:
    for kind, raw in events:
        label = event_label(kind, raw)
        if label is None:
            continue
        await db.execute(
            text(
                """
                INSERT INTO event_counts (business_id, day, kind, label, count)
                SELECT CAST(:b AS uuid), CAST(:day AS varchar), CAST(:kind AS varchar), CAST(:label AS varchar), 1
                WHERE (SELECT count(*) FROM event_counts WHERE business_id = CAST(:b AS uuid) AND day = CAST(:day AS varchar)) < CAST(:max AS int)
                  OR EXISTS (
                    SELECT 1 FROM event_counts
                    WHERE business_id = CAST(:b AS uuid) AND day = CAST(:day AS varchar) AND kind = CAST(:kind AS varchar) AND label = CAST(:label AS varchar)
                  )
                ON CONFLICT (business_id, day, kind, label)
                DO UPDATE SET count = event_counts.count + 1"""
            ),
            {"b": business_id, "day": day, "kind": kind, "label": label, "max": MAX_ROWS_PER_DAY},
        )
    await db.commit()
