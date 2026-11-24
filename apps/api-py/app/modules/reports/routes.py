"""Basic reports (F20 lite); registered inside the tenant scope."""

from typing import Annotated

from fastapi import Query
from pydantic import BaseModel, field_validator

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.reports.service import REPORT_RANGES, ReportService, ReportSummary

tenant = tenant_router()


class ReportQuery(BaseModel):
    days: int = 30

    @field_validator("days")
    @classmethod
    def _range(cls, v: int) -> int:
        if v not in REPORT_RANGES:
            raise ValueError("days must be 7, 30 or 90")
        return v


@tenant.get(
    "/reports/summary", response_model=ReportSummary, dependencies=[require_permission("reports.view")]
)
async def summary(ctx: Tenant, db: Db, q: Annotated[ReportQuery, Query()]):
    return await ReportService(db).summary(ctx, q.days)
