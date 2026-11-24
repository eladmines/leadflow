"""Phone numbers (packages/shared/src/business.ts): normalised to E.164, Israeli rules exact.

ASCII-only digit classes, like the JavaScript originals.
"""

import re

_ALLOWED = re.compile(r"^\+?[0-9\s\-().]+$")
_ISRAELI_NATIONAL = re.compile(r"^([57][0-9]{8}|[23489][0-9]{7})$")

# Countries for the phone picker: ISO code and dialling code. Israel first; +1 resolves to the US.
PHONE_COUNTRIES: tuple[tuple[str, str], ...] = (
    ("IL", "972"), ("US", "1"), ("CA", "1"), ("GB", "44"), ("IE", "353"), ("FR", "33"),
    ("DE", "49"), ("ES", "34"), ("IT", "39"), ("PT", "351"), ("NL", "31"), ("BE", "32"),
    ("CH", "41"), ("AT", "43"), ("SE", "46"), ("NO", "47"), ("DK", "45"), ("FI", "358"),
    ("PL", "48"), ("CZ", "420"), ("HU", "36"), ("RO", "40"), ("GR", "30"), ("CY", "357"),
    ("UA", "380"), ("RU", "7"), ("TR", "90"), ("AE", "971"), ("SA", "966"), ("JO", "962"),
    ("EG", "20"), ("MA", "212"), ("ZA", "27"), ("IN", "91"), ("TH", "66"), ("SG", "65"),
    ("HK", "852"), ("JP", "81"), ("KR", "82"), ("CN", "86"), ("PH", "63"), ("AU", "61"),
    ("NZ", "64"), ("BR", "55"), ("MX", "52"), ("AR", "54"), ("CL", "56"), ("CO", "57"),
)  # fmt: skip


def _digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value)


def normalize_israeli_phone(raw: str) -> str | None:
    """050-1234567, 03-1234567, 0501234567, +972 50 123 4567, 972501234567 → +972…, or None."""
    trimmed = raw.strip()
    if not _ALLOWED.match(trimmed):
        return None
    has_plus = trimmed.startswith("+")
    digits = _digits(trimmed)
    if digits.startswith("972"):
        national = re.sub(r"^0", "", digits[3:])
    elif not has_plus and digits.startswith("0"):
        national = digits[1:]
    else:
        return None
    return f"+972{national}" if _ISRAELI_NATIONAL.match(national) else None


def _country_of(iso: str) -> tuple[str, str] | None:
    return next((c for c in PHONE_COUNTRIES if c[0] == iso), None)


def _country_by_digits(digits: str) -> tuple[str, str] | None:
    """The country whose dialling code starts these digits (longest code wins)."""
    for c in sorted(PHONE_COUNTRIES, key=lambda c: -len(c[1])):
        if digits.startswith(c[1]):
            return c
    return None


def normalize_phone(raw: str, country: str = "IL") -> str | None:
    """Any phone number to E.164, or None. Israeli numbers keep their exact rules (and local
    forms stay Israeli by default). Others: +<code> (or a local number with `country`), a
    leading trunk 0 dropped, 6-12 national digits."""
    trimmed = raw.strip()
    if not _ALLOWED.match(trimmed):
        return None
    international = trimmed.startswith("+") or bool(re.match(r"^00[1-9]", _digits(trimmed)))
    digits = _digits(trimmed)
    if not trimmed.startswith("+") and international:
        digits = digits[2:]

    match = _country_by_digits(digits) if international else _country_of(country)
    if match is None:
        return None
    iso, dial = match
    if iso == "IL" or (not international and country == "IL"):
        return normalize_israeli_phone(f"+{digits}" if international else trimmed)
    if dial == "1":
        iso, dial = _country_of("US") or match
    national = re.sub(r"^0", "", digits[len(dial) :] if international else digits)
    return f"+{dial}{national}" if re.fullmatch(r"[0-9]{6,12}", national) else None


def format_israeli_phone(e164: str) -> str:
    """E.164 to display form: Israeli numbers locally (+972501234567 → 050-1234567), others with
    their code (+447700900123 → +44 7700900123)."""
    if not e164.startswith("+972"):
        c = _country_by_digits(e164[1:]) if e164.startswith("+") else None
        return f"+{c[1]} {e164[1 + len(c[1]) :]}" if c else e164
    local = f"0{e164[4:]}"
    prefix = 3 if len(local) == 10 else 2
    return f"{local[:prefix]}-{local[prefix:]}"


def split_phone(e164: str | None) -> tuple[str | None, str]:
    """E.164 → its country and the national part for editing (Israeli numbers in local form)."""
    if not e164:
        return None, ""
    digits = _digits(e164)
    c = _country_by_digits(digits) if e164.startswith("+") else None
    if c is None:
        return None, e164
    if c[0] == "IL":
        return "IL", format_israeli_phone(e164)
    return ("US" if c[1] == "1" else c[0]), digits[len(c[1]) :]
