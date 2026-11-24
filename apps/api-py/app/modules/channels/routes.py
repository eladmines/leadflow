"""F25 (D-159): Settings → Channels. Everyone sees the status; only the owner connects."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from starlette.responses import RedirectResponse

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.channels import schemas as s
from app.modules.channels.service import ChannelService

tenant = tenant_router()
OWNER = [require_permission("business.update")]


def _svc(request: Request, db: Db) -> ChannelService:
    st = request.app.state
    return ChannelService(db, st.settings, st.meta_api, st.gmail_api)


@tenant.get(
    "/channels", response_model=s.ChannelsResponse, dependencies=[require_permission("business.view")]
)
async def channels_status(ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).status(ctx)


@tenant.post("/channels/whatsapp", response_model=s.ChannelsResponse, dependencies=OWNER)
async def connect_whatsapp(body: s.ConnectWhatsAppRequest, ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).connect_whatsapp(ctx, body)


@tenant.post("/channels/email", response_model=s.ChannelsResponse, dependencies=OWNER)
async def create_email(ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).create_email_address(ctx)


@tenant.get("/channels/facebook/start", response_model=s.FacebookStartResponse, dependencies=OWNER)
async def facebook_start(
    ctx: Tenant,
    request: Request,
    db: Db,
    for_: Annotated[Literal["facebook", "instagram"], Query(alias="for")] = "facebook",
):
    return _svc(request, db).facebook_start(ctx, for_)


@tenant.get(
    "/channels/facebook/pending/{pending_id}", response_model=s.FacebookPagesResponse, dependencies=OWNER
)
async def facebook_pages(pending_id: str, ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).facebook_pages(ctx, pending_id)


@tenant.post("/channels/facebook", response_model=s.ChannelsResponse, dependencies=OWNER)
async def connect_facebook(body: s.ConnectFacebookRequest, ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).connect_facebook(ctx, body)


@tenant.get("/channels/gmail/start", response_model=s.FacebookStartResponse, dependencies=OWNER)
async def gmail_start(ctx: Tenant, request: Request, db: Db):
    return _svc(request, db).gmail_start(ctx)


@tenant.post("/channels/instagram", response_model=s.ChannelsResponse, dependencies=OWNER)
async def connect_instagram(body: s.ConnectInstagramRequest, ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).connect_instagram(ctx, body)


@tenant.delete("/channels/{channel}", response_model=s.ChannelsResponse, dependencies=OWNER)
async def disconnect(
    channel: Literal["whatsapp", "messenger", "instagram", "email", "gmail"],
    ctx: Tenant,
    request: Request,
    db: Db,
):
    return await _svc(request, db).disconnect(ctx, channel)


# The sign-in callbacks: the signed state says for which business. Public, no cookies.
public = APIRouter(tags=["channels"])


@public.get(s.FACEBOOK_CALLBACK)
async def facebook_callback(
    request: Request,
    db: Db,
    code: Annotated[str | None, Query(max_length=2000)] = None,
    state: Annotated[str | None, Query(max_length=2000)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
):
    return RedirectResponse(await _svc(request, db).facebook_callback(code, state, error), status_code=302)


@public.get(s.GMAIL_CALLBACK)
async def gmail_callback(
    request: Request,
    db: Db,
    code: Annotated[str | None, Query(max_length=2000)] = None,
    state: Annotated[str | None, Query(max_length=2000)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
):
    return RedirectResponse(await _svc(request, db).gmail_callback(code, state, error), status_code=302)
