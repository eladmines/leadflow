"""F24 unified inbox (D-158): owners and managers, like the WhatsApp inbox before it."""

from typing import Annotated

from fastapi import Query, Request
from starlette.responses import Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.conversations.service import (
    ConversationListResponse,
    ConversationResponse,
    ConversationService,
    ListQuery,
    UnreadResponse,
)
from app.modules.whatsapp import schemas as ws
from app.modules.whatsapp.routes import service_for

tenant = tenant_router()
GUARD = [require_permission("whatsapp.inbox")]


def _svc(request: Request, db: Db) -> ConversationService:
    return ConversationService(db, service_for(request, db))


@tenant.get("/conversations", response_model=ConversationListResponse, dependencies=GUARD)
async def list_conversations(ctx: Tenant, request: Request, db: Db, q: Annotated[ListQuery, Query()]):
    return await _svc(request, db).list_page(ctx, q)


@tenant.get("/conversations/unread", response_model=UnreadResponse, dependencies=GUARD)
async def unread(ctx: Tenant, request: Request, db: Db):
    return UnreadResponse(unreadCount=await _svc(request, db).unread_count(ctx))


@tenant.get("/conversations/{conversation_id}", response_model=ConversationResponse, dependencies=GUARD)
async def detail(conversation_id: str, ctx: Tenant, request: Request, db: Db):
    return await _svc(request, db).detail(ctx, conversation_id)


@tenant.post("/conversations/{conversation_id}/read", status_code=204, dependencies=GUARD)
async def mark_read(conversation_id: str, ctx: Tenant, request: Request, db: Db):
    await _svc(request, db).mark_read(ctx, conversation_id)
    return Response(status_code=204)


@tenant.post(
    "/conversations/{conversation_id}/messages",
    status_code=201,
    response_model=ws.SendResponse,
    dependencies=GUARD,
)
async def send_message(conversation_id: str, body: ws.SendRequest, ctx: Tenant, request: Request, db: Db):
    message, _ = await _svc(request, db).send(ctx, conversation_id, body.text)
    return ws.SendResponse(message=message)
