"""Settings from the environment (same variable names as the Node API's .env)."""

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    NODE_ENV: Literal["development", "test", "production"] = "development"
    DATABASE_URL: str
    WEB_ORIGINS: list[str] = []
    APP_URL: str | None = None
    COOKIE_SECURE: bool | None = None

    # F01: authentication and email
    EMAIL_TRANSPORT: Literal["smtp", "brevo", "disabled", "memory"] = "smtp"
    EMAIL_VERIFICATION: Literal["on", "off"] = "off"
    BREVO_API_KEY: str | None = None
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str | None = None
    SMTP_PASS: str | None = None
    SMTP_SECURE: bool = False
    EMAIL_FROM: str = "SimpleCatch <no-reply@simplecatch.local>"
    # F05: media. `disk` keeps images in MEDIA_DIR; `database` keeps them in Postgres (for hosts
    # whose disk is wiped on restart).
    STORAGE_DRIVER: Literal["disk", "database"] = "disk"
    MEDIA_DIR: str = ".data/media"
    MEDIA_PUBLIC_BASE: str = "/media"  # same-origin /media locally, a CDN origin in production
    MEDIA_QUOTA_BYTES: int = 200 * 1024 * 1024  # per business
    SITE_STOCK_DIR: str = "../api/assets/stock"

    # F06: customer sites. `host`: each site on its own subdomain of PUBLIC_SITE_HOST (wildcard
    # domain). `path`: sites under APP_URL/s/<subdomain> (hosting without a domain).
    PUBLIC_PORT: int = 4100
    PUBLIC_SITE_HOST: str = "lvh.me:4100"
    PUBLIC_SITE_PROTOCOL: Literal["http", "https"] | None = None
    PUBLIC_SITE_MODE: Literal["host", "path"] = "host"
    SITE_STOCK_IMAGES: bool = True  # new sites start with the template's sample photos (D-069)
    WEB_DIST_DIR: str | None = None  # built web app to serve from the API's port

    # F07: lead forms. FORM_TOKEN_SECRET signs form tokens and embed keys (random per boot outside
    # production, which refuses to start without one).
    FORM_TOKEN_SECRET: str = Field(default_factory=lambda: secrets.token_urlsafe(32), min_length=32)
    LEAD_FORM_RATE_LIMIT_MAX: int = 5
    LEAD_FORM_RATE_LIMIT_WINDOW: int = 600_000  # milliseconds
    EMBED_EVENT_RATE_LIMIT_MAX: int = 240
    EMBED_VISIT_RATE_LIMIT_MAX: int = 60

    # F33: `live` looks domains up at their registries (RDAP, ISOC-IL WHOIS); `off` never does.
    DOMAIN_LOOKUP: Literal["live", "off"] = "live"

    # Background jobs (task reminders). Off in tests, which call the job functions directly.
    RUN_BACKGROUND_JOBS: bool = True
    AUTH_RATE_LIMIT_MAX: int = 10
    AUTH_RATE_LIMIT_WINDOW: int = 900_000  # milliseconds

    @field_validator("WEB_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @field_validator("DATABASE_URL")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        # The shared .env uses Prisma-style URLs; SQLAlchemy's async engine needs asyncpg.
        for prefix in ("postgresql://", "postgres://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix) :].split("?")[0]
        return v

    @field_validator("APP_URL")
    @classmethod
    def _trim_app_url(cls, v: str | None) -> str | None:
        return v.rstrip("/") if v else v

    @field_validator("BREVO_API_KEY", "SMTP_USER", "SMTP_PASS", "APP_URL", mode="before")
    @classmethod
    def _empty_is_unset(cls, v: object) -> object:
        return None if v == "" else v

    @property
    def site_protocol(self) -> str:
        return self.PUBLIC_SITE_PROTOCOL or ("https" if self.NODE_ENV == "production" else "http")

    @property
    def app_url(self) -> str:
        return self.APP_URL or "http://localhost:5173"

    @property
    def verification_on(self) -> bool:
        """Users are asked to verify their email: turned on and email actually goes out."""
        return self.EMAIL_VERIFICATION == "on" and self.EMAIL_TRANSPORT != "disabled"

    @property
    def cookie_secure(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return self.NODE_ENV == "production"

    @property
    def allowed_origins(self) -> set[str]:
        return set(self.WEB_ORIGINS)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
