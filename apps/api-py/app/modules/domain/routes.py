"""F33: everyone in the business sees when the domain expires; the owner can look it up now."""

from fastapi import Request

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.domain.service import DomainExpiryOut, DomainExpiryService

tenant = tenant_router()


def _svc(request: Request, db: Db) -> DomainExpiryService:
    st = request.app.state
    return DomainExpiryService(db, st.domain_expiry, st.email, st.settings, st.sessionmaker)


@tenant.get("/domain", response_model=DomainExpiryOut, dependencies=[require_permission("business.view")])
async def get_domain(ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).status_and_refresh(ctx)


@tenant.post("/domain", response_model=DomainExpiryOut, dependencies=[require_permission("business.update")])
async def check_domain(ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).check_now(ctx)
