"""Public-site server (F06): serves each business's *published* version by Host header, e.g.
http://shiran.lvh.me:4100, or, with PUBLIC_SITE_MODE=path, under APP_URL/s/<subdomain> on the app's
own port (hosting without a domain). Read-only, no auth, no scripts of its own; one cookie, `lf_src`,
remembers which ad or site brought the visitor (F26).

Port of apps/api/src/public/app.ts.
"""

import asyncio
import json
import logging
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import joinedload
from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings
from app.core.crypto import sha256_hex
from app.core.form_token import create_form_token, verify_form_token
from app.core.ratelimit import RateLimiter
from app.core.timezone import zoned_time_to_utc
from app.db.models import Business, Site
from app.integrations.email import EmailSender
from app.integrations.storage import StorageProvider
from app.modules.appointments.service import AppointmentService
from app.modules.leads import schemas as lead_schemas
from app.modules.leads.notify import notify_team_by_email
from app.modules.leads.service import LeadService
from app.modules.notifications.service import MANAGERS, notify_safe
from app.modules.reports.events import device_of, record_events
from app.modules.reports.visits import is_bot_agent, local_day, record_visit
from app.modules.sites.cache import PublishedPage, PublishedSiteCache
from app.modules.sites.published_content import section_map
from app.public.attribution import read_attribution_cookie, remember_visit
from app.shared.embed import normalize_page_path
from app.shared.site_i18n import site_error, site_text
from app.shared.site_render import (
    FORM_TOKEN_PLACEHOLDER,
    HONEYPOT_FIELD,
    LEAD_FORM_PATH,
    render_site_message_page,
)

log = logging.getLogger("simplecatch")

_SUBDOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$")
_DATA = Path(__file__).resolve().parent.parent / "shared" / "data"

# Static sites: the only script is our own first-party one (counts, no cookies), reporting back to
# the site's own address; styles inline + Google Fonts; nothing may frame the page.
SECURITY_HEADERS = {
    "content-security-policy": (
        "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline' "
        "https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    ),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
}

SITE_SCRIPT_PATH = "/__sc.js"
SITE_EVENTS_PATH = "/__sc"


def _not_found_page(title: str, text: str) -> str:
    return (
        '<!doctype html>\n<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'<meta name="robots" content="noindex"><title>{title}</title>\n'
        "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Arial,sans-serif;background:#f8f5f0;color:#1f2933;text-align:center;padding:24px}h1{font-size:1.6rem;margin:0 0 .4em}p{color:#5f6b74;margin:0}</style>\n"
        f"</head><body><main><h1>{title}</h1><p>{text}</p></main></body></html>"
    )


class _SiteTarget:
    def __init__(
        self, business_id: uuid.UUID, timezone: str, sections: dict[str, dict[str, str]], expires: float
    ) -> None:
        self.business_id = business_id
        self.timezone = timezone
        self.sections = sections  # `<section id>` → its page path and name
        self.expires = expires


def create_public_app(
    settings: Settings,
    sessionmaker: async_sessionmaker[AsyncSession],
    email: EmailSender,
    cache: PublishedSiteCache | None = None,
    storage: StorageProvider | None = None,
) -> FastAPI:
    cache = cache or PublishedSiteCache()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    limiter = RateLimiter()
    suffix = f".{settings.PUBLIC_SITE_HOST.lower()}"
    by_path = settings.PUBLIC_SITE_MODE == "path"
    site_script = (_DATA / "site_script.js").read_text(encoding="utf-8")
    targets: dict[str, _SiteTarget] = {}
    background: set[asyncio.Task] = set()

    def site_origin(subdomain: str) -> str:
        """The site's address: its own host, or its path on the app's address."""
        return (
            f"{settings.app_url}/s/{subdomain}"
            if by_path
            else f"{settings.site_protocol}://{subdomain}{suffix}"
        )

    def with_base(html: str, subdomain: str) -> str:
        """Pages link with root paths (`/`, `/about`, the form's action); under a path they get it."""
        if not by_path:
            return html
        return re.sub(r'(\s(?:href|action)=")/(?!/)', lambda m: f"{m.group(1)}/s/{subdomain}/", html)

    def valid_subdomain(sub: str | None) -> str | None:
        s = (sub or "").lower()
        return s if _SUBDOMAIN.match(s) else None

    def subdomain_of(host: str | None) -> str | None:
        """`shiran.lvh.me:4100` → `shiran`; anything else → None."""
        h = (host or "").lower().rstrip(".")
        if not h.endswith(suffix):
            return None
        sub = h[: -len(suffix)]
        return sub if _SUBDOMAIN.match(sub) else None

    def send(status: int, media_type: str, body: str | bytes, cache_control: str = "no-store") -> Response:
        return Response(
            body,
            status_code=status,
            media_type=f"{media_type}; charset=utf-8",
            headers={**SECURITY_HEADERS, "cache-control": cache_control},
        )

    def site_not_found() -> Response:
        return send(
            404, "text/html", _not_found_page("האתר לא נמצא", "ייתכן שהכתובת שגויה, או שהאתר עדיין לא פורסם.")
        )

    def client_ip(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def spawn(coro: Any) -> None:
        task = asyncio.create_task(coro)
        background.add(task)
        task.add_done_callback(background.discard)

    async def site_target(subdomain: str) -> _SiteTarget | None:
        """The business behind a site name, with where its sections are (a few minutes' cache)."""
        import time

        hit = targets.get(subdomain)
        if hit and hit.expires > time.monotonic():
            return hit
        async with sessionmaker() as db:
            row = (
                await db.execute(
                    select(Site)
                    .options(joinedload(Site.published_version), joinedload(Site.business))
                    .where(Site.subdomain == subdomain)
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            content = row.published_version.content if row.published_version else None
            sections = {x["id"]: {"path": x["path"], "name": x["name"]} for x in section_map(content)}
            target = _SiteTarget(row.business_id, row.business.timezone, sections, time.monotonic() + 300)
        targets[subdomain] = target
        return target

    async def count_view(
        subdomain: str, visit: tuple[dict[str, Any], bool], page_path: str, ua: str | None
    ) -> None:
        try:
            target = await site_target(subdomain)
            if not target:
                return
            attribution, entry = visit
            events: list[tuple[str, str | None]] = [("page", page_path)]
            async with sessionmaker() as db:
                if entry:
                    events += [("landing", page_path), ("device", device_of(ua))]
                    await record_visit(db, target.business_id, target.timezone, attribution)
                await record_events(
                    db, target.business_id, local_day(target.timezone, datetime.now(UTC)), events
                )
        except Exception as err:
            log.error("visit count failed", extra={"errName": type(err).__name__})

    async def lookup(subdomain: str) -> PublishedPage:
        hit = cache.get(subdomain)
        if hit:
            return hit
        async with sessionmaker() as db:
            site = (
                await db.execute(
                    select(Site)
                    .options(joinedload(Site.published_version))
                    .where(Site.subdomain == subdomain)
                )
            ).scalar_one_or_none()
        live = site.published_version if site else None
        page_html = live.page_html if live else None
        page = PublishedPage(
            html=live.html if live else None,
            pages=dict(page_html) if isinstance(page_html, dict) else {},
            version_id=str(live.id) if live else None,
            updated_at=live.created_at if live else None,
        )
        cache.set(subdomain, page)
        return page

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    if storage is not None:
        from app.modules.media.routes import public as media_public

        app.include_router(media_public)
        app.state.storage = storage
        app.state.settings = settings

    # ------------------------------------------------------------------ serving a site

    async def serve_site(request: Request, subdomain: str | None, path: str) -> Response:
        if not subdomain:
            return site_not_found()
        site = await lookup(subdomain)
        if not site.html:
            return site_not_found()

        origin = site_origin(subdomain)
        # `/about` and `/about/` → an extra page (D-081).
        slug = re.sub(r"^/|/$", "", path).lower()
        page_html = site.html if path in ("/", "/index.html") else site.pages.get(slug)
        if page_html and "/" not in slug:
            # Never cached by browsers: every view gets a fresh form token (its nonce is the lead's
            # idempotency key), and a new publish shows immediately. The server-side cache stays.
            token = create_form_token(settings.FORM_TOKEN_SECRET, subdomain)
            script_src = f"{'/s/' + subdomain if by_path else ''}{SITE_SCRIPT_PATH}"
            html = with_base(
                page_html.replace(FORM_TOKEN_PLACEHOLDER, token).replace(
                    "</body>", f'<script defer src="{script_src}"></script></body>', 1
                ),
                subdomain,
            )
            response = send(200, "text/html", html, "no-store")
            visit = remember_visit(
                request,
                response,
                landing_path=path,
                cookie_path=f"/s/{subdomain}" if by_path else "/",
                secure=(settings.app_url if by_path else origin).startswith("https:"),
            )
            # F31/F32: counted in the background; a failure is logged, never shown to the visitor.
            # The server sees every page view, so pages, entry pages and devices need no script.
            ua = request.headers.get("user-agent")
            if not is_bot_agent(ua) and not request.headers.get("purpose"):
                spawn(count_view(subdomain, visit, normalize_page_path(path), ua))
            return response
        if path == "/robots.txt":
            return send(
                200,
                "text/plain",
                f"User-agent: *\nAllow: /\nSitemap: {origin}/sitemap.xml\n",
                "public, max-age=3600",
            )
        if path == "/sitemap.xml":
            lastmod = (
                f"<lastmod>{site.updated_at.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}</lastmod>"
                if site.updated_at
                else ""
            )
            urls = "".join(f"<url><loc>{origin}/{p}</loc>{lastmod}</url>" for p in ["", *site.pages])
            return send(
                200,
                "application/xml",
                f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n',
                "public, max-age=3600",
            )
        return send(404, "text/html", _not_found_page("העמוד לא נמצא", "העמוד שחיפשתם לא קיים באתר הזה."))

    # ------------------------------------------------------------------ the counting script

    def script_response() -> Response:
        return send(200, "application/javascript", site_script, "public, max-age=3600")

    async def site_events(request: Request, sub: str | None) -> Response:
        def done() -> Response:
            return Response(status_code=204)

        if not sub or is_bot_agent(request.headers.get("user-agent")):
            return done()
        body = await request.body()
        if len(body) > 16 * 1024:
            return Response(status_code=400)
        try:
            raw = json.loads(body.decode() or "null")
            kinds = {"click", "scroll", "form"}
            events = raw["ev"]
            if not isinstance(events, list) or len(events) > 12:
                return done()
            parsed: list[tuple[str, str | None]] = []
            for e in events:
                label = e.get("l")
                if e.get("k") not in kinds or (
                    label is not None and (not isinstance(label, str) or len(label) > 20)
                ):
                    return done()
                parsed.append((e["k"], label))
            seen_ids = raw.get("sec") or []
            if (
                not isinstance(seen_ids, list)
                or len(seen_ids) > 30
                or any(not isinstance(x, str) or len(x) > 60 for x in seen_ids)
            ):
                return done()
            clicked_id = raw.get("clk")
            if clicked_id is not None and (not isinstance(clicked_id, str) or len(clicked_id) > 60):
                return done()
        except (ValueError, KeyError, TypeError, AttributeError):
            return done()
        target = await site_target(sub)
        if not target:
            return done()
        for sid in dict.fromkeys(seen_ids):
            sec = target.sections.get(re.sub(r"^s-", "", sid, count=1))
            if sec:
                parsed.append(("section", f"{sec['path']}#{sec['name']}"))
        clicked = clicked_id and target.sections.get(re.sub(r"^s-", "", clicked_id, count=1))
        if clicked:
            parsed.append(("sclick", f"{clicked['path']}#{clicked['name']}"))
        try:
            async with sessionmaker() as db:
                await record_events(
                    db, target.business_id, local_day(target.timezone, datetime.now(UTC)), parsed
                )
        except Exception as err:
            log.error("site event count failed", extra={"errName": type(err).__name__})
        return done()

    def rate_limited(request: Request, route: str, sub: str | None, limit: int) -> bool:
        try:
            limiter.hit(
                route,
                f"{client_ip(request)}|{request.headers.get('host', '')}|{sub or ''}",
                limit,
                settings.LEAD_FORM_RATE_LIMIT_WINDOW / 1000,
            )
            return False
        except Exception:
            return True

    def too_many() -> Response:
        return send(
            429,
            "text/html",
            _not_found_page("יותר מדי ניסיונות", "שלחתם כמה פניות ברצף. נסו שוב בעוד כמה דקות."),
        )

    if by_path:

        @app.get("/s/{sub}/__sc.js")
        async def script_path(sub: str) -> Response:
            return script_response()

        @app.post("/s/{sub}/__sc")
        async def events_path(sub: str, request: Request) -> Response:
            if rate_limited(request, "site-events", sub, settings.EMBED_EVENT_RATE_LIMIT_MAX):
                return too_many()
            return await site_events(request, valid_subdomain(sub))

        @app.get("/s/{sub}")
        async def site_home(sub: str, request: Request) -> Response:
            return await serve_site(request, valid_subdomain(sub), "/")

        @app.get("/s/{sub}/{rest:path}")
        async def site_page(sub: str, rest: str, request: Request) -> Response:
            return await serve_site(request, valid_subdomain(sub), f"/{rest}")

    else:

        @app.get(SITE_SCRIPT_PATH)
        async def script_host() -> Response:
            return script_response()

        @app.post(SITE_EVENTS_PATH)
        async def events_host(request: Request) -> Response:
            if rate_limited(request, "site-events", None, settings.EMBED_EVENT_RATE_LIMIT_MAX):
                return too_many()
            return await site_events(request, subdomain_of(request.headers.get("host")))

        @app.get("/{rest:path}")
        async def site_any(rest: str, request: Request) -> Response:
            return await serve_site(request, subdomain_of(request.headers.get("host")), request.url.path)

    # ------------------------------------------------------------------ the lead form

    def message(
        subdomain: str, status: int, theme: dict[str, Any], business_name: str, page: dict[str, Any]
    ) -> Response:
        """A result page in the site's own look."""
        html = render_site_message_page(
            theme,
            {"name": business_name},
            {**page, "backLabel": site_text(theme.get("language"))["result"]["back"]},
        )
        return send(status, "text/html", with_base(html, subdomain))

    async def lead_form(request: Request, sub: str | None) -> Response:
        if rate_limited(request, "lead-form", sub, settings.LEAD_FORM_RATE_LIMIT_MAX):
            return too_many()
        subdomain = valid_subdomain(sub) if by_path else subdomain_of(request.headers.get("host"))
        if not subdomain:
            return site_not_found()
        if not request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded"):
            return send(400, "text/html", _not_found_page("הבקשה אינה תקינה", "חזרו לאתר ונסו שוב."))
        raw = await request.body()
        if len(raw) > 16 * 1024:
            return send(400, "text/html", _not_found_page("הבקשה אינה תקינה", "חזרו לאתר ונסו שוב."))
        body = dict(parse_qsl(raw.decode(errors="replace"), keep_blank_values=True))

        async with sessionmaker() as db:
            site = (
                await db.execute(
                    select(Site)
                    .options(joinedload(Site.published_version))
                    .where(Site.subdomain == subdomain)
                )
            ).scalar_one_or_none()
            content = site.published_version.content if site and site.published_version else None
            if not site or not isinstance(content, dict) or not isinstance(content.get("theme"), dict):
                return site_not_found()
            theme, business = content["theme"], content.get("business") or {}
            sections = list(content.get("sections") or [])
            pages = list(content.get("pages") or [])
            # The form can be on any page; section ids are unique across the site (D-081).
            page_slug = body.get("_p") if any(p["slug"] == body.get("_p") for p in pages) else ""
            all_sections = sections + [s for p in pages for s in p.get("sections", [])]
            section = next(
                (
                    s
                    for s in all_sections
                    if s["type"] == "contact"
                    and s["visible"]
                    and s["form"]["enabled"]
                    and s["id"] == body.get("_s")
                ),
                None,
            )
            if section is None:
                return site_not_found()
            lang = theme.get("language")
            L = site_text(lang)
            name = business.get("name", "")
            thanks = {"title": L["result"]["thanks"], "text": section["form"]["successMessage"]}

            # Bots: pretend success, store nothing (they learn nothing from the response).
            if body.get(HONEYPOT_FIELD):
                log.info("lead form spam dropped", extra={"subdomain": subdomain, "reason": "honeypot"})
                return message(subdomain, 200, theme, name, thanks)
            token = verify_form_token(settings.FORM_TOKEN_SECRET, subdomain, body.get("_t"))
            if not token.ok:
                return message(
                    subdomain, 400, theme, name,
                    {"title": L["result"]["notSent"], "text": site_error(lang, lead_schemas.LEAD_MESSAGES["formExpired"])},
                )  # fmt: skip
            if token.too_fast:
                log.info("lead form spam dropped", extra={"subdomain": subdomain, "reason": "too_fast"})
                return message(subdomain, 200, theme, name, thanks)

            data, errors = lead_schemas.parse_lead_submission(body)
            if data is None:
                items = list(dict.fromkeys(site_error(lang, m) for m in errors.values()))
                return message(
                    subdomain,
                    400,
                    theme,
                    name,
                    {"title": L["result"]["almost"], "text": L["result"]["fix"], "items": items},
                )

            # F17: a requested appointment slot, read in the business's time zone.
            slot: datetime | None = None
            if data.date and data.time:
                tz = (
                    await db.execute(select(Business.timezone).where(Business.id == site.business_id))
                ).scalar_one()
                slot = zoned_time_to_utc(data.date, data.time, tz)
                ahead = (slot - datetime.now(UTC)).total_seconds()
                if ahead <= 0 or ahead > 120 * 86400:
                    return message(
                        subdomain, 400, theme, name,
                        {"title": L["result"]["almost"], "text": L["result"]["fix"], "items": [site_error(lang, lead_schemas.LEAD_MESSAGES["slotPast"])]},
                    )  # fmt: skip

            leads = LeadService(db)
            lead, created = await leads.create_from_website(
                business_id=site.business_id,
                site_id=site.id,
                idempotency_key=token.nonce,
                ip_hash=sha256_hex(f"{client_ip(request)}|{settings.FORM_TOKEN_SECRET}"),
                source_url=f"{site_origin(subdomain)}/{page_slug}",
                data=data,
                attribution=read_attribution_cookie(request),
            )
            if created:
                log.info(
                    "lead created from website",
                    extra={"businessId": str(site.business_id), "leadId": lead.id},
                )
                requested: str | None = None
                if slot:
                    try:
                        await AppointmentService(db).request_from_website(
                            site.business_id,
                            uuid.UUID(lead.id),
                            uuid.UUID(lead.contact.id),
                            uuid.UUID(data.serviceId) if data.serviceId else None,
                            slot,
                        )
                        requested = f"{'/'.join(reversed(data.date.split('-')))} {data.time}"
                    except Exception as err:
                        # The lead is saved either way; the request can be booked by hand from it.
                        await db.rollback()
                        log.error("appointment request failed", extra={"errName": type(err).__name__})
                # In the background; a failure is logged, never left unhandled.
                spawn(_notify_team(sessionmaker, email, settings, site.business_id, name, data, requested))
                # In-app: the bell and a pop-up for everyone who sees all leads (D-097).
                await notify_safe(
                    db,
                    business_id=site.business_id,
                    type="lead.new",
                    data={
                        "leadId": lead.id,
                        "name": lead.contact.name,
                        "source": "website_form",
                        **({"appointment": requested} if requested else {}),
                    },
                    roles=MANAGERS,
                )
        return message(subdomain, 200, theme, name, thanks)

    if by_path:

        @app.post(f"/s/{{sub}}{LEAD_FORM_PATH}")
        async def lead_form_path(sub: str, request: Request) -> Response:
            return await lead_form(request, sub)

    else:

        @app.post(LEAD_FORM_PATH)
        async def lead_form_host(request: Request) -> Response:
            return await lead_form(request, None)

    @app.exception_handler(Exception)
    async def _error(request: Request, exc: Exception) -> Response:
        log.error("public site error", exc_info=exc)
        return send(500, "text/html", _not_found_page("אירעה תקלה", "נסו לרענן את הדף בעוד רגע."))

    app.state.rate_limiter = limiter
    return app


async def _notify_team(sessionmaker, email, settings, business_id, business_name, data, requested) -> None:  # type: ignore[no-untyped-def]
    try:
        async with sessionmaker() as db:
            await notify_team_by_email(db, email, settings, business_id, business_name, data, requested)
    except Exception as err:
        log.error("lead notification failed", extra={"errName": type(err).__name__})
