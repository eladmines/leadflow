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


_HE_DAY_SHORT = ["יום ב׳", "יום ג׳", "יום ד׳", "יום ה׳", "יום ו׳", "שבת", "יום א׳"]  # Monday first
_HE_MONTH_SHORT = [
    "בינו׳", "בפבר׳", "במרץ", "באפר׳", "במאי", "ביוני",
    "ביולי", "באוג׳", "בספט׳", "באוק׳", "בנוב׳", "בדצמ׳",
]  # fmt: skip
_EN_DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_EN_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]


def format_when(dt: datetime, tz: str, lang: str, with_time: bool = True) -> str:
    """Short weekday, day, month and (optionally) time: 'יום ה׳, 15 בינו׳, 12:05' or
    'Thu 15 Jan, 12:05' (as ICU writes them for he-IL and en-GB)."""
    try:
        local = dt.astimezone(ZoneInfo(tz))
    except Exception:
        local = dt
    wd = local.weekday()
    time = f", {local.hour:02d}:{local.minute:02d}" if with_time else ""
    if lang == "en":
        return f"{_EN_DAY_SHORT[wd]} {local.day} {_EN_MONTH_SHORT[local.month - 1]}{time}"
    return f"{_HE_DAY_SHORT[wd]}, {local.day} {_HE_MONTH_SHORT[local.month - 1]}{time}"
