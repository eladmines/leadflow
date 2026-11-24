"""F04/F06 site routes; registered inside the tenant scope."""

from fastapi import Request, Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.media.service import MediaService
from app.modules.sites import schemas as s
from app.modules.sites.service import SiteService
from app.shared.site import (
    ChangeTemplateRequest,
    CreateSiteRequest,
    PublishRequest,
    SaveDraftRequest,
    SetSubdomainRequest,
)

tenant = tenant_router()


def _svc(request: Request, db: Db) -> SiteService:
    st = request.app.state
    return SiteService(db, st.settings, st.site_cache, MediaService(db, st.storage, st.settings))


@tenant.get("/site", response_model=s.SiteResponse, dependencies=[require_permission("site.view")])
async def get_site(ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).get(ctx)}


@tenant.post(
    "/site", status_code=201, response_model=s.SiteResponse, dependencies=[require_permission("site.edit")]
)
async def create_site(body: CreateSiteRequest, ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).create(ctx, body.templateKey, body.language)}


@tenant.put("/site/draft", response_model=s.SiteResponse, dependencies=[require_permission("site.edit")])
async def save_draft(body: SaveDraftRequest, ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).save_draft(ctx, body)}


@tenant.put(
    "/site/subdomain", response_model=s.SiteResponse, dependencies=[require_permission("site.publish")]
)
async def set_subdomain(body: SetSubdomainRequest, ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).set_subdomain(ctx, body.subdomain)}


@tenant.post(
    "/site/publish", response_model=s.SiteResponse, dependencies=[require_permission("site.publish")]
)
async def publish(body: PublishRequest, ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).publish(ctx, body.revision)}


@tenant.post(
    "/site/unpublish", response_model=s.SiteResponse, dependencies=[require_permission("site.publish")]
)
async def unpublish(ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).unpublish(ctx)}


# D-095: switch template / delete the SimpleCatch site.
@tenant.post("/site/template", response_model=s.SiteResponse, dependencies=[require_permission("site.edit")])
async def change_template(body: ChangeTemplateRequest, ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).change_template(ctx, body.templateKey, body.revision)}


# Deleting takes a live site offline, so it needs the publish permission (owner).
@tenant.delete("/site", status_code=204, dependencies=[require_permission("site.publish")])
async def delete_site(ctx: Tenant, request: Request, db: Db):
    await _svc(request, db).remove(ctx)
    return Response(status_code=204)


@tenant.get(
    "/site/versions", response_model=s.SiteVersionListResponse, dependencies=[require_permission("site.view")]
)
async def list_versions(ctx: Tenant, request: Request, db: Db):
    return {"versions": await _svc(request, db).list_versions(ctx)}


@tenant.post(
    "/site/versions/{version_id}/rollback",
    response_model=s.SiteResponse,
    dependencies=[require_permission("site.publish")],
)
async def rollback(version_id: str, ctx: Tenant, request: Request, db: Db):
    return {"site": await _svc(request, db).rollback(ctx, version_id)}
