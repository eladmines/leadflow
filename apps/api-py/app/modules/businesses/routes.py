"""Business endpoints: the caller's own businesses and create (non-tenant), then the tenant routes."""

from fastapi import APIRouter

from app.deps import Auth, Db, Tenant, require_permission, tenant_router
from app.modules.businesses.service import BusinessService
from app.shared.business import (
    BusinessListResponse,
    BusinessResponse,
    CreateBusinessRequest,
    MemberListResponse,
    NotificationPrefs,
    NotificationPrefsResponse,
    UpdateBusinessRequest,
)

router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])


@router.get("", response_model=BusinessListResponse)
async def list_mine(auth: Auth, db: Db):
    return {"businesses": await BusinessService(db).list_mine(auth.user.id)}


@router.post("", status_code=201, response_model=BusinessResponse)
async def create(body: CreateBusinessRequest, auth: Auth, db: Db):
    return {"business": await BusinessService(db).create(auth.user.id, body)}


# Tenant routes (/api/v1/businesses/{business_id}/...), behind the membership check.
tenant = tenant_router()


@tenant.get("", response_model=BusinessResponse, dependencies=[require_permission("business.view")])
async def get_business(ctx: Tenant, db: Db):
    return {"business": await BusinessService(db).get(ctx)}


@tenant.patch("", response_model=BusinessResponse, dependencies=[require_permission("business.update")])
async def update_business(body: UpdateBusinessRequest, ctx: Tenant, db: Db):
    return {"business": await BusinessService(db).update(ctx, body)}


@tenant.post(
    "/onboarding/complete",
    response_model=BusinessResponse,
    dependencies=[require_permission("business.update")],
)
async def complete_onboarding(ctx: Tenant, db: Db):
    return {"business": await BusinessService(db).complete_onboarding(ctx)}


@tenant.get("/members", response_model=MemberListResponse, dependencies=[require_permission("members.view")])
async def list_members(ctx: Tenant, db: Db):
    return {"members": await BusinessService(db).list_members(ctx)}


# Every member manages only their own preferences; membership is checked by the tenant scope.
@tenant.get("/me/notifications", response_model=NotificationPrefsResponse)
async def get_notification_prefs(ctx: Tenant, db: Db):
    return {"prefs": await BusinessService(db).notification_prefs(ctx)}


@tenant.put("/me/notifications", response_model=NotificationPrefsResponse)
async def put_notification_prefs(body: NotificationPrefs, ctx: Tenant, db: Db):
    return {"prefs": await BusinessService(db).update_notification_prefs(ctx, body)}
