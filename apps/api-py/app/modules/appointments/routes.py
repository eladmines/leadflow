"""Services and appointments (F17); registered inside the tenant scope."""

from typing import Annotated

from fastapi import Query, Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.appointments import schemas as s
from app.modules.appointments.service import AppointmentService

tenant = tenant_router()
VIEW = [require_permission("appointments.view")]
MANAGE = [require_permission("services.manage")]


@tenant.get("/services", response_model=s.ServiceListResponse, dependencies=VIEW)
async def list_services(ctx: Tenant, db: Db):
    return {"services": await AppointmentService(db).list_services(ctx)}


@tenant.post("/services", status_code=201, response_model=s.ServiceResponse, dependencies=MANAGE)
async def create_service(body: s.UpsertServiceRequest, ctx: Tenant, db: Db):
    return {"service": await AppointmentService(db).create_service(ctx, body)}


@tenant.put("/services/{service_id}", response_model=s.ServiceResponse, dependencies=MANAGE)
async def update_service(service_id: str, body: s.UpsertServiceRequest, ctx: Tenant, db: Db):
    return {"service": await AppointmentService(db).update_service(ctx, service_id, body)}


@tenant.delete("/services/{service_id}", status_code=204, dependencies=MANAGE)
async def delete_service(service_id: str, ctx: Tenant, db: Db):
    await AppointmentService(db).remove_service(ctx, service_id)
    return Response(status_code=204)


@tenant.get("/appointments", response_model=s.AppointmentListResponse, dependencies=VIEW)
async def list_appointments(ctx: Tenant, db: Db, q: Annotated[s.AppointmentListQuery, Query()]):
    return {"appointments": await AppointmentService(db).list_appointments(ctx, q)}


# Static segment before `/appointments/{id}`.
@tenant.get("/appointments/requests", response_model=s.AppointmentListResponse, dependencies=VIEW)
async def appointment_requests(ctx: Tenant, db: Db):
    return {"appointments": await AppointmentService(db).requests(ctx)}


@tenant.post("/appointments", status_code=201, response_model=s.AppointmentResponse, dependencies=VIEW)
async def create_appointment(body: s.CreateAppointmentRequest, ctx: Tenant, db: Db):
    return {"appointment": await AppointmentService(db).create(ctx, body)}


@tenant.patch("/appointments/{appointment_id}", response_model=s.AppointmentResponse, dependencies=VIEW)
async def update_appointment(appointment_id: str, body: s.UpdateAppointmentRequest, ctx: Tenant, db: Db):
    return {"appointment": await AppointmentService(db).update(ctx, appointment_id, body)}
