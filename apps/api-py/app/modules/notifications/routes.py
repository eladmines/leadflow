"""The caller's own notifications (D-097), inside the tenant scope."""

from fastapi import Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.notifications.service import (
    MarkReadRequest,
    NotificationListResponse,
    NotificationService,
)

tenant = tenant_router()
VIEW = [require_permission("business.view")]


@tenant.get("/notifications", response_model=NotificationListResponse, dependencies=VIEW)
async def list_notifications(ctx: Tenant, db: Db):
    return await NotificationService(db).list_for(ctx)


@tenant.post("/notifications/read", status_code=204, dependencies=VIEW)
async def mark_read(body: MarkReadRequest, ctx: Tenant, db: Db):
    await NotificationService(db).mark_read(ctx, body.ids)
    return Response(status_code=204)
