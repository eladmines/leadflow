"""F33: when the business's website domain expires, and the 60/30/7-day reminders.

Port of apps/api/src/modules/domain/{service,watch,routes}.ts. A domain is looked up at most once
a day (the registries ask for no high-volume automated use).
"""

import asyncio
import contextlib
import logging
import math
import uuid
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.core.dates import format_long_date
from app.core.timeutil import iso, now_ms
from app.db.models import Business, Membership, MembershipRole, MembershipStatus, User, UserStatus
from app.deps import TenantContext
from app.integrations.domain import DomainExpiry
from app.integrations.email import EmailMessage, EmailSender
from app.integrations.email.templates import domain_expiry_template
from app.modules.notifications.service import notify_safe
from app.shared.domain import DOMAIN_CHECKS, DOMAIN_REMINDER_DAYS, registrable_domain

log = logging.getLogger("simplecatch")

DAY = timedelta(days=1)
RECHECK_AFTER = timedelta(hours=20)
MANUAL_COOLDOWN = timedelta(seconds=60)  # "Check now" can't be pressed more often than this
RETRY_FAILED_AFTER = timedelta(minutes=10)  # a failed lookup is retried when the screen opens after this
_in_flight: set[uuid.UUID] = set()  # so opening the screen twice asks the registry once
_background: set[asyncio.Task] = set()


class DomainExpiryOut(BaseModel):
    domain: str | None  # the domain being watched; null when the business has no existing website
    check: str | None  # ok | unsupported | failed; null: not checked yet
    expiresAt: str | None
    checkedAt: str | None
    daysLeft: int | None  # whole days until it expires (negative when it already has)
    checking: bool  # a lookup is running right now: ask again in a moment


def days_until(to: datetime, now: datetime) -> int:
    """Whole days from `now` to `to`, rounded up: a domain expiring in 6.2 days has 7 left."""
    return math.ceil((to - now).total_seconds() / DAY.total_seconds())


def reminder_due(days_left: int) -> int | None:
    """The tightest reminder already due: 60, 30 or 7 days before, or 0 (the day it expires and
    after); None while it is more than 60 days away."""
    crossed = [d for d in DOMAIN_REMINDER_DAYS if days_left <= d]
    return min(crossed) if crossed else None


class DomainExpiryService:
    def __init__(
        self,
        db: AsyncSession,
        provider: DomainExpiry,
        email: EmailSender,
        settings: Settings,
        sessionmaker: async_sessionmaker[AsyncSession],
    ) -> None:
        self.db = db
        self.provider = provider
        self.email = email
        self.settings = settings
        self.sessionmaker = sessionmaker

    async def _business(self, business_id: uuid.UUID) -> Business:
        return (
            await self.db.execute(
                select(Business).where(Business.id == business_id).execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def status_and_refresh(self, ctx: TenantContext, now: datetime | None = None) -> DomainExpiryOut:
        """What we know about the business's domain. When there is a domain nobody has looked up yet
        (or the last answer is a day old, or failed a while ago), the lookup starts in the
        background and `checking` says so: the screen shows the date a moment later."""
        now = now or now_ms()
        b = await self._business(ctx.business_id)
        age = (now - b.domain_checked_at) if b.domain_checked_at else None
        limit = RETRY_FAILED_AFTER if b.domain_check == "failed" else RECHECK_AFTER
        stale = age is None or age > limit
        if registrable_domain(b.website_url) and stale and ctx.business_id not in _in_flight:
            _in_flight.add(ctx.business_id)
            business_id = ctx.business_id

            async def run() -> None:
                try:
                    async with self.sessionmaker() as session:
                        await self._fresh(session).check(business_id, now)
                except Exception as err:
                    log.error("domain lookup on view failed", extra={"errName": type(err).__name__})
                finally:
                    _in_flight.discard(business_id)

            task = asyncio.create_task(run())
            _background.add(task)
            task.add_done_callback(_background.discard)
        return await self.status(ctx, now)

    def _fresh(self, session: AsyncSession) -> "DomainExpiryService":
        return DomainExpiryService(session, self.provider, self.email, self.settings, self.sessionmaker)

    async def status(self, ctx: TenantContext, now: datetime | None = None) -> DomainExpiryOut:
        b = await self._business(ctx.business_id)
        return self._dto(b, now or now_ms(), ctx.business_id in _in_flight)

    async def check_now(self, ctx: TenantContext, now: datetime | None = None) -> DomainExpiryOut:
        """Looks it up now (unless it was just looked up), and answers with what we know."""
        now = now or now_ms()
        b = await self._business(ctx.business_id)
        if not b.domain_checked_at or now - b.domain_checked_at > MANUAL_COOLDOWN:
            await self.check(ctx.business_id, now)
        return await self.status(ctx, now)

    async def check_due(self, now: datetime | None = None, limit: int = 20) -> int:
        """The daily job: every business whose domain wasn't looked up lately. Returns how many were."""
        now = now or now_ms()
        due = (
            (
                await self.db.execute(
                    select(Business.id)
                    .where(
                        Business.website_url.is_not(None),
                        (Business.domain_checked_at.is_(None))
                        | (Business.domain_checked_at < now - RECHECK_AFTER),
                    )
                    .order_by(Business.domain_checked_at.asc().nulls_first())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        for business_id in due:
            await self.check(business_id, now)
        return len(due)

    async def check(self, business_id: uuid.UUID, now: datetime | None = None) -> None:
        """One lookup, saved; then the reminders that are due (each goes out once per expiry date)."""
        now = now or now_ms()
        b = (
            await self.db.execute(
                select(Business).where(Business.id == business_id).execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if b is None:
            return
        domain = registrable_domain(b.website_url)
        if not domain:
            b.domain_check = b.domain_checked_at = b.domain_expires_at = None
            await self.db.commit()
            return
        found = await self.provider.lookup(domain)
        if found.status != "ok" or found.expires_at is None:
            # Keep an earlier date if the registry just didn't answer this time.
            b.domain_check = "ok" if found.status == "failed" and b.domain_expires_at else found.status
            b.domain_checked_at = now
            await self.db.commit()
            return
        # A later expiry than before means it was renewed: the reminders start over.
        renewed = bool(b.domain_expires_at and found.expires_at - b.domain_expires_at > 30 * DAY)
        reminded = None if renewed else b.domain_reminded_days
        days_left = days_until(found.expires_at, now)
        due = reminder_due(days_left)
        send = due is not None and (reminded is None or due < reminded)
        b.domain_check = "ok"
        b.domain_checked_at = now
        b.domain_expires_at = found.expires_at
        b.domain_reminded_days = due if send else (None if renewed else b.domain_reminded_days)
        language = b.language
        await self.db.commit()
        if send:
            await self._remind(business_id, language, domain, found.expires_at, days_left)

    async def _remind(
        self, business_id: uuid.UUID, language: str, domain: str, expires_at: datetime, days_left: int
    ) -> None:
        """The bell and an email for the owner and managers."""
        await notify_safe(
            self.db,
            business_id=business_id,
            type="domain.expiring",
            data={"domain": domain, "days": days_left, "expiresAt": iso(expires_at)},
            roles=[MembershipRole.OWNER, MembershipRole.MANAGER],
        )
        lang = "en" if language == "en" else "he"
        mail = domain_expiry_template(
            domain,
            format_long_date(expires_at, lang),
            days_left,
            f"{self.settings.app_url}/b/{business_id}/site",
            lang,
        )
        members = (
            await self.db.execute(
                select(User.email, User.status)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    Membership.business_id == business_id,
                    Membership.status == MembershipStatus.ACTIVE,
                    Membership.role.in_([MembershipRole.OWNER, MembershipRole.MANAGER]),
                )
            )
        ).all()
        for address, status in members:
            if status != UserStatus.ACTIVE:
                continue
            try:
                await self.email.send(
                    EmailMessage(to=address, subject=mail.subject, html=mail.html, text=mail.text)
                )
            except Exception as err:
                log.error(
                    "domain expiry email failed",
                    extra={"errName": type(err).__name__, "template": "domainExpiry"},
                )

    def _dto(self, b: Business, now: datetime, checking: bool) -> DomainExpiryOut:
        check = b.domain_check if b.domain_check in DOMAIN_CHECKS else None
        return DomainExpiryOut(
            domain=registrable_domain(b.website_url),
            check=check,
            expiresAt=iso(b.domain_expires_at) if b.domain_expires_at else None,
            checkedAt=iso(b.domain_checked_at) if b.domain_checked_at else None,
            daysLeft=days_until(b.domain_expires_at, now) if b.domain_expires_at else None,
            checking=checking,
        )


def start_domain_watch(app: Any, interval_s: float = 6 * 3600) -> "asyncio.Task[None]":
    """Looks the businesses' domains up at their registries and sends the reminders. In-process like
    the other background jobs: first a minute after start, then every few hours; a domain is only
    asked about once a day."""

    async def loop() -> None:
        await asyncio.sleep(60)
        while True:
            try:
                st = app.state
                async with st.sessionmaker() as db:
                    await DomainExpiryService(
                        db, st.domain_expiry, st.email, st.settings, st.sessionmaker
                    ).check_due()
            except Exception as err:
                log.error("domain watch run failed", extra={"errName": type(err).__name__})
            await asyncio.sleep(interval_s)

    return asyncio.create_task(loop())


async def stop_task(task: "asyncio.Task[None]") -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
