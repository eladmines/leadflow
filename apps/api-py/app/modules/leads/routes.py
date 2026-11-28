"""Leads & CRM (F07 list, F08 CRM) and customers; registered inside the tenant scope."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Query, Request, Response
from sqlalchemy import select

from app.core.csv import to_csv
from app.core.dates import format_short
from app.db.models import Business
from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.audit import add_audit
from app.modules.lead_fields.service import export_cell, export_columns, load_definitions
from app.modules.leads import schemas as s
from app.modules.leads.service import LeadService
from app.shared.phone import format_israeli_phone

tenant = tenant_router()


@tenant.get("/leads", response_model=s.LeadListResponse, dependencies=[require_permission("leads.view")])
async def list_leads(request: Request, ctx: Tenant, db: Db, q: Annotated[s.LeadListQuery, Query()]):
    # F34: `cf[<fieldId>]...` filters are read from the raw query string.
    params = request.query_params.multi_items()
    return {"leads": await LeadService(db).list_leads(ctx, q, params=params)}


# Paying customers (D-163): one row per contact who bought.
@tenant.get(
    "/customers", response_model=s.CustomerListResponse, dependencies=[require_permission("leads.view")]
)
async def list_customers(ctx: Tenant, db: Db, q: Annotated[s.CustomerListQuery, Query()]):
    return {"customers": await LeadService(db).customers(ctx, q.q)}


# D-179: bulk import (the spreadsheet is read in the browser; rows arrive as JSON).
@tenant.post(
    "/customers/import",
    response_model=s.ImportCustomersResponse,
    dependencies=[require_permission("customers.import")],
)
async def import_customers(body: s.ImportCustomersRequest, ctx: Tenant, db: Db):
    return await LeadService(db).import_customers(ctx, body.rows)


# Declared before `/leads/{lead_id}` so the static segments win.
@tenant.get("/leads/export.csv", dependencies=[require_permission("leads.export")])
async def export_csv(request: Request, ctx: Tenant, db: Db, q: Annotated[s.LeadListQuery, Query()]):
    leads = await LeadService(db).list_leads(ctx, q, 10_000, params=request.query_params.multi_items())
    # F34: one column per active custom field, in order, headed by its label as written.
    fields = export_columns(await load_definitions(db, ctx.business_id))
    tz = (await db.execute(select(Business.timezone).where(Business.id == ctx.business_id))).scalar_one()

    def when(value: str) -> str:
        return format_short(datetime.fromisoformat(value.replace("Z", "+00:00")), tz)

    csv = to_csv(
        [
            "שם",
            "טלפון",
            "אימייל",
            "שלב",
            "מקור",
            "אחראי",
            "פרטי הפנייה",
            "נוצר",
            *(f.label for f in fields),
        ],
        [
            [
                lead.contact.name,
                format_israeli_phone(lead.contact.phone) if lead.contact.phone else "",
                lead.contact.email,
                lead.stage.name,
                s.LEAD_SOURCE_LABELS[lead.source],
                lead.owner.name if lead.owner else None,
                lead.message,
                when(lead.createdAt),
                *(export_cell(f, lead.customFields.get(str(f.id))) for f in fields),
            ]
            for lead in leads
        ],
    )
    add_audit(
        db,
        "leads.exported",
        business_id=ctx.business_id,
        actor_user_id=ctx.user_id,
        entity_type="lead",
        metadata={"count": len(leads)},
    )
    await db.commit()
    date = datetime.now(UTC).strftime("%Y-%m-%d")
    return Response(
        content=csv.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "content-disposition": f'attachment; filename="simplecatch-leads-{date}.csv"',
            "cache-control": "no-store",
        },
    )


@tenant.get("/leads/tags", response_model=s.LeadTagsResponse, dependencies=[require_permission("leads.view")])
async def lead_tags(ctx: Tenant, db: Db):
    return {"tags": await LeadService(db).tags(ctx)}


@tenant.post(
    "/leads",
    status_code=201,
    response_model=s.LeadResponse,
    dependencies=[require_permission("leads.create")],
)
async def create_lead(body: s.CreateLeadRequest, ctx: Tenant, db: Db):
    return {"lead": await LeadService(db).create(ctx, body)}


@tenant.get(
    "/leads/{lead_id}", response_model=s.LeadDetailResponse, dependencies=[require_permission("leads.view")]
)
async def lead_detail(lead_id: str, ctx: Tenant, db: Db):
    return await LeadService(db).detail(ctx, lead_id)


@tenant.patch(
    "/leads/{lead_id}", response_model=s.LeadResponse, dependencies=[require_permission("leads.update")]
)
async def update_lead(lead_id: str, body: s.UpdateLeadRequest, ctx: Tenant, db: Db):
    return {"lead": await LeadService(db).update(ctx, lead_id, body)}


@tenant.delete("/leads/{lead_id}", status_code=204, dependencies=[require_permission("leads.delete")])
async def delete_lead(lead_id: str, ctx: Tenant, db: Db):
    await LeadService(db).remove(ctx, lead_id)
    return Response(status_code=204)


@tenant.post(
    "/leads/{lead_id}/notes",
    status_code=201,
    response_model=s.ActivityResponse,
    dependencies=[require_permission("leads.update")],
)
async def add_note(lead_id: str, body: s.AddNoteRequest, ctx: Tenant, db: Db):
    return {"activity": await LeadService(db).add_note(ctx, lead_id, body.text)}


@tenant.get("/pipeline", response_model=s.PipelineResponse, dependencies=[require_permission("leads.view")])
async def pipeline(ctx: Tenant, db: Db):
    return {"stages": await LeadService(db).pipeline(ctx)}


@tenant.get(
    "/contacts/duplicates",
    response_model=s.DuplicatesResponse,
    dependencies=[require_permission("leads.create")],
)
async def duplicates(ctx: Tenant, db: Db, q: Annotated[s.DuplicateQuery, Query()]):
    return {"contacts": await LeadService(db).duplicates(ctx, q.phone, q.email)}
