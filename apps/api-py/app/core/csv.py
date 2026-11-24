"""CSV for spreadsheets (apps/api/src/lib/csv.ts): UTF-8 with a BOM (so Excel shows Hebrew), CRLF
rows, RFC 4180 quoting. Cells starting with = + - @ tab or CR are prefixed with ' so Excel never
runs them as formulas (CSV injection: a lead could type `=HYPERLINK(...)` into the website form)."""

import re
from collections.abc import Sequence
from typing import Any

_FORMULA_START = re.compile(r"^[=+\-@\t\r]")
_NEEDS_QUOTES = re.compile(r"[\",\r\n']")
BOM = "﻿"


def csv_cell(value: Any) -> str:
    if value is None:
        return ""
    s = str(value)
    if _FORMULA_START.match(s):
        s = f"'{s}"
    return f'"{s.replace(chr(34), chr(34) * 2)}"' if _NEEDS_QUOTES.search(s) else s


def to_csv(header: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    lines = [",".join(csv_cell(c) for c in r) for r in [header, *rows]]
    return BOM + "\r\n".join(lines) + "\r\n"
