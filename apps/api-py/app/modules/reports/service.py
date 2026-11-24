"""Basic reports (F20 lite) from real CRM data, plus website visits (F31) and behaviour (F32).

Port of apps/api/src/modules/reports/service.ts. Days and hours are the business's local ones.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.timeutil import iso
from app.db.models import (
    Activity,
    Business,
    EventCount,
    Lead,
    QuoteStatus,
    Site,
    StageKind,
    VisitCount,
)
from app.deps import TenantContext
from app.modules.leads.schemas import LEAD_SOURCES
from app.modules.leads.service import ensure_stages
from app.modules.sites.published_content import section_map
from app.shared.attribution import attribution_name, parse_attribution
from app.shared.embed import normalize_page_path

REPORT_RANGES = (7, 30, 90)
_DAY = timedelta(days=1)


class AttributionRow(BaseModel):
    source: Literal[
        "google_ads",
        "google",
        "meta_ads",
        "meta",
        "tiktok",
        "microsoft_ads",
        "utm",
        "referral",
        "direct",
        "unknown",
    ]
    name: str | None  # utm_source / referring host when the source is `utm` / `referral`
    leads: int
    won: int  # leads in a Won stage ("became customers")
    lost: int
    wonValue: int  # sum of the won leads' deal values (whole units)
    visits: int  # F31: website visits from this source (or campaign) in the range


class CampaignRow(AttributionRow):
    campaign: str


class PageViews(BaseModel):
    path: str
    views: int


class Landing(BaseModel):
    path: str
    visits: int
    leads: int


class SectionRow(BaseModel):
    path: str
    name: str
    views: int
    clicks: int  # taps or clicks inside it
    pageViews: int  # views of that page, to read `views` as a share


class Cta(BaseModel):
    name: str
    count: int


class Devices(BaseModel):
    mobile: int
    tablet: int
    desktop: int


class Clicks(BaseModel):
    phone: int
    whatsapp: int
    email: int


class Scroll(BaseModel):
    p50: int
    p90: int


class Behavior(BaseModel):
    """F32: what visitors do on a website with the script (counts, never people)."""

    pageViews: int
    topPages: list[PageViews]
    landing: list[Landing]
    devices: Devices
    clicks: Clicks
    scroll: Scroll
    sections: list[SectionRow]
    ctas: list[Cta]
    formStarts: int


class SeriesPoint(BaseModel):
    date: str
    count: int


class Series(BaseModel):
    unit: Literal["day", "week"]
    points: list[SeriesPoint]


class StageRow(BaseModel):
    id: str
    name: str
    kind: str
    count: int
    value: int


class SourceRow(BaseModel):
    source: str
    count: int


class LeadCounts(BaseModel):
    current: int
    previous: int


class ReportSummary(BaseModel):
    range: dict[str, Any]
    leads: LeadCounts
    closeRate: float | None
    wonValue: int
    openValue: int
    avgResponseMinutes: float | None
    respondedLeads: int
    series: Series
    byHour: list[int]
    byStage: list[StageRow]
    bySource: list[SourceRow]
    byAttribution: list[AttributionRow]
    visits: int
    behavior: Behavior
    byCampaign: list[CampaignRow]


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo("UTC")


def _next_day(ymd: str) -> str:
    return (datetime.strptime(ymd, "%Y-%m-%d") + _DAY).strftime("%Y-%m-%d")


def _week_start(ymd: str) -> str:
    """Sunday-start week key for a local `YYYY-MM-DD`."""
    d = datetime.strptime(ymd, "%Y-%m-%d")
    return (d - timedelta(days=(d.weekday() + 1) % 7)).strftime("%Y-%m-%d")


def _behavior(rows: list[tuple[str, str, int]], leads: list[Lead], known: list[dict[str, str]]) -> Behavior:
    def total(kind: str, label: str | None = None) -> int:
        return sum(c for k, lab, c in rows if k == kind and (label is None or lab == label))

    def by(kind: str) -> dict[str, int]:
        m: dict[str, int] = {}
        for k, lab, c in rows:
            if k == kind:
                m[lab] = m.get(lab, 0) + c
        return m

    leads_by_landing: dict[str, int] = {}
    for lead in leads:
        a = parse_attribution(lead.attribution)
        if a and a.get("landingPath"):
            path = normalize_page_path(a["landingPath"])
            leads_by_landing[path] = leads_by_landing.get(path, 0) + 1
    # Sections: every section of the published site (in page order, even with no views yet), then
    # any others that were counted (a site elsewhere, an older version), most seen first.
    seen_views, seen_clicks, page_views_of = by("section"), by("sclick"), by("page")

    def to_row(path: str, name: str) -> SectionRow:
        key = f"{path}#{name}"
        return SectionRow(
            path=path,
            name=name,
            views=seen_views.get(key, 0),
            clicks=seen_clicks.get(key, 0),
            pageViews=page_views_of.get(path, 0),
        )

    known_keys = {f"{k['path']}#{k['name']}" for k in known}
    labels = list(dict.fromkeys([*seen_views, *seen_clicks]))
    extra = sorted(
        (to_row(lab[: lab.index("#")], lab[lab.index("#") + 1 :]) for lab in labels if lab not in known_keys),
        key=lambda r: -r.views,
    )[:30]
    sections = [to_row(k["path"], k["name"]) for k in known] + extra
    landings = by("landing")
    return Behavior(
        pageViews=total("page"),
        topPages=[
            PageViews(path=p, views=v) for p, v in sorted(by("page").items(), key=lambda kv: -kv[1])[:10]
        ],
        landing=[
            Landing(path=p, visits=v, leads=leads_by_landing.get(p, 0))
            for p, v in sorted(landings.items(), key=lambda kv: -kv[1])[:10]
        ],
        devices=Devices(
            mobile=total("device", "mobile"),
            tablet=total("device", "tablet"),
            desktop=total("device", "desktop"),
        ),
        clicks=Clicks(
            phone=total("click", "phone"), whatsapp=total("click", "whatsapp"), email=total("click", "email")
        ),
        scroll=Scroll(p50=total("scroll", "50"), p90=total("scroll", "90")),
        sections=sections,
        ctas=[Cta(name=n, count=c) for n, c in sorted(by("cta").items(), key=lambda kv: -kv[1])[:10]],
        formStarts=total("form", "start"),
    )


class ReportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def summary(self, ctx: TenantContext, days: int, now: datetime | None = None) -> dict[str, Any]:
        to = now or datetime.now(UTC)
        frm = to - days * _DAY
        prev_from = frm - days * _DAY
        timezone = (
            await self.db.execute(select(Business.timezone).where(Business.id == ctx.business_id))
        ).scalar_one()
        tz = _tz(timezone)

        def local_day(d: datetime) -> str:
            return d.astimezone(tz).strftime("%Y-%m-%d")

        stages = await ensure_stages(self.db, ctx.business_id)
        await self.db.commit()
        leads = list(
            (
                await self.db.execute(
                    select(Lead)
                    .options(joinedload(Lead.quotes))
                    .where(Lead.business_id == ctx.business_id, Lead.created_at >= frm, Lead.created_at < to)
                )
            )
            .scalars()
            .unique()
        )
        previous = (
            await self.db.execute(
                select(func.count())
                .select_from(Lead)
                .where(
                    Lead.business_id == ctx.business_id, Lead.created_at >= prev_from, Lead.created_at < frm
                )
            )
        ).scalar_one()
        visit_rows = (
            await self.db.execute(
                select(VisitCount.source, VisitCount.name, VisitCount.campaign, VisitCount.count).where(
                    VisitCount.business_id == ctx.business_id,
                    VisitCount.day >= local_day(frm),
                    VisitCount.day <= local_day(to),
                )
            )
        ).all()
        event_rows = [
            (k, label, c)
            for k, label, c in (
                await self.db.execute(
                    select(EventCount.kind, EventCount.label, EventCount.count).where(
                        EventCount.business_id == ctx.business_id,
                        EventCount.day >= local_day(frm),
                        EventCount.day <= local_day(to),
                    )
                )
            ).all()
        ]

        # Stages and money.
        kind_of = {st.id: st.kind for st in stages}

        def value(xs: list[Lead]) -> int:
            return sum(lead.expected_value or 0 for lead in xs)

        by_stage = []
        for st in stages:
            in_stage = [lead for lead in leads if lead.stage_id == st.id]
            by_stage.append(
                StageRow(
                    id=str(st.id),
                    name=st.name,
                    kind=st.kind.value,
                    count=len(in_stage),
                    value=value(in_stage),
                )
            )
        won = [lead for lead in leads if kind_of.get(lead.stage_id) == StageKind.WON]
        lost = [lead for lead in leads if kind_of.get(lead.stage_id) == StageKind.LOST]
        by_source = [
            SourceRow(source=src, count=sum(1 for lead in leads if lead.source.value == src))
            for src in LEAD_SOURCES
        ]

        # F26: where customers come from. A customer = a Won stage or an accepted quote.
        def is_customer(lead: Lead) -> bool:
            return kind_of.get(lead.stage_id) == StageKind.WON or any(
                q.status == QuoteStatus.ACCEPTED for q in lead.quotes
            )

        rows: dict[str, dict[str, Any]] = {}
        campaigns: dict[str, dict[str, Any]] = {}

        def empty(source: str, name: str | None) -> dict[str, Any]:
            return {
                "source": source,
                "name": name,
                "leads": 0,
                "won": 0,
                "lost": 0,
                "wonValue": 0,
                "visits": 0,
            }

        def add(row: dict[str, Any], lead: Lead) -> None:
            row["leads"] += 1
            if is_customer(lead):
                row["won"] += 1
                row["wonValue"] += lead.expected_value or 0
            elif kind_of.get(lead.stage_id) == StageKind.LOST:
                row["lost"] += 1

        for lead in leads:
            a = parse_attribution(lead.attribution)
            source = a["source"] if a and a["source"] != "direct" else "unknown"
            name = attribution_name(a) if a and source in ("utm", "referral") else None
            key = f"{source}|{name or ''}"
            add(rows.setdefault(key, empty(source, name)), lead)
            campaign = (a.get("campaign") or a.get("adHeadline")) if a else None
            if campaign:
                add(
                    campaigns.setdefault(f"{key}|{campaign}", {**empty(source, name), "campaign": campaign}),
                    lead,
                )

        # F31: visits join the same rows. An unknown source on a lead is a direct visit.
        visits = 0
        for v_source, v_name, v_campaign, v_count in visit_rows:
            visits += v_count
            source = "unknown" if v_source == "direct" else v_source
            name = v_name or None
            key = f"{source}|{name or ''}"
            rows.setdefault(key, empty(source, name))["visits"] += v_count
            if v_campaign:
                campaigns.setdefault(f"{key}|{v_campaign}", {**empty(source, name), "campaign": v_campaign})[
                    "visits"
                ] += v_count

        published = (
            await self.db.execute(
                select(Site)
                .options(joinedload(Site.published_version))
                .where(Site.business_id == ctx.business_id)
            )
        ).scalar_one_or_none()
        content = published.published_version.content if published and published.published_version else None
        behavior = _behavior(event_rows, leads, section_map(content))

        def order(r: dict[str, Any]) -> tuple[int, int, int]:
            return (-r["won"], -r["leads"], -r["visits"])

        # Time series in the business's local days.
        unit: Literal["day", "week"] = "day" if days <= 31 else "week"
        keys: list[str] = []
        last = local_day(to)
        day = local_day(frm)
        while day <= last:
            key = day if unit == "day" else _week_start(day)
            if not keys or keys[-1] != key:
                keys.append(key)
            day = _next_day(day)
        counts = dict.fromkeys(keys, 0)
        for lead in leads:
            d = local_day(lead.created_at)
            key = d if unit == "day" else _week_start(d)
            counts[key] = counts.get(key, 0) + 1

        # When inquiries arrive: per local hour of the day.
        by_hour = [0] * 24
        for lead in leads:
            by_hour[lead.created_at.astimezone(tz).hour] += 1

        # Response time: first human action per lead (lead.created is not a response).
        first_by_lead: dict[uuid.UUID, datetime] = {}
        if leads:
            actions = await self.db.execute(
                select(Activity.lead_id, Activity.created_at)
                .where(
                    Activity.business_id == ctx.business_id,
                    Activity.lead_id.in_([lead.id for lead in leads]),
                    Activity.actor_id.is_not(None),
                    Activity.type != "lead.created",
                )
                .order_by(Activity.created_at.asc())
            )
            for lead_id, at in actions:
                first_by_lead.setdefault(lead_id, at)
        minutes = [
            (first_by_lead[lead.id] - lead.created_at).total_seconds() / 60
            for lead in leads
            if lead.id in first_by_lead
        ]

        sorted_rows = sorted(rows.values(), key=order)
        return ReportSummary(
            range={"from": iso(frm), "to": iso(to), "days": days},
            leads=LeadCounts(current=len(leads), previous=previous),
            closeRate=len(won) / (len(won) + len(lost)) if won or lost else None,
            wonValue=value(won),
            openValue=value([lead for lead in leads if kind_of.get(lead.stage_id) == StageKind.OPEN]),
            avgResponseMinutes=int(sum(minutes) / len(minutes) + 0.5) if minutes else None,
            respondedLeads=len(minutes),
            series=Series(unit=unit, points=[SeriesPoint(date=d, count=c) for d, c in counts.items()]),
            byHour=by_hour,
            byStage=by_stage,
            bySource=by_source,
            byAttribution=[AttributionRow(**r) for r in sorted_rows],
            visits=visits,
            behavior=behavior,
            byCampaign=[CampaignRow(**r) for r in sorted(campaigns.values(), key=order)[:10]],
        ).model_dump()
