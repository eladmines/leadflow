"""F26: where a lead came from (packages/shared/src/attribution.ts).

Website leads: read from the landing URL (click ids, utm_*) and the referrer by the public site
server, kept in a first-party cookie until the form is sent. WhatsApp/Messenger leads: Meta's ad
`referral`. Only names are kept: never a click id's value, never personal data.
"""

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

ATTRIBUTION_SOURCES = (
    "google_ads",
    "google",
    "meta_ads",
    "meta",
    "tiktok",
    "microsoft_ads",
    "utm",
    "referral",
    "direct",
)
ATTRIBUTION_SOURCE_LABELS = {
    "google_ads": "Google Ads",
    "google": "גוגל (חיפוש)",
    "meta_ads": "מודעות פייסבוק / אינסטגרם",
    "meta": "פייסבוק / אינסטגרם",
    "tiktok": "TikTok",
    "microsoft_ads": "Microsoft Ads",
    "utm": "קמפיין אחר",
    "referral": "אתר אחר",
    "direct": "ישיר",
}
UNKNOWN_SOURCE_LABEL = "לא ידוע"
CLICK_ID_TYPES = ("gclid", "fbclid", "ttclid", "msclkid", "ctwa")

# Text fields and their maximum length (trimmed, then cut).
_TEXT_FIELDS = {
    "utmSource": 60,
    "medium": 60,
    "campaign": 100,
    "term": 100,
    "content": 100,
    "referrerHost": 100,
    "landingPath": 100,
    "adId": 40,
    "adHeadline": 120,
}
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_attribution(value: Any) -> dict[str, Any] | None:
    """The attribution contract. Stored JSON that doesn't fit reads as "unknown" (None); a bad
    optional field is dropped rather than failing the whole value."""
    if not isinstance(value, dict):
        return None
    if value.get("source") not in ATTRIBUTION_SOURCES:
        return None
    seen = value.get("seenAt")
    if not isinstance(seen, str) or not _DATETIME.match(seen):
        return None
    out: dict[str, Any] = {"source": value["source"], "seenAt": seen}
    for key, limit in _TEXT_FIELDS.items():
        v = value.get(key)
        if isinstance(v, str):
            out[key] = v.strip()[:limit]
    if value.get("clickIdType") in CLICK_ID_TYPES:
        out["clickIdType"] = value["clickIdType"]
    return out


def attribution_name(a: dict[str, Any]) -> str:
    """Name to show: the utm_source or referring host when that's what we know."""
    if a["source"] == "utm" and a.get("utmSource"):
        return a["utmSource"]
    if a["source"] == "referral" and a.get("referrerHost"):
        return re.sub(r"^www\.", "", a["referrerHost"])
    return ATTRIBUTION_SOURCE_LABELS[a["source"]]


_PAID = re.compile(r"^(cpc|ppc|paid|paidsocial|paid_social|paid-social|cpm|ads?|display|sponsored)$", re.I)
_META_UTM = ("facebook", "instagram", "fb", "ig", "meta")


def _host_is(host: str, *names: str) -> bool:
    return any(host == n or host.endswith(f".{n}") or host.startswith(f"{n}.") for n in names)


def _is_google(h: str) -> bool:
    return bool(re.search(r"(^|\.)google\.[a-z.]+$", h))


def _is_meta(h: str) -> bool:
    return _host_is(h, "facebook.com", "fb.com", "instagram.com", "messenger.com") or bool(
        re.search(r"(^|\.)(l|lm|m)\.facebook\.com$", h)
    )


def classify_attribution(
    params: dict[str, str | None],
    referrer: str | None = None,
    self_host: str | None = None,
    landing_path: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Names the source of a visit (the table in F26.md)."""

    def p(key: str) -> str | None:
        v = (params.get(key) or "").strip()
        return v or None

    referrer_host: str | None = None
    try:
        parts = urlsplit(referrer) if referrer else None
        # `new URL(x)` throws for anything without a scheme; a host-less URL reads as no host.
        referrer_host = parts.hostname.lower() if parts and parts.scheme and parts.hostname else None
    except ValueError:
        referrer_host = None
    if referrer_host and self_host and referrer_host == self_host.lower().split(":")[0]:
        referrer_host = None

    utm_source = (p("utm_source") or "").lower() or None
    medium = p("utm_medium")
    paid = bool(medium and _PAID.match(medium))
    if p("gclid") or p("gbraid") or p("wbraid"):
        click_id = "gclid"
    elif p("fbclid"):
        click_id = "fbclid"
    elif p("ttclid"):
        click_id = "ttclid"
    elif p("msclkid"):
        click_id = "msclkid"
    else:
        click_id = None

    if click_id == "gclid" or (utm_source == "google" and paid):
        source = "google_ads"
    elif click_id == "ttclid" or utm_source == "tiktok":
        source = "tiktok"
    elif click_id == "msclkid" or utm_source in ("bing", "microsoft"):
        source = "microsoft_ads"
    elif (utm_source in _META_UTM and paid) or (click_id == "fbclid" and paid):
        source = "meta_ads"
    elif click_id == "fbclid" or utm_source in _META_UTM:
        # fbclid is added to every outbound Facebook link, ads or not: without a paid medium
        # it's a post.
        source = "meta"
    elif utm_source == "google":
        source = "google"
    elif utm_source:
        source = "utm"
    elif referrer_host and _is_google(referrer_host):
        source = "google"
    elif referrer_host and _is_meta(referrer_host):
        source = "meta"
    elif referrer_host:
        source = "referral"  # any other site: shown by its host
    else:
        source = "direct"

    raw = {
        "source": source,
        "seenAt": _iso(now or datetime.now(UTC)),
        "utmSource": p("utm_source") if source == "utm" else None,
        "medium": medium,
        "campaign": p("utm_campaign"),
        "term": p("utm_term"),
        "content": p("utm_content"),
        "clickIdType": click_id,
        "referrerHost": referrer_host,
        "landingPath": landing_path.split("?")[0] if landing_path else None,
    }
    parsed = parse_attribution({k: v for k, v in raw.items() if v is not None})
    assert parsed is not None
    return parsed


def is_campaign_visit(a: dict[str, Any]) -> bool:
    """A visit that came from an ad or a tagged link: it replaces an earlier one (F26)."""
    return bool(a.get("clickIdType") or a.get("campaign") or a["source"] == "utm" or a.get("medium"))


def attribution_from_meta_referral(
    referral: dict[str, Any], now: datetime | None = None
) -> dict[str, Any] | None:
    """Meta's "Click to WhatsApp" / Messenger ad referral → attribution (only ad names kept)."""
    ad_id = next((v for v in (referral.get("source_id"), referral.get("ad_id")) if isinstance(v, str)), None)
    # A shared post or a link to the chat also sends a referral; only ads count.
    if referral.get("source_type") != "ad" and "ctwa_clid" not in referral:
        return None
    raw = {
        "source": "meta_ads",
        "seenAt": _iso(now or datetime.now(UTC)),
        "clickIdType": "ctwa" if "ctwa_clid" in referral else None,
        "adId": ad_id,
        "adHeadline": referral["headline"] if isinstance(referral.get("headline"), str) else None,
    }
    return parse_attribution({k: v for k, v in raw.items() if v is not None})
