"""Businesses: create, read, update, onboarding, members, notification preferences (F02).

Port of apps/api/src/modules/businesses/{service,repo}.ts. Tenant reads and writes are keyed by
`ctx.business_id`; the only non-tenant queries are "my businesses" (by user) and create.
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import iso, now_ms
from app.db.models import (
    Business,
    BusinessStatus,
    Membership,
    MembershipRole,
    MembershipStatus,
    User,
)
from app.deps import TenantContext
from app.errors import AppError
from app.modules.audit import add_audit, record_audit_safe
from app.shared.business import (
    BUSINESS_MESSAGES,
    LANGUAGES,
    BusinessDto,
    BusinessSummary,
    CreateBusinessRequest,
    Member,
    NotificationPrefs,
    OpeningHours,
    UpdateBusinessRequest,
)
from app.shared.industries import INDUSTRIES


def to_business_dto(business: Business, role: str) -> BusinessDto:
    try:
        hours = OpeningHours.model_validate(business.opening_hours).model_dump(by_alias=True)
    except Exception:
        hours = None
    return BusinessDto(
        id=str(business.id),
        name=business.name,
        industry=business.industry if business.industry in INDUSTRIES else "other",
        phone=business.phone,
        address=business.address,
        serviceAreas=list(business.service_areas or []),
        openingHours=hours,
        websiteUrl=business.website_url,
        timezone=business.timezone,
        language=business.language if business.language in LANGUAGES else "he",
        status=business.status.value,
        onboardingStep=business.onboarding_step,
        role=role,
        createdAt=iso(business.created_at),
    )


class BusinessService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _get(self, ctx: TenantContext) -> Business:
        return (await self.db.execute(select(Business).where(Business.id == ctx.business_id))).scalar_one()

    async def list_mine(self, user_id: uuid.UUID) -> list[BusinessSummary]:
        rows = await self.db.execute(
            select(Membership, Business)
            .join(Business, Business.id == Membership.business_id)
            .where(Membership.user_id == user_id, Membership.status == MembershipStatus.ACTIVE)
            .order_by(Membership.created_at.asc())
        )
        return [
            BusinessSummary(
                id=str(b.id),
                name=b.name,
                status=b.status.value,
                onboardingStep=b.onboarding_step,
                role=m.role.value,
            )
            for m, b in rows
        ]

    async def create(self, user_id: uuid.UUID, data: CreateBusinessRequest) -> BusinessDto:
        # One owned business per user for now (businesses they were invited to don't count).
        owned = (
            await self.db.execute(
                select(func.count())
                .select_from(Membership)
                .where(Membership.user_id == user_id, Membership.role == MembershipRole.OWNER)
            )
        ).scalar_one()
        if owned > 0:
            raise AppError("CONFLICT", BUSINESS_MESSAGES["onlyOneBusiness"])

        now = now_ms()
        business = Business(
            id=uuid.uuid4(),
            name=data.name,
            industry=data.industry,
            language=data.language,
            # Step 1 (name + industry) is done at creation, so the wizard resumes at step 2.
            status=BusinessStatus.ONBOARDING,
            onboarding_step=2,
            created_at=now,
            updated_at=now,
        )
        self.db.add(business)
        await self.db.flush()
        self.db.add(
            Membership(
                id=uuid.uuid4(),
                user_id=user_id,
                business_id=business.id,
                role=MembershipRole.OWNER,
                created_at=now,
                updated_at=now,
            )
        )
        add_audit(
            self.db,
            "business.created",
            business_id=business.id,
            actor_user_id=user_id,
            entity_type="business",
            entity_id=business.id,
            metadata={"industry": data.industry},
        )
        await self.db.commit()
        return to_business_dto(business, "OWNER")

    async def get(self, ctx: TenantContext) -> BusinessDto:
        return to_business_dto(await self._get(ctx), ctx.role)

    async def update(self, ctx: TenantContext, data: UpdateBusinessRequest) -> BusinessDto:
        current = await self._get(ctx)
        given = data.model_fields_set
        changed: list[str] = []

        def set_field(attr: str, value: Any, key: str) -> None:
            setattr(current, attr, value)
            changed.append(key)

        if "name" in given and data.name is not None:
            set_field("name", data.name, "name")
        if "industry" in given and data.industry is not None:
            set_field("industry", data.industry, "industry")
        if "phone" in given:
            set_field("phone", data.phone, "phone")
        if "address" in given:
            set_field("address", data.address, "address")
        if "serviceAreas" in given and data.serviceAreas is not None:
            set_field("service_areas", data.serviceAreas, "serviceAreas")
        if "websiteUrl" in given:
            # A different address is a different domain: forget what we read about the old one.
            if data.websiteUrl != current.website_url:
                current.domain_expires_at = None
                current.domain_checked_at = None
                current.domain_check = None
                current.domain_reminded_days = None
            set_field("website_url", data.websiteUrl, "websiteUrl")
        if "language" in given and data.language is not None:
            set_field("language", data.language, "language")
        if "openingHours" in given:
            hours = data.openingHours.model_dump(by_alias=True) if data.openingHours else None
            set_field("opening_hours", hours, "openingHours")
        # Wizard progress only matters while onboarding.
        if (
            "onboardingStep" in given
            and data.onboardingStep is not None
            and current.status == BusinessStatus.ONBOARDING
        ):
            set_field("onboarding_step", data.onboardingStep, "onboardingStep")

        if not changed:
            return to_business_dto(current, ctx.role)

        current.updated_at = now_ms()
        await self.db.commit()
        # Field names only: values may contain personal data (phone, address).
        await record_audit_safe(
            self.db,
            "business.updated",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="business",
            entity_id=ctx.business_id,
            metadata={"fields": changed},
        )
        return to_business_dto(current, ctx.role)

    async def complete_onboarding(self, ctx: TenantContext) -> BusinessDto:
        """Validates the required profile and activates the business. Idempotent once ACTIVE."""
        current = await self._get(ctx)
        if current.status != BusinessStatus.ONBOARDING:
            return to_business_dto(current, ctx.role)
        fields: dict[str, str] = {}
        if not current.name:
            fields["name"] = BUSINESS_MESSAGES["nameRequired"]
        if not current.industry:
            fields["industry"] = BUSINESS_MESSAGES["industryRequired"]
        if not current.phone:
            fields["phone"] = BUSINESS_MESSAGES["phoneRequired"]
        if fields:
            raise AppError("VALIDATION_ERROR", BUSINESS_MESSAGES["onboardingIncomplete"], fields)

        current.status = BusinessStatus.ACTIVE
        current.updated_at = now_ms()
        add_audit(
            self.db,
            "business.onboarding.completed",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="business",
            entity_id=ctx.business_id,
        )
        await self.db.commit()
        return to_business_dto(current, ctx.role)

    async def notification_prefs(self, ctx: TenantContext) -> NotificationPrefs:
        notify = (
            await self.db.execute(
                select(Membership.notify_new_leads).where(
                    Membership.user_id == ctx.user_id, Membership.business_id == ctx.business_id
                )
            )
        ).scalar_one()
        return NotificationPrefs(newLeadEmail=notify)

    async def update_notification_prefs(
        self, ctx: TenantContext, prefs: NotificationPrefs
    ) -> NotificationPrefs:
        membership = (
            await self.db.execute(
                select(Membership).where(
                    Membership.user_id == ctx.user_id, Membership.business_id == ctx.business_id
                )
            )
        ).scalar_one()
        membership.notify_new_leads = prefs.newLeadEmail
        membership.updated_at = now_ms()
        await self.db.commit()
        return prefs

    async def list_members(self, ctx: TenantContext) -> list[Member]:
        rows = await self.db.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.business_id == ctx.business_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
            .order_by(Membership.created_at.asc())
        )
        return [
            Member(
                userId=str(m.user_id),
                fullName=u.full_name,
                email=u.email,
                role=m.role.value,
                joinedAt=iso(m.created_at),
            )
            for m, u in rows
        ]
