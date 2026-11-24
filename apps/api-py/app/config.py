"""Settings from the environment (same variable names as the Node API's .env)."""

import secrets
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    NODE_ENV: Literal["development", "test", "production"] = "development"
    DATABASE_URL: str
    WEB_ORIGINS: Annotated[list[str], NoDecode] = []  # comma-separated in the environment
    APP_URL: str | None = None
    RENDER_EXTERNAL_URL: str | None = None  # Render's public address, used when APP_URL isn't set
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
    SITE_STOCK_DIR: str = "assets/stock"

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

    # F12/F23: WhatsApp and Messenger. One number / Page from the environment as a fallback;
    # businesses connect their own (F25). `local` records outgoing messages without calling Meta.
    WHATSAPP_PROVIDER: Literal["local", "cloud"] = "local"
    WHATSAPP_BUSINESS_ID: str | None = None
    WHATSAPP_PHONE_NUMBER_ID: str | None = None
    WHATSAPP_ACCESS_TOKEN: str | None = None
    WHATSAPP_APP_SECRET: str | None = None  # verifies the X-Hub-Signature-256 of every webhook call
    WHATSAPP_VERIFY_TOKEN: str | None = None  # the word Meta echoes back when the webhook is registered
    WHATSAPP_GRAPH_VERSION: str = "v21.0"
    MESSENGER_PROVIDER: Literal["local", "cloud"] = "local"
    MESSENGER_BUSINESS_ID: str | None = None
    MESSENGER_PAGE_ID: str | None = None
    MESSENGER_PAGE_ACCESS_TOKEN: str | None = None

    # F25: channels each business connects itself. CHANNEL_SECRETS_KEY is 32 bytes, base64; unset =
    # derived from FORM_TOKEN_SECRET.
    CHANNEL_SECRETS_KEY: str | None = None
    META_APP_ID: str | None = None
    META_LOGIN_CONFIG_ID: str | None = None
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    EMAIL_INBOUND_DOMAIN: str | None = None  # F27: the domain forwarding addresses live on
    EMAIL_INBOUND_SECRET: str | None = None  # signs the inbound-email webhook

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

    @field_validator(
        "BREVO_API_KEY",
        "SMTP_USER",
        "SMTP_PASS",
        "APP_URL",
        "RENDER_EXTERNAL_URL",
        "WHATSAPP_BUSINESS_ID",
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
        "MESSENGER_BUSINESS_ID",
        "MESSENGER_PAGE_ID",
        "MESSENGER_PAGE_ACCESS_TOKEN",
        "CHANNEL_SECRETS_KEY",
        "META_APP_ID",
        "META_LOGIN_CONFIG_ID",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "EMAIL_INBOUND_DOMAIN",
        "EMAIL_INBOUND_SECRET",
        mode="before",
    )
    @classmethod
    def _empty_is_unset(cls, v: object) -> object:
        return None if v == "" else v

    @model_validator(mode="after")
    def _production_rules(self) -> "Settings":
        """Fails fast on a misconfigured deployment (same rules as the Node API)."""
        if self.EMAIL_TRANSPORT == "brevo" and not self.BREVO_API_KEY:
            raise ValueError("BREVO_API_KEY is required when EMAIL_TRANSPORT is 'brevo'")
        if self.NODE_ENV != "production":
            return self
        if not (self.APP_URL or self.RENDER_EXTERNAL_URL):
            raise ValueError("APP_URL is required in production")
        if self.COOKIE_SECURE is False:
            raise ValueError("COOKIE_SECURE must be true in production")
        if "FORM_TOKEN_SECRET" not in self.model_fields_set:
            raise ValueError("FORM_TOKEN_SECRET is required in production")
        if self.EMAIL_TRANSPORT == "memory":
            raise ValueError("EMAIL_TRANSPORT 'memory' is not allowed in production")
        return self

    @model_validator(mode="after")
    def _channel_secrets_present(self) -> "Settings":
        """A connected business needs the secrets to verify Meta's calls and (for `cloud`) to send."""
        for business, provider, cloud in (
            (
                self.WHATSAPP_BUSINESS_ID,
                self.WHATSAPP_PROVIDER,
                ("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"),
            ),
            (
                self.MESSENGER_BUSINESS_ID,
                self.MESSENGER_PROVIDER,
                ("MESSENGER_PAGE_ID", "MESSENGER_PAGE_ACCESS_TOKEN"),
            ),
        ):
            if not business:
                continue
            name = (
                "WHATSAPP_BUSINESS_ID" if business == self.WHATSAPP_BUSINESS_ID else "MESSENGER_BUSINESS_ID"
            )
            for key in (
                "WHATSAPP_APP_SECRET",
                "WHATSAPP_VERIFY_TOKEN",
                *(cloud if provider == "cloud" else ()),
            ):
                if not getattr(self, key):
                    raise ValueError(f"{key} is required when {name} is set")
        return self

    @property
    def site_protocol(self) -> str:
        return self.PUBLIC_SITE_PROTOCOL or ("https" if self.NODE_ENV == "production" else "http")

    @property
    def app_url(self) -> str:
        return self.APP_URL or self.RENDER_EXTERNAL_URL or "http://localhost:5173"

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
        if self.WEB_ORIGINS:
            return set(self.WEB_ORIGINS)
        parts = urlsplit(self.app_url)
        return {f"{parts.scheme}://{parts.netloc}"}


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
