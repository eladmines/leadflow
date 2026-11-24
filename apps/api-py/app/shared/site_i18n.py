"""The fixed texts a customer website shows (menu, form, buttons, hours, result pages), in the
site's language (D-142). Data lives in data/site_i18n.json."""

import json
from functools import cache
from pathlib import Path
from typing import Any

_DATA = Path(__file__).parent / "data" / "site_i18n.json"


@cache
def _all() -> dict[str, dict[str, Any]]:
    return json.loads(_DATA.read_text(encoding="utf-8"))


def site_text(lang: str | None) -> dict[str, Any]:
    """The fixed texts for a site in this language (Hebrew when unset: sites made before D-142)."""
    return _all()[lang or "he"]


def fill(text: str, value: str | int) -> str:
    """Fills `{0}` in a site text (the first one only, like the original)."""
    return text.replace("{0}", str(value), 1)


def site_error(lang: str | None, message: str) -> str:
    """A form error in the site's language (shared schemas write them in Hebrew)."""
    return site_text(lang)["errors"].get(message, message)
