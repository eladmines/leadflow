"""Site API response shapes (packages/shared/src/site.ts)."""

from typing import Any, Literal

from pydantic import BaseModel


class PublishedVersionOut(BaseModel):
    versionId: str
    number: int
    revision: int  # draft revision that was published; differs from `revision` when edits are unpublished
    publishedAt: str


class SiteOut(BaseModel):
    id: str
    subdomain: str | None
    publicUrl: str | None  # live address once a subdomain is chosen
    publicDomain: str  # host suffix shown next to the subdomain field
    publicPrefix: str | None  # set when sites live under a path instead (D-119)
    published: PublishedVersionOut | None
    templateKey: str
    theme: dict[str, Any]
    seo: dict[str, Any]
    sections: list[dict[str, Any]]
    pages: list[dict[str, Any]]
    revision: int  # optimistic-locking counter: every successful draft save increments it
    status: Literal["DRAFT", "PUBLISHED", "SUSPENDED"]
    updatedAt: str


class SiteResponse(BaseModel):
    site: SiteOut | None


class SiteVersionOut(BaseModel):
    id: str
    number: int
    publishedAt: str
    publishedBy: str | None
    live: bool


class SiteVersionListResponse(BaseModel):
    versions: list[SiteVersionOut]
