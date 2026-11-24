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
from app.integrations.email import EmailSender, create_email_sender
from app.middleware import error_response, request_context
from app.modules.auth import routes as auth_routes
from app.modules.businesses import routes as business_routes
from app.modules.notifications import routes as notification_routes
from app.modules.tasks import routes as task_routes
from app.modules.tasks.reminders import start_task_reminders, stop
from app.modules.team import routes as team_routes
from app.routes import health

log = logging.getLogger("simplecatch")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def create_app(settings: Settings | None = None, email: EmailSender | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.DATABASE_URL)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        job = start_task_reminders(app) if settings.RUN_BACKGROUND_JOBS else None
        yield
        if job:
            await stop(job)
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
    app.state.rate_limiter = RateLimiter()

    app.middleware("http")(request_context)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.WEB_ORIGINS,
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

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):  # type: ignore[no-untyped-def]
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
    app.include_router(task_routes.tenant)
    app.include_router(notification_routes.tenant)
    return app
