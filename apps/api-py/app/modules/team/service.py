"""Team invitations and member management (F09), port of apps/api/src/modules/team/service.ts."""

import logging
import re
import uuid
from datetime import timedelta
from urllib.parse import quote

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import Settings
from app.core.crypto import sha256_hex
from app.core.security import generate_token
from app.core.timeutil import iso, now_ms
from app.db.models import (
    Business,
    Invitation,
    Membership,
    MembershipRole,
    MembershipStatus,
    User,
)
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.email.templates import invite_template
from app.modules.audit import add_audit
from app.modules.team import schemas as s

log = logging.getLogger("simplecatch")

ROLE_LABELS_HE = {"OWNER": "בעל/ת העסק", "MANAGER": "מנהל/ת צוות", "EMPLOYEE": "עובד/ת"}
ROLE_LABELS_EN = {"OWNER": "Owner", "MANAGER": "Manager", "EMPLOYEE": "Employee"}
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)


def _dto(inv: Invitation) -> s.Invitation:
    return s.Invitation(
        id=str(inv.id),
        email=inv.email,
        role=inv.role.value,
        invitedBy=inv.invited_by.full_name if inv.invited_by else None,
        expiresAt=iso(inv.expires_at),
        createdAt=iso(inv.created_at),
    )


def _pending(business_id: uuid.UUID):
    now = now_ms()
    return (
        Invitation.business_id == business_id,
        Invitation.accepted_at.is_(None),
        Invitation.revoked_at.is_(None),
        Invitation.expires_at > now,
    )


class TeamService:
    def __init__(self, db: AsyncSession, settings: Settings, email: EmailSender) -> None:
        self.db = db
        self.settings = settings
        self.email = email

    # -- owner side ----------------------------------------------------------

    async def list_invitations(self, ctx: TenantContext) -> list[s.Invitation]:
        rows = await self.db.execute(
            select(Invitation)
            .options(joinedload(Invitation.invited_by))
            .where(*_pending(ctx.business_id))
            .order_by(Invitation.created_at.desc())
        )
        return [_dto(i) for i in rows.scalars().unique()]

    async def invite(self, ctx: TenantContext, email: str, role: str) -> s.Invitation:
        """Invites (or re-invites) an email; an older pending invite for it is replaced."""
        member = (
            await self.db.execute(
                select(Membership.id)
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.business_id == ctx.business_id,
                    Membership.status == MembershipStatus.ACTIVE,
                    User.email == email,
                )
            )
        ).first()
        if member:
            msg = s.TEAM_MESSAGES["alreadyMember"]
            raise AppError("CONFLICT", msg, {"email": msg})
        open_count = len(
            (await self.db.execute(select(Invitation.id).where(*_pending(ctx.business_id)))).all()
        )
        if open_count >= s.MAX_PENDING_INVITES:
            raise AppError("CONFLICT", s.TEAM_MESSAGES["tooManyInvites"])

        token = generate_token()
        now = now_ms()
        await self.db.execute(
            update(Invitation)
            .where(*_pending(ctx.business_id), Invitation.email == email)
            .values(revoked_at=now)
        )
        inv = Invitation(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            email=email,
            role=MembershipRole(role),
            token_hash=sha256_hex(token),
            expires_at=now + timedelta(seconds=s.INVITE_TTL_S),
            created_at=now,
            invited_by_id=ctx.user_id,
        )
        self.db.add(inv)
        add_audit(
            self.db,
            "member.invited",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="invitation",
            entity_id=inv.id,
            metadata={"role": role},
        )
        await self.db.commit()
        inv = await self._load(inv.id)
        await self._send_email(ctx.business_id, inv, token)
        return _dto(inv)

    async def _load(self, invite_id: uuid.UUID) -> Invitation:
        return (
            await self.db.execute(
                select(Invitation)
                .options(joinedload(Invitation.invited_by))
                .where(Invitation.id == invite_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def resend(self, ctx: TenantContext, invite_id: str) -> s.Invitation:
        """New token + fresh expiry for a pending invite (the old link stops working)."""
        inv = await self._find_pending(ctx, invite_id)
        token = generate_token()
        inv.token_hash = sha256_hex(token)
        inv.expires_at = now_ms() + timedelta(seconds=s.INVITE_TTL_S)
        await self.db.commit()
        inv = await self._load(inv.id)
        await self._send_email(ctx.business_id, inv, token)
        return _dto(inv)

    async def revoke(self, ctx: TenantContext, invite_id: str) -> None:
        inv = await self._find_pending(ctx, invite_id)
        inv.revoked_at = now_ms()
        add_audit(
            self.db,
            "invitation.revoked",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="invitation",
            entity_id=inv.id,
        )
        await self.db.commit()

    async def _find_pending(self, ctx: TenantContext, invite_id: str) -> Invitation:
        inv = None
        if _UUID.match(invite_id):
            inv = (
                await self.db.execute(
                    select(Invitation).where(
                        Invitation.id == uuid.UUID(invite_id), *_pending(ctx.business_id)
                    )
                )
            ).scalar_one_or_none()
        if inv is None:
            raise AppError("NOT_FOUND")
        return inv

    async def _send_email(self, business_id: uuid.UUID, inv: Invitation, token: str) -> None:
        business = (await self.db.execute(select(Business).where(Business.id == business_id))).scalar_one()
        en = business.language == "en"
        labels = ROLE_LABELS_EN if en else ROLE_LABELS_HE
        mail = invite_template(
            business_name=business.name,
            inviter_name=inv.invited_by.full_name if inv.invited_by else None,
            role_label=labels[inv.role.value],
            link=f"{self.settings.APP_URL}{s.INVITE_WEB_PATH}?token={quote(token, safe='')}",
            days=round(s.INVITE_TTL_S / 86400),
            lang="en" if en else "he",
        )
        try:
            await self.email.send(
                EmailMessage(to=inv.email, subject=mail.subject, html=mail.html, text=mail.text)
            )
        except Exception as err:
            # The invite stays valid; the owner can resend.
            log.error("invite email failed", extra={"errName": type(err).__name__, "template": "invite"})

    async def change_role(self, ctx: TenantContext, user_id: str, role: str) -> None:
        """Owner changes a manager/employee's role. The owner's own membership can't change here."""
        m = await self._find_member(ctx, user_id)
        if m.role == MembershipRole.OWNER:
            raise AppError("FORBIDDEN", s.TEAM_MESSAGES["cannotChangeOwner"])
        if m.role.value == role:
            return
        before = m.role.value
        m.role = MembershipRole(role)
        m.updated_at = now_ms()
        add_audit(
            self.db,
            "member.role_changed",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="membership",
            entity_id=m.id,
            metadata={"from": before, "to": role},
        )
        await self.db.commit()

    async def remove(self, ctx: TenantContext, user_id: str) -> None:
        """Removes access immediately (membership disabled; history and assigned leads are kept)."""
        m = await self._find_member(ctx, user_id)
        if m.role == MembershipRole.OWNER:
            raise AppError("FORBIDDEN", s.TEAM_MESSAGES["cannotChangeOwner"])
        m.status = MembershipStatus.DISABLED
        m.updated_at = now_ms()
        add_audit(
            self.db,
            "member.removed",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="membership",
            entity_id=m.id,
        )
        await self.db.commit()

    async def _find_member(self, ctx: TenantContext, user_id: str) -> Membership:
        m = None
        if _UUID.match(user_id):
            m = (
                await self.db.execute(
                    select(Membership).where(
                        Membership.business_id == ctx.business_id,
                        Membership.user_id == uuid.UUID(user_id),
                        Membership.status == MembershipStatus.ACTIVE,
                    )
                )
            ).scalar_one_or_none()
        if m is None:
            raise AppError("NOT_FOUND")
        return m

    # -- invitee side (not tenant-scoped: the token identifies the invitation) ----------------

    async def _by_token(self, token: str) -> Invitation:
        inv = (
            await self.db.execute(
                select(Invitation)
                .options(joinedload(Invitation.business), joinedload(Invitation.invited_by))
                .where(Invitation.token_hash == sha256_hex(token))
            )
        ).scalar_one_or_none()
        if inv is None:
            raise AppError("NOT_FOUND", s.TEAM_MESSAGES["inviteInvalid"])
        return inv

    async def preview(self, token: str) -> s.InvitePreview:
        inv = await self._by_token(token)
        if inv.accepted_at:
            status = "used"
        elif inv.revoked_at:
            status = "revoked"
        elif inv.expires_at <= now_ms():
            status = "expired"
        else:
            status = "valid"
        return s.InvitePreview(
            status=status,
            businessName=inv.business.name,
            email=inv.email,
            role=inv.role.value,
            invitedBy=inv.invited_by.full_name if inv.invited_by else None,
        )

    async def accept(self, token: str, user: User) -> s.AcceptInviteResponse:
        """Joins the business. The signed-in user's email must equal the invited email; the link
        proves they control that inbox, so the email is marked verified too."""
        inv = await self._by_token(token)
        if inv.accepted_at or inv.revoked_at or inv.expires_at <= now_ms():
            raise AppError("VALIDATION_ERROR", s.TEAM_MESSAGES["inviteInvalid"])
        if user.email != inv.email:
            raise AppError("FORBIDDEN", s.TEAM_MESSAGES["wrongAccount"])

        now = now_ms()
        # Single use, even under concurrency.
        claimed = await self.db.execute(
            update(Invitation)
            .where(
                Invitation.id == inv.id,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
            )
            .values(accepted_at=now)
        )
        if claimed.rowcount == 0:
            await self.db.rollback()
            raise AppError("VALIDATION_ERROR", s.TEAM_MESSAGES["inviteInvalid"])

        existing = (
            await self.db.execute(
                select(Membership).where(
                    Membership.user_id == user.id, Membership.business_id == inv.business_id
                )
            )
        ).scalar_one_or_none()
        if existing and existing.status == MembershipStatus.ACTIVE:
            await self.db.commit()  # already a member: nothing else to change
            return s.AcceptInviteResponse(businessId=str(inv.business_id))
        if existing:
            existing.status = MembershipStatus.ACTIVE
            existing.role = inv.role
            existing.invited_at = inv.created_at
            existing.updated_at = now
        else:
            self.db.add(
                Membership(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    business_id=inv.business_id,
                    role=inv.role,
                    invited_at=inv.created_at,
                    created_at=now,
                    updated_at=now,
                )
            )
        if user.email_verified_at is None:
            user.email_verified_at = now
        add_audit(
            self.db,
            "member.joined",
            business_id=inv.business_id,
            actor_user_id=user.id,
            entity_type="invitation",
            entity_id=inv.id,
            metadata={"role": inv.role.value},
        )
        await self.db.commit()
        return s.AcceptInviteResponse(businessId=str(inv.business_id))
