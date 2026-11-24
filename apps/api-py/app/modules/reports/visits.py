"""F31: website visits as counts: per business, local day, source, name and campaign. No visitor
id, no IP, no page list. Fed by SimpleCatch sites and by the embed script on other websites."""

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.attribution import attribution_name

_BOT = re.compile(
    r"bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime|curl|wget|python"
    r"|java/|go-http|axios|node-fetch|facebookexternalhit|whatsapp",
    re.I,
)

# Distinct source/campaign combinations kept per business per day (a guard against junk tags).
MAX_ROWS_PER_DAY = 300


def is_bot_agent(ua: str | None) -> bool:
    """Crawlers and link checkers don't count as visitors (no user agent is a bot too)."""
    return not ua or bool(_BOT.search(ua))


def visit_key(a: dict[str, Any]) -> tuple[str, str, str]:
    """What a visit is counted under: the same names the lead report uses (F26)."""
    named = a["source"] in ("utm", "referral")
    return (
        a["source"],
        (attribution_name(a) if named else "")[:100],
        (a.get("campaign") or a.get("adHeadline") or "")[:100],
    )


def local_day(timezone: str, now: datetime) -> str:
    """`YYYY-MM-DD` of an instant in a time zone."""
    try:
        return now.astimezone(ZoneInfo(timezone)).strftime("%Y-%m-%d")
    except Exception:
        return now.astimezone(UTC).strftime("%Y-%m-%d")


async def record_visit(
    db: AsyncSession,
    business_id: uuid.UUID,
    timezone: str,
    attribution: dict[str, Any],
    now: datetime | None = None,
) -> None:
    source, name, campaign = visit_key(attribution)
    day = local_day(timezone, now or datetime.now(UTC))
    await db.execute(
        text(
            """
            INSERT INTO visit_counts (business_id, day, source, name, campaign, count)
            SELECT CAST(:b AS uuid), CAST(:day AS varchar), CAST(:source AS varchar), CAST(:name AS varchar), CAST(:campaign AS varchar), 1
            WHERE (SELECT count(*) FROM visit_counts WHERE business_id = CAST(:b AS uuid) AND day = CAST(:day AS varchar)) < CAST(:max AS int)
              OR EXISTS (
                SELECT 1 FROM visit_counts
                WHERE business_id = CAST(:b AS uuid) AND day = CAST(:day AS varchar)
                  AND source = CAST(:source AS varchar) AND name = CAST(:name AS varchar) AND campaign = CAST(:campaign AS varchar)
              )
            ON CONFLICT (business_id, day, source, name, campaign)
            DO UPDATE SET count = visit_counts.count + 1"""
        ),
        {
            "b": business_id,
            "day": day,
            "source": source,
            "name": name,
            "campaign": campaign,
            "max": MAX_ROWS_PER_DAY,
        },
    )
    await db.commit()
