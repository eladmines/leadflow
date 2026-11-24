"""Team endpoints: owner-side management (tenant scope) and the invitee side (preview, accept)."""

from fastapi import APIRouter, Depends, Request, Response

from app.core.ratelimit import rate_limited
from app.deps import Auth, Db, Tenant, require_permission, tenant_router
from app.modules.team import schemas as s
from app.modules.team.service import TeamService

MANAGE = [require_permission("members.manage")]


def _team(request: Request, db: Db) -> TeamService:
    return TeamService(db, request.app.state.settings, request.app.state.email)


# Owner side: registered inside the tenant scope.
tenant = tenant_router()


@tenant.get("/invitations", response_model=s.InvitationListResponse, dependencies=MANAGE)
async def list_invitations(ctx: Tenant, request: Request, db: Db):
    return {"invitations": await _team(request, db).list_invitations(ctx)}


@tenant.post("/invitations", status_code=201, response_model=s.InvitationResponse, dependencies=MANAGE)
async def invite(body: s.InviteRequest, ctx: Tenant, request: Request, db: Db):
    return {"invitation": await _team(request, db).invite(ctx, body.email, body.role)}


@tenant.post("/invitations/{invite_id}/resend", response_model=s.InvitationResponse, dependencies=MANAGE)
async def resend(invite_id: str, ctx: Tenant, request: Request, db: Db):
    return {"invitation": await _team(request, db).resend(ctx, invite_id)}


@tenant.delete("/invitations/{invite_id}", status_code=204, dependencies=MANAGE)
async def revoke(invite_id: str, ctx: Tenant, request: Request, db: Db):
    await _team(request, db).revoke(ctx, invite_id)
    return Response(status_code=204)


@tenant.patch("/members/{user_id}", status_code=204, dependencies=MANAGE)
async def change_role(user_id: str, body: s.UpdateMemberRequest, ctx: Tenant, request: Request, db: Db):
    await _team(request, db).change_role(ctx, user_id, body.role)
    return Response(status_code=204)


@tenant.delete("/members/{user_id}", status_code=204, dependencies=MANAGE)
async def remove_member(user_id: str, ctx: Tenant, request: Request, db: Db):
    await _team(request, db).remove(ctx, user_id)
    return Response(status_code=204)


# Invitee side: preview (no sign-in needed) and accept (signed in as the invited email).
router = APIRouter(prefix="/api/v1/invitations", tags=["team"])


@router.post(
    "/preview",
    response_model=s.InvitePreviewResponse,
    dependencies=[Depends(rate_limited("invite-preview"))],
)
async def preview(body: s.InviteTokenRequest, request: Request, db: Db):
    return {"invite": await _team(request, db).preview(body.token)}


@router.post(
    "/accept",
    response_model=s.AcceptInviteResponse,
    dependencies=[Depends(rate_limited("invite-accept"))],
)
async def accept(body: s.InviteTokenRequest, auth: Auth, request: Request, db: Db):
    return await _team(request, db).accept(body.token, auth.user)
