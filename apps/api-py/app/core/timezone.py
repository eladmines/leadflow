"""Wall-clock times in a business's time zone (packages/shared/src/time.ts)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo("UTC")


def _offset_ms(utc_ms: float, tz: str) -> float:
    off = datetime.fromtimestamp(utc_ms / 1000, _zone(tz)).utcoffset()
    return (off.total_seconds() if off else 0) * 1000


def zoned_time_to_utc(date: str, time: str, tz: str) -> datetime:
    """A wall-clock date and time in a time zone (e.g. "2030-01-06", "09:30" in Asia/Jerusalem) as
    a UTC instant. Two passes handle the daylight-saving switch, exactly as the TypeScript does."""
    y, m, d = (int(x) for x in date.split("-"))
    h, mi = (int(x) for x in time.split(":"))
    wall = datetime(y, m, d, h, mi, tzinfo=UTC).timestamp() * 1000
    guess = wall - _offset_ms(wall, tz)
    guess = wall - _offset_ms(guess, tz)
    return datetime.fromtimestamp(guess / 1000, UTC)


def date_in_zone(instant: datetime, tz: str) -> str:
    """`YYYY-MM-DD` of an instant in a time zone."""
    return instant.astimezone(_zone(tz)).strftime("%Y-%m-%d")


def next_date(date: str) -> str:
    """The calendar day after a `YYYY-MM-DD`."""
    return (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")


def add_days_to(date: str, n: int) -> str:
    return (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")
