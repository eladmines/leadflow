"""F30: leads and ad tracking for a website built elsewhere (Wix, WordPress...): one script tag.

The script reads the ad click (`utm_*`, click ids) and the referrer on the landing page, keeps them in
the visitor's browser, and posts the lead form here with them. The server names the source with the
same rules as its own sites (F26); click id values are never stored. The key in the script is public
by design (like any form endpoint): it only lets leads in.

Public routes have no cookies. The lead endpoint takes a text/plain JSON body (a "simple"
cross-origin request, so no preflight) and always answers with CORS headers.
Port of apps/api/src/modules/embed/{routes,key}.ts.
"""

import asyncio
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select
from starlette.responses import JSONResponse, Response

from app.core.crypto import sha256_hex
from app.core.ratelimit import client_ip
from app.db.models import Business
from app.deps import Db, Tenant, require_permission, tenant_router
from app.errors import AppError
from app.modules.embed.key import create_embed_key, read_embed_key
from app.modules.leads.notify import notify_team_by_email
from app.modules.leads.schemas import parse_lead_submission
from app.modules.leads.service import LeadService
from app.modules.notifications.service import MANAGERS, notify_safe
from app.modules.reports.events import record_events
from app.modules.reports.visits import is_bot_agent, local_day, record_visit
from app.shared.attribution import classify_attribution
from app.shared.embed import BEHAVIOR_EVENTS
from app.shared.site_i18n import site_error

log = logging.getLogger("simplecatch")

SCRIPT_PATH = "/api/v1/embed/sc.js"
LEAD_PATH = "/api/v1/embed/lead"
VISIT_PATH = "/api/v1/embed/visit"
EVENT_PATH = "/api/v1/embed/event"
CORS = {"access-control-allow-origin": "*", "vary": "Origin"}
BODY_LIMIT = 16 * 1024
TRACKED_PARAMS = (
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid",
)  # fmt: skip
_ID = re.compile(r"^[A-Za-z0-9_-]{16,40}$")
_SCRIPT = (Path(__file__).resolve().parent.parent.parent / "shared" / "data" / "embed_script.js").read_text(
    encoding="utf-8"
)
_background: set[asyncio.Task] = set()


def pick_tracked_params(raw: dict[str, str] | None) -> dict[str, str]:
    """Keeps only the tracked parameters, trimmed (what the script and the server both accept)."""
    out: dict[str, str] = {}
    for k in TRACKED_PARAMS:
        v = ((raw or {}).get(k) or "").strip()
        if v:
            out[k] = v[:200]
    return out


class EmbedInfo(BaseModel):
    scriptUrl: str
    key: str
    snippet: str  # the `<script>` tag, ready to paste before `</body>`


# ------------------------------------------------------------------ the owner's script tag

tenant = tenant_router()


@tenant.get("/embed", response_model=EmbedInfo, dependencies=[require_permission("business.update")])
async def embed_info(ctx: Tenant, request: Request):
    settings = request.app.state.settings
    key = create_embed_key(settings.FORM_TOKEN_SECRET, ctx.business_id)
    script_url = f"{settings.app_url}{SCRIPT_PATH}"
    return {
        "scriptUrl": script_url,
        "key": key,
        "snippet": f'<script async src="{script_url}" data-key="{key}"></script>',
    }


# ------------------------------------------------------------------ public: the script and its endpoints

public = APIRouter(tags=["embed"])


@public.get(SCRIPT_PATH)
async def embed_script() -> Response:
    return Response(
        _SCRIPT,
        media_type="application/javascript; charset=utf-8",
        headers={"cache-control": "public, max-age=300", "access-control-allow-origin": "*"},
    )


def _answer(status: int, body: dict[str, Any]) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers=CORS)


async def _json_body(request: Request) -> Any:
    """A JSON string sent as text/plain, small. Anything else reads as None."""
    raw = await request.body()
    if len(raw) > BODY_LIMIT:
        return None
    try:
        return json.loads(raw.decode())
    except (ValueError, UnicodeDecodeError):
        return None


def _short(v: Any, limit: int) -> str | None:
    """`z.string().max(n).optional().catch(undefined)`: a bad value is dropped, not an error."""
    return v if isinstance(v, str) and len(v) <= limit else None


def _params(v: Any) -> dict[str, str] | None:
    if isinstance(v, dict) and all(isinstance(x, str) and len(x) <= 300 for x in v.values()):
        return v
    return None


def _key(v: Any) -> str | None:
    return v if isinstance(v, str) and 10 <= len(v) <= 120 else None


def _host_of(url: str | None) -> str | None:
    try:
        parts = urlsplit(url) if url else None
        return parts.netloc if parts and parts.scheme and parts.netloc else None
    except ValueError:
        return None


def _path_of(url: str | None) -> str | None:
    try:
        parts = urlsplit(url) if url else None
        return (parts.path or "/") if parts and parts.scheme and parts.netloc else None
    except ValueError:
        return None


def _attribution(body: dict[str, Any]) -> dict[str, Any]:
    return classify_attribution(
        pick_tracked_params(_params(body.get("params"))),
        _short(body.get("referrer"), 500),
        _host_of(_short(body.get("page"), 500)),
        _path_of(_short(body.get("landing"), 500)),
    )


def _rate_limited(request: Request, route: str, limit: int) -> bool:
    try:
        request.app.state.rate_limiter.hit(
            route, client_ip(request), limit, request.app.state.settings.LEAD_FORM_RATE_LIMIT_WINDOW / 1000
        )
        return False
    except AppError:
        return True


def _too_many() -> JSONResponse:
    return _answer(429, {"ok": False})


@public.post(LEAD_PATH)
async def embed_lead(request: Request, db: Db) -> JSONResponse:
    settings = request.app.state.settings
    if _rate_limited(request, "embed-lead", settings.LEAD_FORM_RATE_LIMIT_MAX):
        return _too_many()
    raw = await _json_body(request)
    if not isinstance(raw, dict):
        return _answer(400, {"ok": False})
    texts = {"name": 200, "phone": 60, "email": 300, "message": 3000, "consent": 10, "website": 200}
    if (
        _key(raw.get("key")) is None
        or not isinstance(raw.get("id"), str)
        or not _ID.match(raw["id"])
        or any(
            raw.get(k) is not None and not (isinstance(raw[k], str) and len(raw[k]) <= n)
            for k, n in texts.items()
        )
    ):
        return _answer(400, {"ok": False})
    business_id = read_embed_key(settings.FORM_TOKEN_SECRET, raw["key"])
    business = (
        (
            await db.execute(
                select(Business.id, Business.name, Business.language).where(Business.id == business_id)
            )
        ).first()
        if business_id
        else None
    )
    # A wrong key looks like any other bad request.
    if business is None:
        return _answer(400, {"ok": False})
    bid, bname, blang = business

    # Bots: pretend success, store nothing.
    if raw.get("website"):
        log.info("embed lead dropped", extra={"businessId": str(bid), "reason": "honeypot"})
        return _answer(200, {"ok": True})

    lang = "en" if blang == "en" else "he"
    # A form on the owner's own website: sending it is asking to be contacted (D-197).
    form = {k: raw[k] for k in ("name", "phone", "email", "message") if raw.get(k) is not None}
    data, errors = parse_lead_submission({**form, "consent": "on"})
    if data is None:
        return _answer(
            400, {"ok": False, "errors": list(dict.fromkeys(site_error(lang, m) for m in errors.values()))}
        )

    page = _short(raw.get("page"), 500)
    leads = LeadService(db)
    lead, created = await leads.create_from_website(
        business_id=bid,
        site_id=None,
        idempotency_key=raw["id"],
        ip_hash=sha256_hex(f"{client_ip(request)}|{settings.FORM_TOKEN_SECRET}"),
        source_url=(re.split(r"[?#]", page or "")[0])[:300] or "embed",
        # A direct visit keeps its landing page (F32 shows inquiries per landing page); Reports and
        # the leads filter read source "direct" as unknown.
        attribution=_attribution(raw),
        data=data,
    )
    if created:
        log.info("lead created from embed", extra={"businessId": str(bid), "leadId": lead.id})
        sessionmaker, email = request.app.state.sessionmaker, request.app.state.email

        async def notify() -> None:
            try:
                async with sessionmaker() as session:
                    await notify_team_by_email(session, email, settings, bid, bname, data)
            except Exception as err:
                log.error("lead notification failed", extra={"errName": type(err).__name__})

        task = asyncio.create_task(notify())
        _background.add(task)
        task.add_done_callback(_background.discard)
        await notify_safe(
            db,
            business_id=bid,
            type="lead.new",
            data={"leadId": lead.id, "name": lead.contact.name, "source": "website_form"},
            roles=MANAGERS,
        )
    return _answer(200, {"ok": True})


async def _counted_business(db: Any, raw: Any, secret: str) -> tuple[Any, ...] | None:
    key = _key(raw.get("key")) if isinstance(raw, dict) else None
    business_id = read_embed_key(secret, key) if key else None
    if business_id is None:
        return None
    return (
        await db.execute(select(Business.id, Business.timezone).where(Business.id == business_id))
    ).first()


@public.post(VISIT_PATH)
async def embed_visit(request: Request, db: Db) -> JSONResponse:
    """F31: a page view, once per browser session (the script keeps the flag). Counted, not stored."""
    settings = request.app.state.settings
    if _rate_limited(request, "embed-visit", settings.EMBED_VISIT_RATE_LIMIT_MAX):
        return _too_many()
    raw = await _json_body(request)
    business = await _counted_business(db, raw, settings.FORM_TOKEN_SECRET)
    if business is None:
        return _answer(400, {"ok": False})
    if is_bot_agent(request.headers.get("user-agent")):
        return _answer(200, {"ok": True})
    try:
        await record_visit(db, business[0], business[1], _attribution(raw))
    except Exception as err:
        log.error("visit count failed", extra={"errName": type(err).__name__})
    return _answer(200, {"ok": True})


@public.post(EVENT_PATH)
async def embed_event(request: Request, db: Db) -> JSONResponse:
    """F32: what happened on a page. Counted per kind and label; the script batches a few per view."""
    settings = request.app.state.settings
    if _rate_limited(request, "embed-event", settings.EMBED_EVENT_RATE_LIMIT_MAX):
        return _too_many()
    raw = await _json_body(request)
    events = raw.get("events") if isinstance(raw, dict) else None
    if (
        not isinstance(events, list)
        or len(events) > 12
        or any(not isinstance(e, dict) or e.get("k") not in BEHAVIOR_EVENTS for e in events)
    ):
        return _answer(400, {"ok": False})
    business = await _counted_business(db, raw, settings.FORM_TOKEN_SECRET)
    if business is None:
        return _answer(400, {"ok": False})
    if is_bot_agent(request.headers.get("user-agent")):
        return _answer(200, {"ok": True})
    try:
        await record_events(
            db,
            business[0],
            local_day(business[1], datetime.now(UTC)),
            [(e["k"], _short(e.get("l"), 200)) for e in events],
        )
    except Exception as err:
        log.error("event count failed", extra={"errName": type(err).__name__})
    return _answer(200, {"ok": True})
