"""In-app notifications (D-097): a bell with the unread count and a list, plus pop-ups.

Port of apps/api/src/modules/notifications/service.ts. Each notification is for one user in one
business; the server decides who gets it using the same visibility rules as the rest of the CRM.
"""

import logging
import uuid
from collections.abc import Iterable
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import iso, now_ms
from app.db.models import Membership, MembershipRole, MembershipStatus, Notification, User, UserStatus
from app.deps import TenantContext

log = logging.getLogger("simplecatch")

NOTIFICATION_TYPES = (
    "lead.new",
    "whatsapp.message",
    "whatsapp.new_number",
    "appointment.booked",
    "appointment.cancelled",
    "quote.accepted",
    "quote.rejected",
    "task.due",
    "domain.expiring",
)

# Owners and managers: they see every lead (`leads.view.all`).
MANAGERS = (MembershipRole.OWNER, MembershipRole.MANAGER)
LIST_SIZE = 30


class NotificationOut(BaseModel):
    id: str
    type: Literal[
        "lead.new",
        "whatsapp.message",
        "whatsapp.new_number",
        "appointment.booked",
        "appointment.cancelled",
        "quote.accepted",
        "quote.rejected",
        "task.due",
        "domain.expiring",
    ]
    data: dict[str, Any]
    readAt: str | None
    createdAt: str


class NotificationListResponse(BaseModel):
    """Newest first (the latest 30)."""

    notifications: list[NotificationOut]
    unreadCount: int


class MarkReadRequest(BaseModel):
    """Marks these notifications read; without `ids`, all of the user's notifications here."""

    ids: list[uuid.UUID] | None = Field(default=None, max_length=100)


async def notify(
    db: AsyncSession,
    *,
    business_id: uuid.UUID,
    type: str,
    data: dict[str, Any],
    roles: Iterable[MembershipRole] = (),
    user_ids: Iterable[uuid.UUID | None] = (),
    except_user_id: uuid.UUID | None = None,
) -> int:
    """One notification per active member among the recipients. Only members of the business are
    notified, whatever ids are passed in. Adds rows to the session; the caller commits."""
    roles = list(roles)
    ids = [u for u in user_ids if u]
    conditions = []
    if roles:
        conditions.append(Membership.role.in_(roles))
    if ids:
        conditions.append(Membership.user_id.in_(ids))
    if not conditions:
        return 0
    rows = await db.execute(
        select(Membership.user_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.business_id == business_id,
            Membership.status == MembershipStatus.ACTIVE,
            User.status == UserStatus.ACTIVE,
            or_(*conditions),
        )
    )
    targets = [u for u in dict.fromkeys(r[0] for r in rows) if u != except_user_id]
    now = now_ms()
    for user_id in targets:
        db.add(
            Notification(
                id=uuid.uuid4(),
                business_id=business_id,
                user_id=user_id,
                type=type,
                data=data,
                created_at=now,
            )
        )
    return len(targets)


async def notify_safe(db: AsyncSession, **kwargs: Any) -> None:
    """Best effort: a failed notification never breaks the action that caused it."""
    try:
        await notify(db, **kwargs)
        await db.commit()
    except Exception as err:
        await db.rollback()
        log.error("notification failed", extra={"errName": type(err).__name__, "type": kwargs.get("type")})


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_for(self, ctx: TenantContext) -> NotificationListResponse:
        """The caller's latest notifications in this business and how many are unread."""
        mine = (Notification.business_id == ctx.business_id, Notification.user_id == ctx.user_id)
        rows = (
            (
                await self.db.execute(
                    select(Notification)
                    .where(*mine)
                    .order_by(Notification.created_at.desc())
                    .limit(LIST_SIZE)
                )
            )
            .scalars()
            .all()
        )
        unread = (
            await self.db.execute(
                select(func.count()).select_from(Notification).where(*mine, Notification.read_at.is_(None))
            )
        ).scalar_one()
        return NotificationListResponse(
            notifications=[
                NotificationOut(
                    id=str(r.id),
                    type=r.type,
                    data=r.data or {},
                    readAt=iso(r.read_at) if r.read_at else None,
                    createdAt=iso(r.created_at),
                )
                for r in rows
                if r.type in NOTIFICATION_TYPES
            ],
            unreadCount=unread,
        )

    async def mark_read(self, ctx: TenantContext, ids: list[uuid.UUID] | None) -> None:
        """Marks the caller's notifications read (these ids, or all of them)."""
        stmt = update(Notification).where(
            Notification.business_id == ctx.business_id,
            Notification.user_id == ctx.user_id,
            Notification.read_at.is_(None),
        )
        if ids is not None:
            stmt = stmt.where(Notification.id.in_(ids))
        await self.db.execute(stmt.values(read_at=now_ms()))
        await self.db.commit()
