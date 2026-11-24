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
