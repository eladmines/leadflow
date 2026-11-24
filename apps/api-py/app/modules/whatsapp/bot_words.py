"""What the booking bot says, in the business's language (D-143), and the date wording the
customer sees. Port of WORDS in apps/api/src/modules/whatsapp/bot.ts; dates reproduce ICU's
`he-IL` / `en-GB` output (hard-coded, like the rest of the port)."""

from datetime import date as _date
from typing import Any

HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]  # Sunday first
HE_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"]
HE_MONTHS = [
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
]
EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
EN_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


def _parts(day: str) -> tuple[int, int, int, int]:
    d = _date.fromisoformat(day)
    return d.year, d.month, d.day, (d.weekday() + 1) % 7  # Sunday = 0


def short_day(lang: str, day: str) -> str:
    """weekday short, day and month numeric: `יום ה׳, 12.11` / `Thu 12/11`."""
    _, m, d, wd = _parts(day)
    if lang == "en":
        return f"{EN_WEEKDAYS[wd][:3]} {d:02d}/{m:02d}"
    wname = HE_SHORT[wd] if wd == 6 else f"יום {HE_SHORT[wd]}"
    return f"{wname}, {d}.{m}"


def long_day(lang: str, day: str) -> str:
    """`יום חמישי, 12 בנובמבר` / `Thursday 12 November`."""
    _, m, d, wd = _parts(day)
    if lang == "en":
        return f"{EN_WEEKDAYS[wd]} {d} {EN_MONTHS[m - 1]}"
    return f"יום {HE_WEEKDAYS[wd]}, {d} ב{HE_MONTHS[m - 1]}"


def event_day(lang: str, day: str) -> str:
    """With the year: `יום חמישי, 12 בנובמבר 2026` / `Thursday, 12 November 2026`."""
    y, m, d, wd = _parts(day)
    if lang == "en":
        return f"{EN_WEEKDAYS[wd]}, {d} {EN_MONTHS[m - 1]} {y}"
    return f"יום {HE_WEEKDAYS[wd]}, {d} ב{HE_MONTHS[m - 1]} {y}"


class Words:
    """The bot's wording for one language: plain strings and small formatters."""

    def __init__(self, lang: str, table: dict[str, Any]) -> None:
        self.lang = lang
        self._t = table

    def __getattr__(self, name: str) -> Any:
        try:
            return self._t[name]
        except KeyError as e:
            raise AttributeError(name) from e


_HE: dict[str, Any] = {
    "human": "דברו עם הצוות",
    "seeOurWork": "📸 העבודות שלנו",
    "guests": ["עד 50", "50–150", "150–300", "300+", "עוד לא יודעים"],
    "parts": {"day": "צהריים", "evening": "ערב", "unknown": "עוד לא יודעים"},
    "at": lambda day, time: f"{day} בשעה {time}",
    "cancelledEvent": "בוטל. כשתרצו, פשוט כתבו לנו כאן 🙂",
    "cancelled": 'בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂',
    "chooseService": "בחירת שירות",
    "minutes": lambda n: f"{n} דק׳",
    "serviceGone": "השירות הזה כבר לא זמין. ",
    "whichDay": "באיזה יום נוח לכם?",
    "chooseDay": "בחירת יום",
    "today": lambda d: f"היום · {d}",
    "tomorrow": lambda d: f"מחר · {d}",
    "freeTimes": lambda n: "זמן פנוי אחד" if n == 1 else f"{n} זמנים פנויים",
    "dayFull": "היום הזה כבר התמלא. ",
    "whichTime": lambda day: f"באיזו שעה? ({day})",
    "chooseTime": "בחירת שעה",
    "otherDay": "יום אחר",
    "appointment": "תור",
    "confirm": lambda what, at: f"לקבוע לכם {what} ב{at}?",
    "yesBook": "כן, לקבוע",
    "otherTime": "שעה אחרת",
    "cancel": "ביטול",
    "timeTaken": "אופס, השעה הזו נתפסה הרגע. ",
    "notUnderstood": 'לא הבנתי 🙂 בחרו מהרשימה, או כתבו "נציג" כדי לדבר עם הצוות.\n\n',
    "notUnderstoodEvent": 'לא הבנתי 🙂 בחרו מהאפשרויות, או כתבו "נציג" כדי לדבר עם הצוות.\n\n',
    "whichAreaEvent": "באיזה אזור או עיר יהיה האירוע?",
    "questionsTask": lambda name: f"שאלון מוואטסאפ: {name}",
    "questionsNote": "תשובות מהשאלון בוואטסאפ",
    "questionsThanks": "תודה רבה על כל התשובות! 🙏\nנחזור אליכם בהקדם.",
    "checkDate": "📅 לבדוק תאריך",
    "personalChat": "💬 שיחה אישית",
    "from": lambda price: f"החל מ־₪{price}",
    "chooseType": "בחירת סוג",
    "optionGone": "האפשרות הזו כבר לא זמינה. ",
    "great": lambda type_: f"{type_}, מעולה! 🎉\n",
    "whichDate": "לאיזה תאריך? כתבו אותו כאן, למשל 14.2.2027",
    "badDate": "לא הצלחתי להבין את התאריך 🙂 כתבו אותו כך: 14.2.2027",
    "otherDate": "תאריך אחר",
    "dateFree": lambda day: f"{day} — התאריך פנוי 👍\nבאיזה חלק של היום?",
    "howManyGuests": "כמה אורחים בערך?",
    "guestsButton": "מספר אורחים",
    "whichArea": "ובאיזה אזור או עיר?",
    "guestsLine": lambda g: f"אורחים: {g}",
    "areaLine": lambda a: f"אזור: {a}",
    "summary": lambda lines: f"לסיכום:\n{lines}\n\nלשלוח את הבקשה?",
    "yesSend": "כן, לשלוח",
    "change": "לשנות",
    "fromWhatsApp": "בקשה מוואטסאפ",
    "event": "אירוע",
    "theEvent": "האירוע",
    "bookHere": "כשתרצו, אפשר לקבוע תור כאן 👇",
    "bookButton": "📅 לקביעת תור",
    "nothingToCancel": "לא מצאנו תור קרוב לבטל 🙂 רוצים לקבוע תור?",
    "whichToCancel": "איזה תור לבטל?",
    "chooseAppointment": "בחירת תור",
    "confirmCancel": lambda service, at: (
        f"לבטל את התור ל{service} ב{at}?" if service else f"לבטל את התור ב{at}?"
    ),
    "yesCancel": "כן, לבטל",
    "keepIt": "לא, להשאיר",
    "kept": "מעולה, התור נשאר 👍",
    "apptCancelled": "התור בוטל ✅\nרוצים לקבוע מועד אחר? אפשר כאן 👇",
    "bookNew": "📅 תור חדש",
    "talkButton": "מתי נוח לדבר?",
    "todayAt": lambda time: f"היום ב־{time}",
    "tomorrowAt": lambda time: f"מחר ב־{time}",
    "anotherTime": "זמן אחר",
    "askOtherTime": "מתי נוח לכם? כתבו יום ושעה 🙂",
    "callbackSet": lambda when: f"מעולה! נחזור אליכם {when} 🙏",
    "callbackThanks": "תודה! נחזור אליכם בזמן שכתבתם 🙏",
    "callbackTask": lambda name, when: f"לחזור ל{name} — {when}",
    "callbackNote": "שיחה חוזרת (נקבעה בוואטסאפ)",
}

_EN: dict[str, Any] = {
    "human": "Talk to the team",
    "seeOurWork": "📸 Our work",
    "guests": ["Up to 50", "50–150", "150–300", "300+", "Don't know yet"],
    "parts": {"day": "Afternoon", "evening": "Evening", "unknown": "Don't know yet"},
    "at": lambda day, time: f"{day} at {time}",
    "cancelledEvent": "Cancelled. Whenever you like, just write to us here 🙂",
    "cancelled": 'Cancelled. Whenever you want to book, just write "book" 🙂',
    "chooseService": "Choose a service",
    "minutes": lambda n: f"{n} min",
    "serviceGone": "That service is no longer available. ",
    "whichDay": "Which day suits you?",
    "chooseDay": "Choose a day",
    "today": lambda d: f"Today · {d}",
    "tomorrow": lambda d: f"Tomorrow · {d}",
    "freeTimes": lambda n: "One free time" if n == 1 else f"{n} free times",
    "dayFull": "That day has just filled up. ",
    "whichTime": lambda day: f"What time? ({day})",
    "chooseTime": "Choose a time",
    "otherDay": "Another day",
    "appointment": "an appointment",
    "confirm": lambda what, at: f"Book {what} on {at}?",
    "yesBook": "Yes, book it",
    "otherTime": "Another time",
    "cancel": "Cancel",
    "timeTaken": "Oops, that time was just taken. ",
    "notUnderstood": 'Sorry, I didn\'t get that 🙂 Choose from the list, or write "agent" to talk to the team.\n\n',
    "notUnderstoodEvent": 'Sorry, I didn\'t get that 🙂 Choose one of the options, or write "agent" to talk to the team.\n\n',
    "whichAreaEvent": "Which area or town will the event be in?",
    "questionsTask": lambda name: f"WhatsApp questionnaire: {name}",
    "questionsNote": "Answers from the WhatsApp questions",
    "questionsThanks": "Thank you for all the answers! 🙏\nWe'll get back to you soon.",
    "checkDate": "📅 Check a date",
    "personalChat": "💬 Personal chat",
    "from": lambda price: f"From ₪{price}",
    "chooseType": "Choose a type",
    "optionGone": "That option is no longer available. ",
    "great": lambda type_: f"{type_}, great! 🎉\n",
    "whichDate": "Which date? Write it here, for example 14/2/2027",
    "badDate": "I couldn't understand the date 🙂 Write it like this: 14/2/2027",
    "otherDate": "Another date",
    "dateFree": lambda day: f"{day} — the date is free 👍\nWhich part of the day?",
    "howManyGuests": "About how many guests?",
    "guestsButton": "Number of guests",
    "whichArea": "And which area or town?",
    "guestsLine": lambda g: f"Guests: {g}",
    "areaLine": lambda a: f"Area: {a}",
    "summary": lambda lines: f"To sum up:\n{lines}\n\nSend the request?",
    "yesSend": "Yes, send",
    "change": "Change",
    "fromWhatsApp": "Request from WhatsApp",
    "event": "Event",
    "theEvent": "the event",
    "bookHere": "Whenever you like, you can book here 👇",
    "bookButton": "📅 Book now",
    "nothingToCancel": "We couldn't find an upcoming appointment to cancel 🙂 Would you like to book one?",
    "whichToCancel": "Which appointment should we cancel?",
    "chooseAppointment": "Choose",
    "confirmCancel": lambda service, at: (
        f"Cancel your {service} appointment on {at}?" if service else f"Cancel your appointment on {at}?"
    ),
    "yesCancel": "Yes, cancel",
    "keepIt": "No, keep it",
    "kept": "Great, your appointment stays 👍",
    "apptCancelled": "Your appointment is cancelled ✅\nWant another time? You can book here 👇",
    "bookNew": "📅 New booking",
    "talkButton": "When can we talk?",
    "todayAt": lambda time: f"Today at {time}",
    "tomorrowAt": lambda time: f"Tomorrow at {time}",
    "anotherTime": "Another time",
    "askOtherTime": "When suits you? Write a day and time 🙂",
    "callbackSet": lambda when: f"Great! We'll get back to you {when.lower()} 🙏",
    "callbackThanks": "Thanks! We'll get back to you at the time you wrote 🙏",
    "callbackTask": lambda name, when: f"Call back {name} — {when}",
    "callbackNote": "Call back (set in WhatsApp)",
}

WORDS = {"he": Words("he", _HE), "en": Words("en", _EN)}
