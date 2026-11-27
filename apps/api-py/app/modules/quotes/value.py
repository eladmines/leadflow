"""A lead's value from its quotes (D-207, D-208, D-210; `leadValueSchema` in packages/shared).

- `won` = the sum of all the lead's ACCEPTED quotes.
- `open` = the total of the lead's latest sent quote only (greatest `sent_at` among quotes that
  were ever sent, falling back to `created_at` for old rows without it; ties → higher number),
  counted only while it is still SENT and not expired in the business's time zone.

Amounts are quote `totals.total` in agorot, summed per lead and rounded half-up to whole shekels
once (`agorotToShekels`). The expiry rule is the quote's `expired` flag (`quote_expired`).
"""

import datetime as dt
import uuid
from dataclasses import dataclass
from datetime import UTC
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import date_in_zone
from app.db.models import Business, Quote, QuoteStatus, StageKind
from app.modules.quotes.schemas import quote_totals


def quote_expired(
    status: QuoteStatus, valid_until: dt.date | None, timezone: str, now: dt.datetime | None = None
) -> bool:
    """A sent quote whose validity date is before today in the business's time zone."""
    return (
        status == QuoteStatus.SENT
        and valid_until is not None
        and valid_until.isoformat() < date_in_zone(now or dt.datetime.now(UTC), timezone)
    )


def agorot_to_shekels(agorot: int) -> int:
    """Agorot → whole shekels, half-up (non-negative amounts only)."""
    return (agorot + 50) // 100


def quote_total(items: Any, discount: int, vat_rate: Any) -> int:
    """The quote's `totals.total` in agorot (after discount, incl. VAT); 0 for malformed items."""
    rows = []
    for i in items if isinstance(items, list) else []:
        if not (isinstance(i, dict) and {"quantity", "unitPrice"} <= i.keys()):
            return 0
        rows.append(i)
    return quote_totals(rows, discount, float(vat_rate))["total"]


@dataclass(frozen=True)
class LeadValue:
    won: int = 0
    open: int = 0
    # Whether the lead has an accepted quote at all (a purchase's value is null without one).
    has_accepted: bool = False

    def for_stage_kind(self, kind: StageKind) -> int:
        """`leadValueForStageKind`: open for OPEN stages, won for WON, nothing for LOST."""
        return self.won if kind == StageKind.WON else self.open if kind == StageKind.OPEN else 0


ZERO = LeadValue()


async def lead_values(
    db: AsyncSession,
    business_id: uuid.UUID,
    lead_ids: list[uuid.UUID],
    now: dt.datetime | None = None,
) -> dict[uuid.UUID, LeadValue]:
    """Values for these leads of this business, in one query. Leads without a qualifying quote
    are absent (use `ZERO`)."""
    if not lead_ids:
        return {}
    ever_sent = (Quote.status != QuoteStatus.DRAFT) | Quote.sent_at.is_not(None)
    ranked = (
        select(
            Quote.lead_id,
            Quote.status,
            Quote.items,
            Quote.discount,
            Quote.vat_rate,
            Quote.valid_until,
            func.row_number()
            .over(
                partition_by=Quote.lead_id,
                order_by=(func.coalesce(Quote.sent_at, Quote.created_at).desc(), Quote.number.desc()),
            )
            .label("rn"),
        )
        .where(Quote.business_id == business_id, Quote.lead_id.in_(lead_ids), ever_sent)
        .subquery()
    )
    rows = await db.execute(
        select(
            ranked.c.lead_id,
            ranked.c.status,
            ranked.c["items"],
            ranked.c.discount,
            ranked.c.vat_rate,
            ranked.c.valid_until,
            ranked.c.rn,
            Business.timezone,
        )
        .select_from(ranked)
        .join(Business, Business.id == business_id)
        .where((ranked.c.status == QuoteStatus.ACCEPTED) | (ranked.c.rn == 1))
    )
    won: dict[uuid.UUID, int] = {}
    open_: dict[uuid.UUID, int] = {}
    for lead_id, status, items, discount, vat_rate, valid_until, rn, timezone in rows:
        total = quote_total(items, discount, vat_rate)
        if status == QuoteStatus.ACCEPTED:
            won[lead_id] = won.get(lead_id, 0) + total
        if rn == 1 and status == QuoteStatus.SENT and not quote_expired(status, valid_until, timezone, now):
            open_[lead_id] = total
    return {
        lid: LeadValue(
            won=agorot_to_shekels(won.get(lid, 0)),
            open=agorot_to_shekels(open_.get(lid, 0)),
            has_accepted=lid in won,
        )
        for lid in won.keys() | open_.keys()
    }
