"""Date text for emails, in the business's language and time zone (replaces Intl.DateTimeFormat)."""

from datetime import datetime
from zoneinfo import ZoneInfo

_HE_DAYS = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]  # Monday first
_HE_MONTHS = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
]  # fmt: skip
_EN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_EN_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]  # fmt: skip


def format_full(dt: datetime, tz: str, lang: str) -> str:
    """Full date and short time: 'יום שלישי, 27 באוקטובר 2026 בשעה 10:00' or
    'Tuesday 27 October 2026 at 10:00'."""
    try:
        local = dt.astimezone(ZoneInfo(tz))
    except Exception:
        local = dt
    time = f"{local.hour:02d}:{local.minute:02d}"
    wd = local.weekday()
    if lang == "en":
        return f"{_EN_DAYS[wd]} {local.day} {_EN_MONTHS[local.month - 1]} {local.year} at {time}"
    return f"יום {_HE_DAYS[wd]}, {local.day} ב{_HE_MONTHS[local.month - 1]} {local.year} בשעה {time}"


def format_short(dt: datetime, tz: str) -> str:
    """Short date and time as Hebrew ICU writes it: '1.11.2026, 11:05'."""
    try:
        local = dt.astimezone(ZoneInfo(tz))
    except Exception:
        local = dt
    return f"{local.day}.{local.month}.{local.year}, {local.hour:02d}:{local.minute:02d}"
