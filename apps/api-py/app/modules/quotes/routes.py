"""Quotes (F18): the team's routes (tenant scope) and the customer's quote page (no login)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from app.core.ratelimit import rate_limited
from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.quotes import schemas as s
from app.modules.quotes.service import QuoteService

VIEW = [require_permission("quotes.view")]
tenant = tenant_router()


def _svc(request: Request, db: Db) -> QuoteService:
    return QuoteService(db, request.app.state.settings, request.app.state.email)


@tenant.get("/quotes", response_model=s.QuoteListResponse, dependencies=VIEW)
async def list_quotes(ctx: Tenant, request: Request, db: Db, q: Annotated[s.QuoteListQuery, Query()]):
    return {"quotes": await _svc(request, db).list_quotes(ctx, q)}


@tenant.post("/quotes", status_code=201, response_model=s.QuoteResponse, dependencies=VIEW)
async def create_quote(body: s.CreateQuoteRequest, ctx: Tenant, request: Request, db: Db):
    return {"quote": await _svc(request, db).create(ctx, body)}


@tenant.get("/quotes/{quote_id}", response_model=s.QuoteResponse, dependencies=VIEW)
async def get_quote(quote_id: str, ctx: Tenant, request: Request, db: Db):
    return {"quote": await _svc(request, db).get(ctx, quote_id)}


@tenant.put("/quotes/{quote_id}", response_model=s.QuoteResponse, dependencies=VIEW)
async def update_quote(quote_id: str, body: s.UpsertQuoteRequest, ctx: Tenant, request: Request, db: Db):
    return {"quote": await _svc(request, db).update(ctx, quote_id, body)}


@tenant.delete("/quotes/{quote_id}", status_code=204, dependencies=VIEW)
async def delete_quote(quote_id: str, ctx: Tenant, request: Request, db: Db):
    await _svc(request, db).remove(ctx, quote_id)
    return Response(status_code=204)


@tenant.post("/quotes/{quote_id}/send", response_model=s.QuoteResponse, dependencies=VIEW)
async def send_quote(quote_id: str, body: s.SendQuoteRequest, ctx: Tenant, request: Request, db: Db):
    return {"quote": await _svc(request, db).send(ctx, quote_id, body.email)}


@tenant.post(
    "/quotes/{quote_id}/duplicate", status_code=201, response_model=s.QuoteResponse, dependencies=VIEW
)
async def duplicate_quote(quote_id: str, ctx: Tenant, request: Request, db: Db):
    return {"quote": await _svc(request, db).duplicate(ctx, quote_id)}


@tenant.post("/quotes/{quote_id}/status", response_model=s.QuoteResponse, dependencies=VIEW)
async def decide_quote(quote_id: str, body: s.DecideQuoteRequest, ctx: Tenant, request: Request, db: Db):
    return {"quote": await _svc(request, db).decide(ctx, quote_id, body.status)}


# The customer's quote page (no login: the unguessable link is the permission).
public = APIRouter(prefix="/api/v1/public/quotes", tags=["quotes"])
NO_STORE = {"cache-control": "no-store", "x-robots-tag": "noindex"}


@public.get("/{token}", response_model=s.PublicQuoteResponse)
async def public_quote(token: str, request: Request, db: Db, response: Response):
    response.headers.update(NO_STORE)
    return {"quote": await _svc(request, db).public_get(token)}


@public.post(
    "/{token}/decision",
    response_model=s.PublicQuoteResponse,
    dependencies=[Depends(rate_limited("quote-decision", 20, 600_000))],
)
async def public_decision(
    token: str, body: s.PublicDecisionRequest, request: Request, db: Db, response: Response
):
    response.headers.update(NO_STORE)
    return {
        "quote": await _svc(request, db).public_decide(token, body.decision, request.app.state.sessionmaker)
    }
