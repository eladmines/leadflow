"""Reports summary, ported from apps/api/src/modules/reports/reports.test.ts."""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update

from app.db import models
from app.modules.reports.events import device_of, event_label, record_events
from app.modules.reports.visits import is_bot_agent, local_day, record_visit
from app.shared.attribution import classify_attribution
from tests.conftest import add_member, business_url, new_user, owner_with_business, req

DAY = timedelta(days=1)


async def _setup(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    stages = (await req(client, "GET", business_url(bid, "/pipeline"), o["token"])).json()["stages"]

    async def mk(name, phone, value, stage, days_ago=0):
        lead = (
            await req(
                client,
                "POST",
                business_url(bid, "/leads"),
                o["token"],
                {"name": name, "phone": phone, "expectedValue": value},
            )
        ).json()["lead"]
        if stage:
            await req(
                client,
                "PATCH",
                business_url(bid, f"/leads/{lead['id']}"),
                o["token"],
                {"stageId": stages[stage]["id"]},
            )
        if days_ago:
            await db.execute(
                update(models.Lead)
                .where(models.Lead.id == lead["id"])
                .values(created_at=datetime.now(UTC) - days_ago * DAY)
            )
            await db.commit()
        return lead

    return o, bid, mk


def summary_url(bid, days=None):
    return business_url(bid, "/reports/summary") + (f"?days={days}" if days else "")


async def test_counts_inquiries_per_local_hour_of_the_business_time_zone(client, db):
    o, bid, mk = await _setup(client, db)
    a = await mk("בוקר", "052-0000011", 100, 0)
    b = await mk("ערב", "052-0000012", 100, 0)
    c = await mk("ערב2", "052-0000013", 100, 0)
    day = datetime.now(UTC) - 2 * DAY

    def at(utc_hour):
        return datetime(day.year, day.month, day.day, utc_hour, 30, tzinfo=UTC)

    for lead, when in ((a, at(6)), (b, at(18)), (c, at(18))):
        await db.execute(update(models.Lead).where(models.Lead.id == lead["id"]).values(created_at=when))
    await db.commit()
    tz = ZoneInfo((await db.execute(select(models.Business.timezone))).scalar_one())
    r = (await req(client, "GET", summary_url(bid, 30), o["token"])).json()
    assert len(r["byHour"]) == 24 and sum(r["byHour"]) == 3
    assert r["byHour"][at(6).astimezone(tz).hour] >= 1
    assert r["byHour"][at(18).astimezone(tz).hour] == 2


async def test_counts_leads_close_rate_values_stages_sources_and_the_series(client, db):
    o, bid, mk = await _setup(client, db)
    await mk("נועה", "052-0000001", 1000, 0)  # חדש (open)
    await mk("רון", "052-0000002", 2000, 4)  # נסגר (won)
    await mk("דנה", "052-0000003", 500, 5)  # אבוד (lost)
    await mk("ישן", "052-0000004", 700, 0, 40)  # previous 30 days
    res = await req(client, "GET", summary_url(bid, 30), o["token"])
    assert res.status_code == 200
    r = res.json()
    assert r["leads"] == {"current": 3, "previous": 1}
    assert r["closeRate"] == 0.5 and r["wonValue"] == 2000 and r["openValue"] == 1000
    assert [[s["name"], s["count"]] for s in r["byStage"]] == [
        ["חדש", 1], ["נוצר קשר", 0], ["הצעה נשלחה", 0], ["ממתין", 0], ["נסגר", 1], ["אבוד", 1],
    ]  # fmt: skip
    assert r["bySource"] == [
        {"source": "website_form", "count": 0},
        {"source": "manual", "count": 3},
        {"source": "whatsapp", "count": 0},
        {"source": "facebook", "count": 0},
        {"source": "instagram", "count": 0},
        {"source": "email", "count": 0},
    ]
    assert r["series"]["unit"] == "day" and len(r["series"]["points"]) >= 30
    assert sum(p["count"] for p in r["series"]["points"]) == 3
    dates = [p["date"] for p in r["series"]["points"]]
    assert sorted(dates) == dates  # chronological, no stray buckets


async def test_response_time_is_measured_from_the_first_human_action(client, db):
    o, bid, mk = await _setup(client, db)
    lead = await mk("רון", "052-0000002", 0, 0)
    await db.execute(
        update(models.Lead)
        .where(models.Lead.id == lead["id"])
        .values(created_at=datetime.now(UTC) - timedelta(minutes=90))
    )
    await db.commit()
    await req(
        client, "POST", business_url(bid, f"/leads/{lead['id']}/notes"), o["token"], {"text": "התקשרתי"}
    )
    await mk("בלי מענה", "052-0000009", 0, 0)
    r = (await req(client, "GET", summary_url(bid), o["token"])).json()
    assert r["respondedLeads"] == 1 and 89 <= r["avgResponseMinutes"] <= 91


async def test_weekly_buckets_for_90_days_other_ranges_rejected_and_empty_safe(client, db):
    o, bid, _ = await _setup(client, db)
    r = (await req(client, "GET", summary_url(bid, 90), o["token"])).json()
    assert r["series"]["unit"] == "week" and len(r["series"]["points"]) >= 13
    assert all(
        datetime.strptime(p["date"], "%Y-%m-%d").weekday() == 6 for p in r["series"]["points"]
    )  # Sundays
    assert r["closeRate"] is None and r["avgResponseMinutes"] is None
    assert (await req(client, "GET", summary_url(bid, 12), o["token"])).status_code == 400


async def test_managers_can_see_reports_employees_cannot(client, db):
    o, bid, _ = await _setup(client, db)
    for role, status in (("MANAGER", 200), ("EMPLOYEE", 403)):
        token, uid = await new_user(client, role.lower())
        await add_member(db, bid, uid, role)
        assert (await req(client, "GET", summary_url(bid), token)).status_code == status


async def test_attribution_visits_and_campaigns_join_the_same_rows(client, db):
    o, bid, mk = await _setup(client, db)
    google = await mk("גוגל", "052-0000021", 1000, 4)
    organic = await mk("ישיר", "052-0000022", 100, 0)
    seen = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    rows = {
        google["id"]: {"source": "google_ads", "seenAt": seen, "campaign": "spring"},
        organic["id"]: {"source": "direct", "seenAt": seen},
    }
    for lead_id, a in rows.items():
        await db.execute(
            update(models.Lead)
            .where(models.Lead.id == lead_id)
            .values(attribution=a, attribution_source=a["source"])
        )
    await db.commit()
    tz = (await db.execute(select(models.Business.timezone))).scalar_one()
    visit = classify_attribution({"gclid": "x", "utm_campaign": "spring"})
    for _ in range(3):
        await record_visit(db, uuid.UUID(bid), tz, visit)
    await record_visit(db, uuid.UUID(bid), tz, classify_attribution({}))

    r = (await req(client, "GET", summary_url(bid), o["token"])).json()
    by_source = {row["source"]: row for row in r["byAttribution"]}
    assert (
        by_source["google_ads"] | {"leads": 1, "won": 1, "wonValue": 1000, "visits": 3}
        == by_source["google_ads"]
    )
    assert (
        by_source["unknown"]["leads"] == 1 and by_source["unknown"]["visits"] == 1
    )  # direct reads as unknown
    assert r["visits"] == 4
    assert r["byAttribution"][0]["source"] == "google_ads"  # won first
    camp = r["byCampaign"][0]
    assert (camp["campaign"], camp["leads"], camp["visits"]) == ("spring", 1, 3)


async def test_behavior_counts_pages_devices_clicks_and_known_sections(client, db):
    o, bid, _ = await _setup(client, db)
    bus = uuid.UUID(bid)
    day = local_day((await db.execute(select(models.Business.timezone))).scalar_one(), datetime.now(UTC))
    await record_events(
        db,
        bus,
        day,
        [
            ("page", "https://x.example/about/?utm=1"),
            ("page", "/about"),
            ("landing", "/about"),
            ("device", "mobile"),
            ("click", "phone"),
            ("click", "fax"),  # not an accepted label
            ("scroll", "90"),
            ("form", "start"),
            ("cta", "  Book   now \n"),
            ("section", "/#hero"),
            ("sclick", "/#hero"),
            ("section", "no-hash"),  # not acceptable
            ("bogus", "x"),
        ],
    )
    b = (await req(client, "GET", summary_url(bid), o["token"])).json()["behavior"]
    assert b["pageViews"] == 2 and b["topPages"] == [{"path": "/about", "views": 2}]
    assert b["devices"] == {"mobile": 1, "tablet": 0, "desktop": 0}
    assert b["clicks"] == {"phone": 1, "whatsapp": 0, "email": 0}
    assert b["scroll"] == {"p50": 0, "p90": 1} and b["formStarts"] == 1
    assert b["ctas"] == [{"name": "Book now", "count": 1}]
    assert b["landing"] == [{"path": "/about", "visits": 1, "leads": 0}]
    assert [s for s in b["sections"] if s["name"] == "hero"] == [
        {"path": "/", "name": "hero", "views": 1, "clicks": 1, "pageViews": 0}
    ]


async def test_event_rows_per_day_are_capped(client, db):
    o, bid, _ = await _setup(client, db)
    bus = uuid.UUID(bid)
    await record_events(db, bus, "2026-01-01", [("page", f"/p{i}") for i in range(520)])
    count = (
        (await db.execute(select(models.EventCount).where(models.EventCount.business_id == bus)))
        .scalars()
        .all()
    )
    assert len(count) == 500
    await record_events(db, bus, "2026-01-01", [("page", "/p1")])  # an existing row still counts
    row = (await db.execute(select(models.EventCount).where(models.EventCount.label == "/p1"))).scalar_one()
    await db.refresh(row)
    assert row.count == 2


def test_reads_the_device_from_the_user_agent():
    assert device_of("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148") == "mobile"
    assert device_of("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36") == "mobile"
    assert device_of("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148") == "tablet"
    assert device_of("Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36") == "tablet"
    assert device_of("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15") == "desktop"
    assert device_of(None) == "desktop"


def test_bots_and_labels():
    assert is_bot_agent(None) and is_bot_agent("Googlebot/2.1") and is_bot_agent("curl/8")
    assert not is_bot_agent("Mozilla/5.0 (Windows NT 10.0) Chrome/120")
    assert event_label("scroll", "50") == "50" and event_label("scroll", "75") is None
    assert event_label("cta", "   ") is None and event_label("page", None) == "/"
