"""Site drafts, publishing and versions (F04, F06). Port of apps/api/src/modules/sites/service.ts.

The draft lives on the Site row; publishing renders it into an immutable version and makes that
version live, atomically. Stored JSON is re-validated on every read (never trust the DB blindly).
"""

import asyncio
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import Settings
from app.core.timeutil import iso, now_ms
from app.db.models import Business, Service, Site, SiteStatus, SiteVersion, User
from app.deps import TenantContext
from app.errors import AppError
from app.modules.audit import add_audit
from app.modules.media.schemas import referenced_asset_ids
from app.modules.media.service import MediaService, assert_own_assets, media_map_for
from app.modules.sites import schemas as s
from app.modules.sites.cache import PublishedSiteCache
from app.shared.business import OpeningHours
from app.shared.site import (
    SITE_MESSAGES,
    SaveDraftRequest,
    Section,
    Seo,
    SitePage,
    Theme,
    check_draft,
    dump,
)
from app.shared.site_render import render_site_page
from app.shared.site_templates import STOCK_PHOTOS, build_template_draft, with_template_photos

log = logging.getLogger("simplecatch")
M = SITE_MESSAGES
_SECTIONS = TypeAdapter(list[Section])
_PAGES = TypeAdapter(list[SitePage])
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)


def public_url_for(settings: Settings, subdomain: str) -> str:
    if settings.PUBLIC_SITE_MODE == "path":
        return f"{settings.app_url}/s/{subdomain}"
    return f"{settings.site_protocol}://{subdomain}.{settings.PUBLIC_SITE_HOST}"


def _stored_pages(raw: Any) -> list[dict[str, Any]]:
    try:
        return [dump(p) for p in _PAGES.validate_python(raw)]
    except ValidationError:
        return []


def _stored_sections(raw: Any) -> list[dict[str, Any]]:
    return [dump(x) for x in _SECTIONS.validate_python(raw)]


def _dump_model(model: Any) -> dict[str, Any]:
    return model.model_dump(mode="json")


def _business_info(business: Business, services: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """What templates and the renderer need to know about the business."""
    try:
        hours = OpeningHours.model_validate(business.opening_hours).model_dump(by_alias=True)
    except Exception:
        hours = None
    info: dict[str, Any] = {
        "name": business.name,
        "industry": business.industry,
        "phone": business.phone,
        "address": business.address,
        "serviceAreas": list(business.service_areas or []),
        "openingHours": hours,
    }
    if services is not None:
        info["services"] = services
    return info


class SiteService:
    def __init__(
        self,
        db: AsyncSession,
        settings: Settings,
        cache: PublishedSiteCache,
        media: MediaService | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.cache = cache
        self.media = media

    # -- reading -------------------------------------------------------------------

    def _dto(self, row: Site) -> s.SiteOut:
        """Maps a row to the API shape, re-validating stored JSON."""
        live = row.published_version
        return s.SiteOut(
            id=str(row.id),
            subdomain=row.subdomain,
            publicUrl=public_url_for(self.settings, row.subdomain) if row.subdomain else None,
            publicDomain=self.settings.PUBLIC_SITE_HOST,
            # Without a domain the address is a path on the app's own (D-119): "app.example.com/s/".
            publicPrefix=(
                re.sub(r"^https?://", "", self.settings.app_url) + "/s/"
                if self.settings.PUBLIC_SITE_MODE == "path"
                else None
            ),
            published=(
                s.PublishedVersionOut(
                    versionId=str(live.id),
                    number=live.number,
                    revision=live.draft_revision,
                    publishedAt=iso(live.created_at),
                )
                if live
                else None
            ),
            templateKey=row.template_key,
            theme=_dump_model(Theme.model_validate(row.theme)),
            seo=_dump_model(Seo.model_validate(row.seo)),
            sections=_stored_sections(row.sections),
            pages=_stored_pages(row.pages),
            revision=row.revision,
            status=row.status.value,
            updatedAt=iso(row.updated_at),
        )

    async def _load(self, ctx: TenantContext) -> Site | None:
        return (
            await self.db.execute(
                select(Site)
                .options(joinedload(Site.published_version))
                .where(Site.business_id == ctx.business_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()

    async def _require(self, ctx: TenantContext) -> Site:
        row = await self._load(ctx)
        if row is None:
            raise AppError("NOT_FOUND")
        return row

    async def get(self, ctx: TenantContext) -> s.SiteOut | None:
        row = await self._load(ctx)
        return self._dto(row) if row else None

    async def _business(self, ctx: TenantContext) -> Business:
        return (await self.db.execute(select(Business).where(Business.id == ctx.business_id))).scalar_one()

    # -- creating ------------------------------------------------------------------------

    async def _import_stock_photos(self, ctx: TenantContext, template_key: str) -> dict[str, str]:
        """Copies the template's sample photos into the business's media library (D-069), so the
        owner can replace or delete them like any upload. Best effort: a new site never fails over
        photos."""
        if not self.media or not self.settings.SITE_STOCK_IMAGES:
            return {}
        ids: dict[str, str] = {}
        for slot in ("hero", "about"):
            photo = STOCK_PHOTOS[template_key][slot]
            try:
                data = await asyncio.to_thread(
                    (Path(self.settings.SITE_STOCK_DIR) / photo["file"]).read_bytes
                )
                asset = await self.media.upload(ctx, data, f"תמונה לדוגמה ({photo['file']})")
                ids[slot] = asset.id
            except Exception as err:
                log.warning(
                    "stock photo skipped", extra={"errName": type(err).__name__, "file": photo["file"]}
                )
        return ids

    async def create(self, ctx: TenantContext, template_key: str, language: str | None) -> s.SiteOut:
        """Creates the business's site from a template, pre-filled with the business profile, in
        the chosen language or else the business's (D-142, D-143)."""
        business = await self._business(ctx)
        if await self._load(ctx):
            raise AppError("CONFLICT", M["siteExists"])
        lang = language or (business.language if business.language in ("he", "en") else "he")
        base = build_template_draft(template_key, _business_info(business), lang)
        draft = with_template_photos(base, await self._import_stock_photos(ctx, template_key))
        now = now_ms()
        site = Site(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            template_key=template_key,
            theme=draft["theme"],
            seo=draft["seo"],
            sections=draft["sections"],
            pages=[],
            revision=0,
            status=SiteStatus.DRAFT,
            created_at=now,
            updated_at=now,
        )
        try:
            self.db.add(site)
            add_audit(
                self.db,
                "site.created",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="site",
                entity_id=site.id,
                metadata={"templateKey": template_key},
            )
            await self.db.commit()
        except IntegrityError as err:
            await self.db.rollback()
            raise AppError("CONFLICT", M["siteExists"]) from err
        return self._dto(await self._require(ctx))

    # -- draft ------------------------------------------------------------------------------

    async def save_draft(self, ctx: TenantContext, data: SaveDraftRequest) -> s.SiteOut:
        """Replaces the draft only if the client saw the latest revision (optimistic locking), so
        two open editors can never silently overwrite each other. Never touches the published
        version."""
        check_draft(data.sections, data.pages)
        draft = dump(data)
        await assert_own_assets(self.db, ctx.business_id, referenced_asset_ids(draft))
        result = await self.db.execute(
            update(Site)
            .where(Site.business_id == ctx.business_id, Site.revision == data.revision)
            .values(
                template_key=data.templateKey,
                theme=draft["theme"],
                seo=draft["seo"],
                sections=draft["sections"],
                pages=draft["pages"],
                revision=Site.revision + 1,
                updated_at=now_ms(),
            )
        )
        if result.rowcount == 0:
            await self.db.rollback()
            await self._require(ctx)
            raise AppError("CONFLICT", M["revisionConflict"])
        await self.db.commit()
        return self._dto(await self._require(ctx))

    async def set_subdomain(self, ctx: TenantContext, subdomain: str) -> s.SiteOut:
        site = await self._require(ctx)
        if site.subdomain == subdomain:
            return self._dto(site)
        previous = site.subdomain
        site.subdomain = subdomain
        site.updated_at = now_ms()
        add_audit(
            self.db,
            "site.subdomain.changed",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="site",
            entity_id=site.id,
            metadata={"from": previous, "to": subdomain},
        )
        try:
            await self.db.commit()
        except IntegrityError as err:
            await self.db.rollback()
            msg = M["subdomainTaken"]
            raise AppError("CONFLICT", msg, {"subdomain": msg}) from err
        self.cache.invalidate(previous, subdomain)
        return self._dto(await self._require(ctx))

    # -- publishing ---------------------------------------------------------------------------

    async def publish(self, ctx: TenantContext, revision: int) -> s.SiteOut:
        """Renders the draft at `revision` into an immutable version and makes it live,
        atomically. Rendering happens before the write; any failure leaves the current live
        version as is."""
        site = await self._require(ctx)
        if not site.subdomain:
            msg = M["subdomainRequired"]
            raise AppError("VALIDATION_ERROR", msg, {"subdomain": msg})
        if site.revision != revision:
            raise AppError("CONFLICT", M["publishStale"])

        business = await self._business(ctx)
        services = [
            {"id": str(i), "name": n}
            for i, n in await self.db.execute(
                select(Service.id, Service.name)
                .where(Service.business_id == ctx.business_id, Service.active.is_(True))
                .order_by(Service.name.asc())
            )
        ]
        info = _business_info(business, services)
        draft = {
            "theme": _dump_model(Theme.model_validate(site.theme)),
            "seo": _dump_model(Seo.model_validate(site.seo)),
            "sections": _stored_sections(site.sections),
            "pages": _stored_pages(site.pages),
        }
        media = await media_map_for(self.db, self.settings, ctx.business_id, referenced_asset_ids(draft))
        html = render_site_page(draft, info, media)
        # Every extra page is rendered now too, so the whole site goes live together (D-081).
        page_html = {p["slug"]: render_site_page(draft, info, media, p["slug"]) for p in draft["pages"]}

        try:
            await self.db.refresh(site)
            if site.revision != revision:  # a save may have landed meanwhile
                raise AppError("CONFLICT", M["publishStale"])
            last = (
                await self.db.execute(
                    select(func.max(SiteVersion.number)).where(SiteVersion.site_id == site.id)
                )
            ).scalar()
            version = SiteVersion(
                id=uuid.uuid4(),
                business_id=ctx.business_id,
                site_id=site.id,
                number=(last or 0) + 1,
                draft_revision=revision,
                html=html,
                page_html=page_html,
                content={**draft, "business": info},
                created_by_id=ctx.user_id,
                created_at=now_ms(),
            )
            self.db.add(version)
            await self.db.flush()
            site.published_version_id = version.id
            site.status = SiteStatus.PUBLISHED
            site.updated_at = now_ms()
            add_audit(
                self.db,
                "site.published",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="site_version",
                entity_id=version.id,
                metadata={"number": version.number},
            )
            await self.db.commit()
        except IntegrityError as err:
            # Two publishes racing for the same version number: the loser retries by hand.
            await self.db.rollback()
            raise AppError("CONFLICT", M["publishStale"]) from err
        self.cache.invalidate(site.subdomain)
        log.info("site published", extra={"businessId": str(ctx.business_id), "siteId": str(site.id)})
        return self._dto(await self._require(ctx))

    async def list_versions(self, ctx: TenantContext) -> list[s.SiteVersionOut]:
        site = await self._require(ctx)
        rows = await self.db.execute(
            select(SiteVersion.id, SiteVersion.number, SiteVersion.created_at, User.full_name)
            .outerjoin(User, User.id == SiteVersion.created_by_id)
            .where(SiteVersion.site_id == site.id, SiteVersion.business_id == ctx.business_id)
            .order_by(SiteVersion.number.desc())
            .limit(50)
        )
        return [
            s.SiteVersionOut(
                id=str(i),
                number=n,
                publishedAt=iso(at),
                publishedBy=name,
                live=i == site.published_version_id,
            )
            for i, n, at, name in rows
        ]

    async def rollback(self, ctx: TenantContext, version_id: str) -> s.SiteOut:
        """Makes an earlier version live again. The version must belong to this business's site."""
        site = await self._require(ctx)
        version = None
        if _UUID.match(version_id):
            version = (
                await self.db.execute(
                    select(SiteVersion).where(
                        SiteVersion.id == uuid.UUID(version_id),
                        SiteVersion.site_id == site.id,
                        SiteVersion.business_id == ctx.business_id,
                    )
                )
            ).scalar_one_or_none()
        if version is None:
            raise AppError("NOT_FOUND")
        if not site.subdomain:
            raise AppError("VALIDATION_ERROR", M["subdomainRequired"])
        site.published_version_id = version.id
        site.status = SiteStatus.PUBLISHED
        site.updated_at = now_ms()
        add_audit(
            self.db,
            "site.rolled_back",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="site_version",
            entity_id=version.id,
            metadata={"number": version.number},
        )
        await self.db.commit()
        self.cache.invalidate(site.subdomain)
        return self._dto(await self._require(ctx))

    async def change_template(self, ctx: TenantContext, template_key: str, revision: int) -> s.SiteOut:
        """D-095: rebuilds the home page from another template, like a new site (content, palette,
        font, Google details and sample photos). Keeps the logo, extra pages and address; the
        published version is untouched until the owner publishes. Guarded by the revision."""
        site = await self._require(ctx)
        if site.revision != revision:
            raise AppError("CONFLICT", M["revisionConflict"])
        business = await self._business(ctx)
        language = (site.theme or {}).get("language")  # the site keeps its language (D-142)
        base = build_template_draft(template_key, _business_info(business), language or "he")
        draft = with_template_photos(base, await self._import_stock_photos(ctx, template_key))
        logo = (site.theme or {}).get("logoAssetId")
        previous = site.template_key
        result = await self.db.execute(
            update(Site)
            .where(Site.id == site.id, Site.revision == revision)
            .values(
                template_key=template_key,
                theme={**draft["theme"], "logoAssetId": logo},
                seo=draft["seo"],
                sections=draft["sections"],
                revision=Site.revision + 1,
                updated_at=now_ms(),
            )
        )
        if result.rowcount == 0:
            await self.db.rollback()
            raise AppError("CONFLICT", M["revisionConflict"])
        add_audit(
            self.db,
            "site.template_changed",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="site",
            entity_id=site.id,
            metadata={"from": previous, "to": template_key},
        )
        await self.db.commit()
        return self._dto(await self._require(ctx))

    async def remove(self, ctx: TenantContext) -> None:
        """D-095: deletes the SimpleCatch site: offline at once, the address is freed, the draft and
        versions are gone. Leads and their form submissions stay (consent record), and so do the
        images."""
        site = await self._require(ctx)
        was_published = site.published_version_id is not None
        subdomain, site_id = site.subdomain, site.id
        # Unlink the live version first so the versions can be deleted with the site.
        await self.db.execute(update(Site).where(Site.id == site_id).values(published_version_id=None))
        await self.db.execute(delete(Site).where(Site.id == site_id))
        add_audit(
            self.db,
            "site.deleted",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="site",
            entity_id=site_id,
            metadata={"wasPublished": was_published},
        )
        await self.db.commit()
        self.cache.invalidate(subdomain)

    async def unpublish(self, ctx: TenantContext) -> s.SiteOut:
        """Takes the site offline. Versions are kept; publishing again brings it back."""
        site = await self._require(ctx)
        site.published_version_id = None
        site.status = SiteStatus.DRAFT
        site.updated_at = now_ms()
        add_audit(
            self.db,
            "site.unpublished",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="site",
            entity_id=site.id,
        )
        await self.db.commit()
        self.cache.invalidate(site.subdomain)
        return self._dto(await self._require(ctx))
