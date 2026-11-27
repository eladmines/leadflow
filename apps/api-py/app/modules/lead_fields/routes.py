"""Custom lead fields (F34): registered inside the tenant scope."""

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.lead_fields import schemas as s
from app.modules.lead_fields.service import LeadFieldService

tenant = tenant_router()


@tenant.get(
    "/lead-fields", response_model=s.LeadFieldListResponse, dependencies=[require_permission("leads.view")]
)
async def list_fields(ctx: Tenant, db: Db):
    return {"fields": await LeadFieldService(db).list_fields(ctx)}


@tenant.post(
    "/lead-fields",
    status_code=201,
    response_model=s.LeadFieldResponse,
    dependencies=[require_permission("leadFields.manage")],
)
async def create_field(body: s.CreateLeadFieldRequest, ctx: Tenant, db: Db):
    return {"field": await LeadFieldService(db).create(ctx, body)}


# Declared before `/lead-fields/{field_id}` (a different method, but kept first for clarity).
@tenant.put(
    "/lead-fields/order",
    response_model=s.LeadFieldListResponse,
    dependencies=[require_permission("leadFields.manage")],
)
async def reorder_fields(body: s.ReorderLeadFieldsRequest, ctx: Tenant, db: Db):
    return {"fields": await LeadFieldService(db).reorder(ctx, body)}


@tenant.patch(
    "/lead-fields/{field_id}",
    response_model=s.LeadFieldResponse,
    dependencies=[require_permission("leadFields.manage")],
)
async def update_field(field_id: str, body: s.UpdateLeadFieldRequest, ctx: Tenant, db: Db):
    return {"field": await LeadFieldService(db).update(ctx, field_id, body)}
