"""Starting content for a new site (packages/shared/src/site-templates*.ts).

Copy is realistic but generic; the owner edits it. The content lives in data/site_templates.json,
recorded from the TypeScript builders: they depend on the business only through its name, its
service areas and whether it has a phone, which the data marks with `$areas` and `$phone`.
"""

import copy
import json
from functools import cache
from pathlib import Path
from typing import Any

_DATA = Path(__file__).parent / "data" / "site_templates.json"
_NAME, _AREAS = "§N§", "§A§"

# A sample photo bundled with a template (D-069); the files live in the API's `assets/stock`.
STOCK_PHOTOS: dict[str, dict[str, dict[str, Any]]] = {
    "beauty": {
        "hero": {"file": "beauty-hero.webp", "width": 1600, "height": 1067, "alt": ""},
        "about": {
            "file": "beauty-about.webp",
            "width": 1600,
            "height": 1067,
            "alt": "עמדות עיצוב שיער במספרה",
        },
    },
    "trades": {
        "hero": {"file": "trades-hero.webp", "width": 1600, "height": 1067, "alt": ""},
        "about": {"file": "trades-about.webp", "width": 1600, "height": 1065, "alt": "עבודה בלוח חשמל"},
    },
    "garage": {
        "hero": {"file": "garage-hero.webp", "width": 1600, "height": 1067, "alt": ""},
        "about": {
            "file": "garage-about.webp",
            "width": 1600,
            "height": 1067,
            "alt": "מכונאי בודק מנוע של רכב",
        },
    },
    "clinic": {
        "hero": {"file": "clinic-hero.webp", "width": 1600, "height": 1067, "alt": ""},
        "about": {"file": "clinic-about.webp", "width": 1067, "height": 1600, "alt": "חדר טיפולים מואר"},
    },
    "food": {
        "hero": {"file": "food-hero.webp", "width": 1084, "height": 1600, "alt": ""},
        "about": {"file": "food-about.webp", "width": 1600, "height": 1067, "alt": "שולחן ארוחת בוקר ערוך"},
    },
}

STOCK_ABOUT_ALT_EN = {
    "beauty": "Hair styling stations in a salon",
    "trades": "Work on an electrical panel",
    "garage": "A mechanic checking a car's engine",
    "clinic": "A bright treatment room",
    "food": "A table set for breakfast",
}


@cache
def _templates() -> dict[str, Any]:
    return json.loads(_DATA.read_text(encoding="utf-8"))


def _resolve(node: Any, name: str, areas: str, has_areas: bool, has_phone: bool) -> Any:
    if isinstance(node, dict):
        if "$areas" in node:
            return _resolve(node["$areas" if has_areas else "$noAreas"], name, areas, has_areas, has_phone)
        if "$phone" in node:
            return _resolve(node["$phone" if has_phone else "$noPhone"], name, areas, has_areas, has_phone)
        return {k: _resolve(v, name, areas, has_areas, has_phone) for k, v in node.items()}
    if isinstance(node, list):
        return [_resolve(v, name, areas, has_areas, has_phone) for v in node]
    if isinstance(node, str):
        return node.replace(_NAME, name).replace(_AREAS, areas)
    return node


def build_template_draft(template_key: str, b: dict[str, Any], lang: str = "he") -> dict[str, Any]:
    """Starting content for a new site, in the site's language (D-142). Ids are deterministic per
    template (unique within the site); sections added later get random ids."""
    areas = ", ".join(b["serviceAreas"]) if b["serviceAreas"] else ""
    draft = _resolve(
        copy.deepcopy(_templates()[f"{lang}/{template_key}"]), b["name"], areas, bool(areas), bool(b["phone"])
    )
    # Cut to the Google limits after the name went in (the original slices the finished strings).
    draft["seo"]["title"] = b["name"][:70]
    draft["seo"]["description"] = draft["seo"]["description"][:160]
    return draft


def with_template_photos(draft: dict[str, Any], ids: dict[str, str]) -> dict[str, Any]:
    """Puts photo ids on the template's hero and about sections (first of each)."""
    photos = STOCK_PHOTOS[draft["templateKey"]]
    hero = about = False
    sections = []
    for s in draft["sections"]:
        if s["type"] == "hero" and not hero and ids.get("hero"):
            hero = True
            s = {**s, "imageAssetId": ids["hero"]}
        elif s["type"] == "about" and not about and ids.get("about"):
            about = True
            alt = (
                STOCK_ABOUT_ALT_EN[draft["templateKey"]]
                if draft["theme"].get("language") == "en"
                else photos["about"]["alt"]
            )
            s = {**s, "imageAssetId": ids["about"], "imageAlt": alt}
        sections.append(s)
    return {**draft, "sections": sections}
