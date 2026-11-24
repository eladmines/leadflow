"""Settings from the environment (same variable names as the Node API's .env)."""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
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
