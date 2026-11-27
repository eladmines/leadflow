"""F34 custom lead fields (D-203, D-204): port of packages/shared/src/leadFields.ts.

Keep the limits and the Hebrew messages byte-for-byte identical to the shared package. JavaScript
semantics are mirrored where they differ from Python's: string length counts UTF-16 code units,
`\\s`/`trim()` use JavaScript's whitespace set, `\\d` is ASCII only, comparisons are strict
(`true !== 1`) and numbers in messages are formatted like `String(n)`.

Custom values can be personal data: never log them or put them on a span.
"""

import datetime
import math
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

LEAD_FIELD_TYPES = ("text", "number", "date", "select", "boolean")
LeadFieldType = Literal["text", "number", "date", "select", "boolean"]

MAX_ACTIVE_LEAD_FIELDS = 20
LEAD_FIELD_LABEL_MAX = 40
LEAD_FIELD_OPTIONS_MIN = 2
LEAD_FIELD_OPTIONS_MAX = 30
LEAD_FIELD_OPTIONS_TOTAL_MAX = 100
LEAD_FIELD_OPTION_LABEL_MAX = 60
LEAD_FIELD_OPTION_ID_MAX = 40
LEAD_FIELD_TEXT_MAX = 500
LEAD_FIELD_NUMBER_ABS_MAX = 1_000_000_000_000
MAX_CUSTOM_FIELD_KEYS = 100
MAX_LEAD_FIELD_FILTERS = MAX_ACTIVE_LEAD_FIELDS
LEAD_FIELD_FILTER_VALUE_MAX = 100


def js_number_str(n: float | int) -> str:
    """JavaScript's `String(n)` for a finite number (`1000`, `2.5`, `1e-7`, `1e+21`)."""
    if isinstance(n, int) and not isinstance(n, bool) and abs(n) < 10**21:
        return str(n)
    x = float(n)
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    d = Decimal(repr(abs(x))).normalize()
    t = d.as_tuple()
    digits = "".join(str(c) for c in t.digits)
    k = len(digits)
    e = int(t.exponent)  # value = digits * 10**e
    p = k + e  # JavaScript's `n`: the position of the decimal point
    if k <= p <= 21:
        out = digits + "0" * (p - k)
    elif 0 < p <= 21:
        out = digits[:p] + "." + digits[p:]
    elif -6 < p <= 0:
        out = "0." + "0" * (-p) + digits
    else:
        exp = p - 1
        mant = digits if k == 1 else digits[0] + "." + digits[1:]
        out = f"{mant}e{'+' if exp >= 0 else '-'}{abs(exp)}"
    return sign + out


def js_len(s: str) -> int:
    """`String.prototype.length`: UTF-16 code units."""
    # `surrogatepass`: a lone surrogate counts as one unit, as in JavaScript, instead of raising.
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


# JavaScript's `\s` (WhiteSpace + LineTerminator), as used by `trim()` and regex `\s`.
_JS_WS = "\t\n\v\f\r    -     　﻿"
_JS_TRIM = re.compile(f"^[{_JS_WS}]+|[{_JS_WS}]+$")
_JS_NEWLINES = re.compile(f"[{_JS_WS}]*[\r\n]+[{_JS_WS}]*")


def js_trim(s: str) -> str:
    return _JS_TRIM.sub("", s)


# Characters Postgres can't store (NUL in text/jsonb) or encode (a lone UTF-16 surrogate: JSON can
# carry `"\ud800"`, UTF-8 can't). JavaScript strings allow both, so the shared validator doesn't
# check them; shared `hasInvalidCharacters` refuses them with `invalidCharacters` (QA-F34-03).
_UNSTORABLE = re.compile("[\x00\ud800-\udfff]")


def has_unstorable_chars(s: str) -> bool:
    """`hasInvalidCharacters`: a decoded str holds valid surrogate pairs as one code point, so any
    surrogate left is a lone one."""
    return _UNSTORABLE.search(s) is not None


def safe_key(s: str) -> str:
    """A client-sent key echoed in an error body, with unencodable characters replaced."""
    return _UNSTORABLE.sub("\ufffd", s)


def is_finite_within(n: int | float, limit: int | float) -> bool:
    """`Number.isFinite(n) && Math.abs(n) <= limit`, without converting a huge int to a float
    (`math.isfinite(10**400)` raises OverflowError; JSON can carry such integers, QA-F34-02)."""
    if isinstance(n, int):
        return abs(n) <= limit
    return math.isfinite(n) and abs(n) <= limit


def js_lower(s: str) -> str:
    """Close to `toLocaleLowerCase()` for labels (case-insensitive uniqueness)."""
    return s.lower()


LEAD_FIELD_MESSAGES: dict[str, str] = {
    # Definitions (Settings → Lead fields)
    "labelRequired": "יש להזין שם לשדה",
    "labelTooLong": f"שם השדה יכול להכיל עד {LEAD_FIELD_LABEL_MAX} תווים",
    "labelTaken": "כבר יש שדה פעיל בשם הזה",
    "typeInvalid": "יש לבחור סוג שדה",
    "typeLocked": "אי אפשר לשנות את סוג השדה. אפשר ליצור שדה חדש במקומו",
    "optionsCount": (
        f"לשדה בחירה צריכות להיות בין {LEAD_FIELD_OPTIONS_MIN} ל-{LEAD_FIELD_OPTIONS_MAX} אפשרויות"
    ),
    "optionsTotal": "יש יותר מדי אפשרויות בארכיון של השדה הזה",
    "optionsNotAllowed": "רק לשדה בחירה יש אפשרויות",
    "optionLabelRequired": "יש להזין טקסט לאפשרות",
    "optionLabelTooLong": f"אפשרות יכולה להכיל עד {LEAD_FIELD_OPTION_LABEL_MAX} תווים",
    "optionDuplicate": "יש שתי אפשרויות עם אותו שם",
    "optionUnknown": "אחת האפשרויות אינה שייכת לשדה הזה",
    "rangeNotAllowed": "טווח ערכים אפשרי רק לשדה מספר",
    "rangeInvalid": "הערך המינימלי גדול מהמקסימלי",
    "numberInvalid": "יש להזין מספר",
    "booleanNotRequired": "שדה סימון לא יכול להיות שדה חובה",
    "tooManyFields": f"אפשר עד {MAX_ACTIVE_LEAD_FIELDS} שדות פעילים. העבירו שדה לארכיון כדי להוסיף חדש",
    "orderDuplicate": "שדה מופיע פעמיים ברשימה",
    "orderStale": "רשימת השדות השתנתה. רעננו את הדף ונסו שוב",
    # Values (a lead's customFields)
    "valuesInvalid": "השדות הנוספים אינם תקינים",
    "tooManyValues": "יש יותר מדי שדות נוספים בבקשה",
    "valueUnknownField": "השדה הזה לא קיים בעסק",
    "valueArchivedField": "השדה הועבר לארכיון ואי אפשר לעדכן אותו",
    "valueRequired": "זהו שדה חובה",
    "valueText": "יש להזין טקסט",
    "valueTextTooLong": f"הטקסט ארוך מדי (עד {LEAD_FIELD_TEXT_MAX} תווים)",
    "valueNumber": "יש להזין מספר",
    "valueDate": "יש להזין תאריך תקין",
    "valueOption": "יש לבחור אחת מהאפשרויות",
    "valueBoolean": "יש לסמן או לבטל את הסימון",
    # List filters
    "filterInvalid": "הסינון לפי שדה נוסף אינו תקין",
    # Any text (labels, option labels, text values, text filters): NUL or a lone UTF-16 surrogate.
    "invalidCharacters": "הטקסט מכיל תווים לא תקינים. מחקו אותם ונסו שוב",
}
M = LEAD_FIELD_MESSAGES


def value_number_min(n: float | int) -> str:
    return f"המספר צריך להיות לפחות {js_number_str(n)}"


def value_number_max(n: float | int) -> str:
    return f"המספר צריך להיות לכל היותר {js_number_str(n)}"


# ---------------------------------------------------------------------------- values

CustomFieldValue = str | int | float | bool


@dataclass
class LeadFieldOptionRule:
    id: str
    archived: bool = False


@dataclass
class LeadFieldRule:
    """What the value check needs from a definition (`LeadFieldRule` in the shared package)."""

    id: str
    type: str
    required: bool = False
    min: float | int | None = None
    max: float | int | None = None
    archived: bool = False
    options: list[LeadFieldOptionRule] = field(default_factory=list)


@dataclass
class ValidationResult:
    ok: bool
    values: dict[str, Any] = field(default_factory=dict)
    # Keys are `customFields.<fieldId>` (or `customFields`), as in the API's error body.
    fields: dict[str, str] = field(default_factory=dict)


_DATE_RE = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})\Z")
_NUMBER_RE = re.compile(r"^-?[0-9]+(\.[0-9]+)?\Z")


def is_valid_iso_date(s: str) -> bool:
    """A real calendar date as `YYYY-MM-DD`. Mirrors `Date.UTC`, which maps years 0–99 to
    1900–1999 (so those are refused there, and here)."""
    m = _DATE_RE.match(s)
    if not m:
        return False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        return False
    try:
        datetime.date(y, mo, d)
    except ValueError:
        return False
    return True


def is_number(v: Any) -> bool:
    """`typeof v === 'number'`."""
    return isinstance(v, int | float) and not isinstance(v, bool)


def plain_number(n: int | float) -> int | float:
    """Whole numbers as int, so they're stored and sent as JSON integers."""
    if isinstance(n, float) and n.is_integer():
        return int(n)
    return n


def same_value(a: Any, b: Any) -> bool:
    """JavaScript's `===` for stored values (no `true == 1`)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if is_number(a) or is_number(b):
        return is_number(a) and is_number(b) and a == b
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    return a is None and b is None


def normalize_custom_field_value(rule: LeadFieldRule, raw: Any) -> tuple[bool, Any]:
    """`(True, value)` (`None` = no value) or `(False, message)`. Ignores required and archiving."""
    if raw is None:
        return True, None
    t = rule.type
    if t == "text":
        if not isinstance(raw, str):
            return False, M["valueText"]
        s = js_trim(_JS_NEWLINES.sub(" ", raw))
        if not s:
            return True, None
        if has_unstorable_chars(s):
            return False, M["invalidCharacters"]
        if js_len(s) > LEAD_FIELD_TEXT_MAX:
            return False, M["valueTextTooLong"]
        return True, s
    if t == "number":
        if is_number(raw):
            n: float | int = raw
        elif isinstance(raw, str):
            s = js_trim(raw)
            if not s:
                return True, None
            if not _NUMBER_RE.match(s):
                return False, M["valueNumber"]
            n = float(s)
        else:
            return False, M["valueNumber"]
        if not is_finite_within(n, LEAD_FIELD_NUMBER_ABS_MAX):
            return False, M["valueNumber"]
        if rule.min is not None and n < rule.min:
            return False, value_number_min(rule.min)
        if rule.max is not None and n > rule.max:
            return False, value_number_max(rule.max)
        return True, plain_number(n)
    if t == "date":
        if not isinstance(raw, str):
            return False, M["valueDate"]
        s = js_trim(raw)
        if not s:
            return True, None
        return (True, s) if is_valid_iso_date(s) else (False, M["valueDate"])
    if t == "select":
        if not isinstance(raw, str):
            return False, M["valueOption"]
        s = js_trim(raw)
        if not s:
            return True, None
        opt = next((o for o in rule.options if o.id == s), None)
        return (True, s) if opt and not opt.archived else (False, M["valueOption"])
    if t == "boolean":
        # Unticked = no value (D-204): only `true` is stored.
        if not isinstance(raw, bool):
            return False, M["valueBoolean"]
        return True, (True if raw else None)
    return False, M["valuesInvalid"]


def validate_custom_fields(
    rules: list[LeadFieldRule],
    raw_input: Any,
    *,
    mode: Literal["create", "update"],
    from_app: bool,
    existing: dict[str, Any] | None = None,
) -> ValidationResult:
    """`validateCustomFields`: checks a lead's `customFields` against one business's definitions
    (active and archived). 'create' drops empty values; 'update' returns a patch (`None` removes).
    """
    fields: dict[str, str] = {}
    raw = {} if raw_input is None else raw_input
    if not isinstance(raw, dict):
        return ValidationResult(ok=False, fields={"customFields": M["valuesInvalid"]})
    if len(raw) > MAX_CUSTOM_FIELD_KEYS:
        return ValidationResult(ok=False, fields={"customFields": M["tooManyValues"]})
    by_id = {r.id: r for r in rules}
    stored = existing or {}
    out: dict[str, Any] = {}

    for key, value in raw.items():
        path = f"customFields.{safe_key(key)}"
        rule = by_id.get(key)
        if rule is None:
            fields[path] = M["valueUnknownField"]
            continue
        # A stored value sent back unchanged is always fine (archived field or option included).
        if mode == "update" and key in stored and same_value(stored[key], value):
            out[key] = value
            continue
        if rule.archived:
            fields[path] = M["valueArchivedField"]
            continue
        ok, checked = normalize_custom_field_value(rule, value)
        if not ok:
            fields[path] = checked
            continue
        if checked is None and from_app and rule.required:
            fields[path] = M["valueRequired"]
            continue
        if checked is not None or mode == "update":
            out[key] = checked

    if mode == "create" and from_app:
        for rule in rules:
            path = f"customFields.{rule.id}"
            if rule.required and not rule.archived and out.get(rule.id) is None and path not in fields:
                fields[path] = M["valueRequired"]

    if fields:
        return ValidationResult(ok=False, fields=fields)
    return ValidationResult(ok=True, values=out)


def apply_custom_fields_patch(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """`applyCustomFieldsPatch`: `None` removes a key."""
    nxt = dict(existing)
    for key, value in patch.items():
        if value is None:
            nxt.pop(key, None)
        else:
            nxt[key] = value
    return nxt


def diff_custom_fields(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """`diffCustomFields`: changes in key order of `after`, then removed keys."""
    changes: list[dict[str, Any]] = []
    for field_id, to in after.items():
        frm = before.get(field_id)
        if not same_value(frm, to):
            changes.append({"fieldId": field_id, "from": frm, "to": to})
    for field_id, frm in before.items():
        if field_id not in after:
            changes.append({"fieldId": field_id, "from": frm, "to": None})
    return changes


# ---------------------------------------------------------------------------- list filters

LEAD_FIELD_FILTER_PARAM_RE = re.compile(
    r"^cf\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\](?:\[(from|to)\])?\Z", re.I
)


def parse_lead_field_filter_params(params: list[tuple[str, str]]) -> dict[str, dict[str, str]]:
    """`parseLeadFieldFilterParams`: `cf[...]` pairs → `{fieldId: {value|from|to}}`; other params
    and empty values are ignored."""
    out: dict[str, dict[str, str]] = {}
    for key, raw in params:
        m = LEAD_FIELD_FILTER_PARAM_RE.match(key)
        value = js_trim(raw)
        if not m or not value:
            continue
        fid = m.group(1).lower()
        part = m.group(2) or "value"
        out.setdefault(fid, {})[part] = value
    return out
