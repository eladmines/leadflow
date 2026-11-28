"""F35 automatic follow-ups (D-213, D-214, D-216): port of the timing and title helpers in
packages/shared/src/tasks.ts (`quoteFollowUpDueAt`, `appointmentConfirmDueAt`, `autoTaskTitles`).

Keep the rules and the titles byte-for-byte identical to the shared package; the parity test in
tests/test_task_automations.py replays the shared test vectors.
"""

from collections.abc import Callable
from datetime import datetime, timedelta

from app.core.timezone import date_in_zone, zoned_time_to_utc

TASK_AUTO_KINDS = ("quote_followup", "appointment_confirm")
QUOTE_FOLLOWUP = "quote_followup"
APPOINTMENT_CONFIRM = "appointment_confirm"

# Wall-clock time (business time zone) of automatic follow-ups (D-214).
AUTO_TASK_TIME = "09:00"
# Days after a quote is sent that its follow-up is due (D-213).
QUOTE_FOLLOW_UP_DAYS = 2


def add_days(date: str, days: int) -> str:
    """A `YYYY-MM-DD` moved by `days` calendar days (negative = earlier)."""
    return (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")


def weekday_of(date: str) -> int:
    """Day of the week of a `YYYY-MM-DD`, like JavaScript's `getUTCDay()`: 0 = Sunday … 6 = Saturday."""
    return (datetime.strptime(date, "%Y-%m-%d").weekday() + 1) % 7


def _is_weekend(date: str) -> bool:
    """D-216 (1): Friday and Saturday are not work days for automatic tasks."""
    return weekday_of(date) in (5, 6)


def _sunday_after(date: str) -> str:
    return add_days(date, 7 - weekday_of(date))


def _thursday_before(date: str) -> str:
    return add_days(date, 4 - weekday_of(date))


def quote_follow_up_due_at(sent_at: datetime, tz: str) -> datetime:
    """09:00 on the second calendar day after the send day; Friday/Saturday → the following Sunday."""
    day = add_days(date_in_zone(sent_at, tz), QUOTE_FOLLOW_UP_DAYS)
    if _is_weekend(day):
        day = _sunday_after(day)
    return zoned_time_to_utc(day, AUTO_TASK_TIME, tz)


def appointment_confirm_due_at(starts_at: datetime, now: datetime, tz: str) -> datetime | None:
    """09:00 the day before the appointment. A Friday/Saturday day-before moves to the following
    Sunday 09:00 when that is still before the start, else back to the Thursday 09:00 before. Past
    → `now`. An appointment today or earlier → `None` (no task at booking time)."""
    start_day = date_in_zone(starts_at, tz)
    if start_day <= date_in_zone(now, tz):
        return None
    day_before = add_days(start_day, -1)
    due = zoned_time_to_utc(day_before, AUTO_TASK_TIME, tz)
    if _is_weekend(day_before):
        sunday = zoned_time_to_utc(_sunday_after(day_before), AUTO_TASK_TIME, tz)
        due = (
            sunday
            if sunday < starts_at
            else zoned_time_to_utc(_thursday_before(day_before), AUTO_TASK_TIME, tz)
        )
    return due if due > now else now


def _he_confirm(details: str | None = None) -> str:
    return f"לאשר את התור: {details}" if details else "לאשר את התור"


def _en_confirm(details: str | None = None) -> str:
    return f"Confirm the appointment: {details}" if details else "Confirm the appointment"


# Titles of automatic tasks in the business's language (stored on the task; a person may rename it).
AUTO_TASK_TITLES: dict[str, dict[str, Callable[..., str]]] = {
    "he": {
        QUOTE_FOLLOWUP: lambda number: f"לחזור לגבי הצעה #{number}",
        APPOINTMENT_CONFIRM: _he_confirm,
    },
    "en": {
        QUOTE_FOLLOWUP: lambda number: f"Follow up on quote #{number}",
        APPOINTMENT_CONFIRM: _en_confirm,
    },
}


def titles_for(language: str | None) -> dict[str, Callable[..., str]]:
    return AUTO_TASK_TITLES["en" if language == "en" else "he"]
