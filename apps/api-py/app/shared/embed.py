"""Behaviour tracking helpers (packages/shared/src/embed.ts): labels are normalised so a caller can
never store free text other than a page path."""

import re
from urllib.parse import urlsplit

BEHAVIOR_EVENTS = ("page", "landing", "device", "click", "scroll", "form", "cta", "section", "sclick")


def normalize_cta_name(value: str | None) -> str:
    """The name of a counted button: plain text, one line, at most 40 characters; empty means not
    countable."""
    s = re.sub(r"[\u0000-\u001f\u007f]+", " ", value or "")
    s = re.sub(r"\s+", " ", s).strip()[:40]
    return s.strip()


def normalize_page_path(value: str | None) -> str:
    """A page address as one stable label: path only, no query or trailing slash, at most 100
    characters."""
    if not value:
        return "/"
    path = value
    if re.match(r"^https?://", value, re.I):
        try:
            path = urlsplit(value).path or "/"
        except ValueError:
            path = value
    path = re.split(r"[?#]", path)[0] or "/"
    if not path.startswith("/"):
        path = f"/{path}"
    if len(path) > 1:
        path = re.sub(r"/+$", "", path)
    return (path or "/")[:100]


def section_label(path: str | None, name: str | None) -> str:
    """A section as one label: its page path and name, at most 100 characters in all."""
    n = normalize_cta_name(name)
    return f"{normalize_page_path(path)[:59]}#{n}" if n else ""
