"""Free times for booking (D-102), on the server, in the business's time zone.

A start time is free when the whole appointment fits inside that day's opening hours, it is far
enough ahead, and at least one active team member has no REQUESTED/CONFIRMED appointment
overlapping it: the same rule the clash check applies when booking.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import add_days_to, zoned_time_to_utc
from app.db.models import Appointment, AppointmentStatus, Membership, MembershipStatus
from app.shared.business import WEEKDAYS, OpeningHours

SLOT_STEP_MIN = 30
MIN_NOTICE_MIN = 60  # how soon a customer can book (minutes from now)

DEFAULT_OPENING_HOURS: dict[str, dict[str, Any]] = {
    "sun": {"open": True, "from": "09:00", "to": "18:00"},
    "mon": {"open": True, "from": "09:00", "to": "18:00"},
    "tue": {"open": True, "from": "09:00", "to": "18:00"},
    "wed": {"open": True, "from": "09:00", "to": "18:00"},
    "thu": {"open": True, "from": "09:00", "to": "18:00"},
    "fri": {"open": True, "from": "09:00", "to": "13:00"},
    "sat": {"open": False, "from": "09:00", "to": "18:00"},
}


@dataclass
class FreeTime:
    time: str  # HH:MM, wall clock in the business's time zone
    starts_at: datetime
    staff_id: Any  # a team member who is free then (the least busy that day)


@dataclass
class BusinessInfo:
    id: Any
    timezone: str
    opening_hours: Any


def _to_min(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def _to_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def today_in(tz: str, now: datetime | None = None) -> str:
    from app.core.timezone import date_in_zone

    return date_in_zone(now or datetime.now(UTC), tz)


def _hours_of(business: BusinessInfo) -> dict[str, Any]:
    try:
        return OpeningHours.model_validate(business.opening_hours).model_dump(by_alias=True)
    except Exception:
        return DEFAULT_OPENING_HOURS


def _day_hours(hours: dict[str, Any], date: str) -> tuple[int, int] | None:
    """Opening hours of a date, in minutes from midnight; None when closed."""
    d = datetime.strptime(date, "%Y-%m-%d")
    h = hours[WEEKDAYS[(d.weekday() + 1) % 7]]  # WEEKDAYS starts on Sunday
    return (_to_min(h["from"]), _to_min(h["to"])) if h["open"] else None


async def free_times(
    db: AsyncSession,
    business: BusinessInfo,
    dates: list[str],
    duration_min: int,
    now: datetime | None = None,
) -> dict[str, list[FreeTime]]:
    """Free start times for each date in `dates`, using one query for the whole range."""
    out: dict[str, list[FreeTime]] = {d: [] for d in dates}
    if not dates:
        return out
    now = now or datetime.now(UTC)
    hours = _hours_of(business)
    tz = business.timezone
    staff = [
        r[0]
        for r in await db.execute(
            select(Membership.user_id)
            .where(Membership.business_id == business.id, Membership.status == MembershipStatus.ACTIVE)
            .order_by(Membership.created_at.asc())
        )
    ]
    if not staff:
        return out

    range_start = zoned_time_to_utc(dates[0], "00:00", tz)
    range_end = zoned_time_to_utc(add_days_to(dates[-1], 1), "00:00", tz)
    booked = (
        await db.execute(
            select(Appointment.staff_id, Appointment.starts_at, Appointment.ends_at).where(
                Appointment.business_id == business.id,
                Appointment.staff_id.in_(staff),
                Appointment.status.in_([AppointmentStatus(s) for s in ("REQUESTED", "CONFIRMED")]),
                Appointment.starts_at < range_end,
                Appointment.ends_at > range_start,
            )
        )
    ).all()
    earliest = now + timedelta(minutes=MIN_NOTICE_MIN)

    for date in dates:
        open_ = _day_hours(hours, date)
        if not open_:
            continue
        day_start = zoned_time_to_utc(date, "00:00", tz)
        day_end = zoned_time_to_utc(add_days_to(date, 1), "00:00", tz)
        load = dict.fromkeys(staff, 0)
        for staff_id, starts, ends in booked:
            if starts < day_end and ends > day_start:
                load[staff_id] = load.get(staff_id, 0) + 1
        by_load = sorted(staff, key=lambda s: load[s])  # stable: ties keep membership order
        listing = out[date]
        m = open_[0]
        while m + duration_min <= open_[1]:
            starts_at = zoned_time_to_utc(date, _to_hhmm(m), tz)
            m += SLOT_STEP_MIN
            if starts_at < earliest:
                continue
            ends_at = starts_at + timedelta(minutes=duration_min)
            free = next(
                (
                    s
                    for s in by_load
                    if not any(b[0] == s and b[1] < ends_at and b[2] > starts_at for b in booked)
                ),
                None,
            )
            if free:
                listing.append(FreeTime(time=_to_hhmm(m - SLOT_STEP_MIN), starts_at=starts_at, staff_id=free))
    return out
