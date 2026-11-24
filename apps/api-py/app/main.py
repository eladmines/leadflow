import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings, get_settings
from app.core.ratelimit import RateLimiter
from app.db.session import make_engine, make_sessionmaker
from app.errors import AppError
from app.integrations.domain import DomainExpiry, create_domain_expiry
from app.integrations.email import EmailSender, create_email_sender
from app.integrations.gmail import GmailApi, create_gmail_api
from app.integrations.messenger import MessengerSender, create_messenger_sender
from app.integrations.meta import MetaApi, create_meta_api
from app.integrations.storage import StorageProvider, create_storage
from app.integrations.whatsapp import WhatsAppSender, create_whatsapp_sender
from app.middleware import error_response, request_context
from app.modules.appointments import routes as appointment_routes
from app.modules.auth import routes as auth_routes
from app.modules.businesses import routes as business_routes
from app.modules.channels import routes as channel_routes
from app.modules.conversations import routes as conversation_routes
from app.modules.domain import routes as domain_routes
from app.modules.domain.service import start_domain_watch, stop_task
from app.modules.embed import routes as embed_routes
from app.modules.leads import routes as lead_routes
from app.modules.media import routes as media_routes
from app.modules.notifications import routes as notification_routes
from app.modules.quotes import routes as quote_routes
from app.modules.reports import routes as report_routes
from app.modules.sites import routes as site_routes
from app.modules.sites.cache import PublishedSiteCache
from app.modules.tasks import routes as task_routes
from app.modules.tasks.reminders import start_task_reminders
from app.modules.team import routes as team_routes
from app.modules.whatsapp import routes as whatsapp_routes
from app.modules.whatsapp.gmail_sync import start_gmail_sync
from app.modules.whatsapp.nudges import start_booking_nudges
from app.routes import health
from app.web_app import WebApp

log = logging.getLogger("simplecatch")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def create_app(
    settings: Settings | None = None,
    email: EmailSender | None = None,
    storage: StorageProvider | None = None,
    site_cache: PublishedSiteCache | None = None,
    domain_expiry: DomainExpiry | None = None,
    whatsapp_sender: WhatsAppSender | None = None,
    messenger_sender: MessengerSender | None = None,
    meta_api: MetaApi | None = None,
    gmail_api: GmailApi | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.DATABASE_URL)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        jobs = (
            [
                start_task_reminders(app),
                start_domain_watch(app),
                start_gmail_sync(app),
                start_booking_nudges(app),
            ]
            if settings.RUN_BACKGROUND_JOBS
            else []
        )
        yield
        for job in jobs:
            await stop_task(job)
        await app.state.email.close()
        await engine.dispose()

    app = FastAPI(
        title="SimpleCatch API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.email = email or create_email_sender(settings)
    app.state.storage = storage or create_storage(settings, app.state.sessionmaker)
    app.state.rate_limiter = RateLimiter()
    app.state.site_cache = site_cache or PublishedSiteCache()
    app.state.domain_expiry = domain_expiry or create_domain_expiry(settings)
    app.state.whatsapp_sender = whatsapp_sender or create_whatsapp_sender(settings)
    app.state.messenger_sender = messenger_sender or create_messenger_sender(settings)
    app.state.meta_api = meta_api or create_meta_api(settings)
    app.state.gmail_api = gmail_api or create_gmail_api(settings)

    app.middleware("http")(request_context)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Requested-With", "X-SimpleCatch-Locale"],
    )

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):  # type: ignore[no-untyped-def]
        extra = {"fields": exc.fields} if exc.fields else {}
        return error_response(exc.code, exc.status_code, _rid(request), exc.message, **extra)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):  # type: ignore[no-untyped-def]
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(p) for p in err["loc"] if p not in ("body", "query", "path")]
            fields.setdefault(".".join(loc) or "_", err["msg"].removeprefix("Value error, "))
        return error_response("VALIDATION_ERROR", 400, _rid(request), fields=fields)

    web_app = WebApp(settings.WEB_DIST_DIR) if settings.WEB_DIST_DIR else None

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):  # type: ignore[no-untyped-def]
        if exc.status_code == 404 and web_app is not None:
            page = await web_app.handle(request)
            if page is not None:
                return page
        if exc.status_code == 404:
            return error_response("NOT_FOUND", 404, _rid(request))
        if exc.status_code == 429:
            return error_response("RATE_LIMITED", 429, _rid(request))
        if 400 <= exc.status_code < 500:
            return error_response("VALIDATION_ERROR", 400, _rid(request))
        return error_response("INTERNAL_ERROR", 500, _rid(request))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception):  # type: ignore[no-untyped-def]
        log.error("unhandled error", exc_info=exc, extra={"request_id": _rid(request)})
        return error_response("INTERNAL_ERROR", 500, _rid(request))

    app.include_router(health.router)
    app.include_router(auth_routes.router)
    app.include_router(business_routes.router)
    app.include_router(business_routes.tenant)
    app.include_router(team_routes.router)
    app.include_router(team_routes.tenant)
    app.include_router(whatsapp_routes.webhooks)
    app.include_router(channel_routes.public)
    app.include_router(channel_routes.tenant)
    app.include_router(whatsapp_routes.tenant)
    app.include_router(conversation_routes.tenant)
    app.include_router(domain_routes.tenant)
    app.include_router(embed_routes.public)
    app.include_router(embed_routes.tenant)
    app.include_router(media_routes.public)
    app.include_router(media_routes.tenant)
    app.include_router(appointment_routes.tenant)
    app.include_router(lead_routes.tenant)
    app.include_router(quote_routes.public)
    app.include_router(quote_routes.tenant)
    app.include_router(report_routes.tenant)
    app.include_router(site_routes.tenant)
    app.include_router(task_routes.tenant)
    app.include_router(notification_routes.tenant)
    return app
