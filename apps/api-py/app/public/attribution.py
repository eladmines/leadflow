"""F26: the `lf_src` cookie on a business's site (D-162): where the visit came from, until the form
is sent. Values only (source, campaign names, hosts, paths): no visitor id, no click id value."""

import base64
import json
from typing import Any
from urllib.parse import urlsplit

from starlette.requests import Request
from starlette.responses import Response

from app.shared.attribution import classify_attribution, is_campaign_visit, parse_attribution

ATTRIBUTION_COOKIE = "lf_src"
MAX_AGE_SECONDS = 30 * 86_400


def _encode(a: dict[str, Any]) -> str:
    return (
        base64.urlsafe_b64encode(json.dumps(a, separators=(",", ":"), ensure_ascii=False).encode())
        .rstrip(b"=")
        .decode()
    )


def read_attribution_cookie(request: Request) -> dict[str, Any] | None:
    """The visitor can change the cookie: anything that doesn't parse is ignored."""
    raw = request.cookies.get(ATTRIBUTION_COOKIE)
    if not raw or len(raw) > 2000:
        return None
    try:
        padded = raw + "=" * (-len(raw) % 4)
        return parse_attribution(json.loads(base64.urlsafe_b64decode(padded).decode()))
    except (ValueError, UnicodeDecodeError):
        return None


def remember_visit(
    request: Request, response: Response, landing_path: str, cookie_path: str, secure: bool
) -> tuple[dict[str, Any], bool]:
    """On a page view: an ad click or tagged link replaces what's stored; otherwise the first visit
    stays. Direct visits and the site's own pages set nothing (no cookie = direct). Returns what the
    visit counts under (F31) and whether it is an entry (from outside the site) rather than a move
    between the site's own pages."""
    host = request.headers.get("host", "")
    referer = request.headers.get("referer")
    visit = classify_attribution(dict(request.query_params), referer, host, landing_path)
    stored = read_attribution_cookie(request)
    ref_host = None
    try:
        ref_host = urlsplit(referer).netloc if referer else None
    except ValueError:
        ref_host = None
    entry = not (ref_host and ref_host == host)
    campaign = is_campaign_visit(visit)
    attribution = visit if campaign else (stored or visit)
    if visit["source"] == "direct":
        return attribution, entry
    if not campaign and stored:
        return attribution, entry
    response.set_cookie(
        ATTRIBUTION_COOKIE,
        _encode(visit),
        max_age=MAX_AGE_SECONDS,
        path=cookie_path,
        httponly=True,
        samesite="lax",
        secure=secure,
    )
    return visit, entry
