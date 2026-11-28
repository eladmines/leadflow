"""Emails owners and managers about a new website lead (best effort: a failed email never loses
the lead). Shared by the SimpleCatch sites (F07) and forms on other websites (F30)."""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import Business, Membership, MembershipRole, MembershipStatus, User, UserStatus
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.email.templates import new_lead_template
from app.modules.leads.schemas import LeadSubmission
from app.shared.phone import format_israeli_phone

log = logging.getLogger("simplecatch")


async def notify_team_by_email(
    db: AsyncSession,
    email: EmailSender,
    settings: Settings,
    business_id: uuid.UUID,
    business_name: str,
    data: LeadSubmission,
    requested: str | None = None,
) -> None:
    team = (
        await db.execute(
            select(User.email, User.status)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.business_id == business_id,
                Membership.status == MembershipStatus.ACTIVE,
                Membership.role.in_([MembershipRole.OWNER, MembershipRole.MANAGER]),
                Membership.notify_new_leads.is_(True),
            )
        )
    ).all()
    language = (await db.execute(select(Business.language).where(Business.id == business_id))).scalar_one()
    en = language == "en"
    message = data.message
    if requested:
        label = "Appointment request" if en else "בקשה לפגישה"
        message = f"{label}: {requested}" + (f"\n\n{data.message}" if data.message else "")
    mail = new_lead_template(
        business_name=business_name,
        name=data.name,
        phone=format_israeli_phone(data.phone),
        email=data.email,
        message=message,
        link=f"{settings.APP_URL}/b/{business_id}/leads",
        settings_link=f"{settings.APP_URL}/b/{business_id}/account",
        lang="en" if en else "he",
    )
    for address, status in team:
        if status != UserStatus.ACTIVE:
            continue
        try:
            await email.send(EmailMessage(to=address, subject=mail.subject, html=mail.html, text=mail.text))
        except Exception as err:
            log.error("lead email failed", extra={"errName": type(err).__name__, "template": "newLead"})
