from datetime import UTC, datetime


def iso(dt: datetime) -> str:
    """ISO-8601 UTC with milliseconds and a Z, like JavaScript's Date#toISOString()."""
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def now_ms() -> datetime:
    """Now, truncated to milliseconds (the precision of the database's timestamp columns), so a
    value returned right after a write equals the value read back later."""
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)
