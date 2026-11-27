"""A lead's value from its quotes and its next task (D-207, D-208, D-209, D-210)."""

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select, update

from app.core.timezone import date_in_zone
from app.db import models
from tests.conftest import business_url, make_quote, make_task, owner_with_business, req
from tests.test_leads import _team, create, leads_url

DAY = timedelta(days=1)


async def _lead(client, t, token=None, **body):
    res = await create(
        client, t["id"], token or t["owner"]["token"], {"name": "דנה", "phone": "050-1234567", **body}
    )
    assert res.status_code == 201, res.text
    return res.json()["lead"]


async def _get(client, t, lead_id, token=None):
    res = await req(client, "GET", leads_url(t["id"], f"/{lead_id}"), token or t["owner"]["token"])
    assert res.status_code == 200, res.text
    return res.json()["lead"]


async def _listed(client, t, lead_id, token=None):
    res = await req(client, "GET", leads_url(t["id"]), token or t["owner"]["token"])
    return next(x for x in res.json()["leads"] if x["id"] == lead_id)


# --------------------------------------------------------------------------- value


async def test_drafts_and_rejected_quotes_count_nothing(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    await make_quote(db, t["id"], lead["id"], "DRAFT", 100_000)
    await make_quote(db, t["id"], lead["id"], "REJECTED", 50_000)
    assert (await _get(client, t, lead["id"]))["value"] == {"won": 0, "open": 0}


async def test_accepted_quotes_are_all_summed_and_rounded_half_up_once_per_lead(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    # 100.25 + 200.25 = 300.50 → 301 (per-quote rounding would give 300).
    await make_quote(db, t["id"], lead["id"], "ACCEPTED", 10_025)
    await make_quote(db, t["id"], lead["id"], "ACCEPTED", 20_025)
    assert (await _get(client, t, lead["id"]))["value"] == {"won": 301, "open": 0}
    other = await _lead(client, t, phone="050-7654321")
    await make_quote(db, t["id"], other["id"], "SENT", 4_949)  # 49.49 → 49
    assert (await _listed(client, t, other["id"]))["value"] == {"won": 0, "open": 49}


async def test_quote_totals_include_discount_and_vat(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q = await make_quote(db, t["id"], lead["id"], "SENT", 100_000)
    # ₪1,000 − ₪100 discount = ₪900, + 18% VAT = ₪1,062.
    await db.execute(update(models.Quote).where(models.Quote.id == q.id).values(discount=10_000, vat_rate=18))
    await db.commit()
    assert (await _get(client, t, lead["id"]))["value"] == {"won": 0, "open": 1062}


async def test_only_the_latest_sent_quote_is_open_and_a_revision_replaces_it(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    now = datetime.now(UTC)
    # The later-sent quote counts even with a lower number.
    await make_quote(db, t["id"], lead["id"], "SENT", 100_000, number=2001, sent_at=now - DAY)
    await make_quote(db, t["id"], lead["id"], "SENT", 70_000, number=2000, sent_at=now)
    await make_quote(db, t["id"], lead["id"], "DRAFT", 999_900)  # a newer draft changes nothing
    assert (await _get(client, t, lead["id"]))["value"] == {"won": 0, "open": 700}

    # Same sent time: the higher number wins.
    tie = await _lead(client, t, phone="050-2222222")
    await make_quote(db, t["id"], tie["id"], "SENT", 10_000, number=3000, sent_at=now)
    await make_quote(db, t["id"], tie["id"], "SENT", 20_000, number=3001, sent_at=now)
    assert (await _get(client, t, tie["id"]))["value"]["open"] == 200


async def test_an_old_sent_quote_without_sent_at_is_ordered_by_creation(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    now = datetime.now(UTC)
    await make_quote(db, t["id"], lead["id"], "SENT", 30_000, no_sent_at=True, created_at=now - 3 * DAY)
    assert (await _get(client, t, lead["id"]))["value"]["open"] == 300
    await make_quote(db, t["id"], lead["id"], "SENT", 50_000, sent_at=now - DAY)
    assert (await _get(client, t, lead["id"]))["value"]["open"] == 500


async def test_when_the_latest_sent_quote_was_decided_open_is_zero(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    now = datetime.now(UTC)
    await make_quote(db, t["id"], lead["id"], "SENT", 100_000, sent_at=now - DAY)
    await make_quote(db, t["id"], lead["id"], "ACCEPTED", 80_000, sent_at=now)
    assert (await _get(client, t, lead["id"]))["value"] == {"won": 800, "open": 0}

    rejected = await _lead(client, t, phone="050-3333333")
    await make_quote(db, t["id"], rejected["id"], "SENT", 100_000, sent_at=now - DAY)
    await make_quote(db, t["id"], rejected["id"], "REJECTED", 80_000, sent_at=now)
    assert (await _get(client, t, rejected["id"]))["value"] == {"won": 0, "open": 0}


async def test_a_sent_quote_past_its_validity_in_the_business_time_zone_is_not_open(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    now = datetime.now(UTC)
    # UTC−12 and UTC+14 are always on different calendar days.
    behind = date.fromisoformat(date_in_zone(now, "Etc/GMT+12"))
    await make_quote(db, t["id"], lead["id"], "SENT", 100_000, valid_until=behind)
    bid = uuid.UUID(t["id"])

    async def zone(name):
        await db.execute(update(models.Business).where(models.Business.id == bid).values(timezone=name))
        await db.commit()

    await zone("Etc/GMT-14")  # already a later day there: expired
    assert (await _get(client, t, lead["id"]))["value"]["open"] == 0
    await zone("Etc/GMT+12")  # valid through today there
    assert (await _get(client, t, lead["id"]))["value"]["open"] == 1000


async def test_another_businesss_quotes_and_tasks_on_the_lead_never_count(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    other = await owner_with_business(client, "other")
    oid = other["business"]["id"]
    # Rows that point at this lead but belong to another business (should never exist).
    await make_quote(db, oid, lead["id"], "ACCEPTED", 100_000)
    await make_quote(db, oid, lead["id"], "SENT", 100_000)
    await make_task(db, oid, lead["id"], other["user_id"], "זר", datetime.now(UTC) - DAY)
    got = await _get(client, t, lead["id"])
    assert got["value"] == {"won": 0, "open": 0} and got["nextTask"] is None
    listed = await _listed(client, t, lead["id"])
    assert listed["value"] == {"won": 0, "open": 0} and listed["nextTask"] is None
    customers = (await req(client, "GET", business_url(t["id"], "/customers"), t["owner"]["token"])).json()
    assert customers["customers"] == []


async def test_the_list_carries_each_leads_own_value(client, db):
    t = await _team(client, db)
    a = await _lead(client, t)
    b = await _lead(client, t, phone="050-4444444")
    await make_quote(db, t["id"], a["id"], "ACCEPTED", 10_000)
    await make_quote(db, t["id"], b["id"], "SENT", 20_000)
    leads = (await req(client, "GET", leads_url(t["id"]), t["owner"]["token"])).json()["leads"]
    by_id = {x["id"]: x["value"] for x in leads}
    assert by_id[a["id"]] == {"won": 100, "open": 0} and by_id[b["id"]] == {"won": 0, "open": 200}


# --------------------------------------------------------------------------- aggregates


async def test_a_won_stage_lead_adds_nothing_to_open_value(client, db):
    t = await _team(client, db)
    won_stage = next(s for s in t["stages"] if s["kind"] == "WON")
    lead = await _lead(client, t, stageId=won_stage["id"])
    await make_quote(db, t["id"], lead["id"], "SENT", 50_000)
    await make_quote(db, t["id"], lead["id"], "ACCEPTED", 30_000, sent_at=datetime.now(UTC) - DAY)
    r = (await req(client, "GET", business_url(t["id"], "/reports/summary"), t["owner"]["token"])).json()
    assert r["openValue"] == 0 and r["wonValue"] == 300
    row = next(s for s in r["byStage"] if s["id"] == won_stage["id"])
    assert row["value"] == 300


async def test_customers_value_is_null_without_an_accepted_quote(client, db):
    t = await _team(client, db)
    won_stage = next(s for s in t["stages"] if s["kind"] == "WON")
    lead = await _lead(client, t, stageId=won_stage["id"])
    await make_quote(db, t["id"], lead["id"], "SENT", 50_000)  # open, not a purchase value
    c = (await req(client, "GET", business_url(t["id"], "/customers"), t["owner"]["token"])).json()[
        "customers"
    ]
    assert c[0]["totalValue"] == 0 and c[0]["purchases"][0]["value"] is None
    await make_quote(db, t["id"], lead["id"], "ACCEPTED", 0)  # accepted, even at ₪0
    c = (await req(client, "GET", business_url(t["id"], "/customers"), t["owner"]["token"])).json()[
        "customers"
    ]
    assert c[0]["purchases"][0]["value"] == 0


# --------------------------------------------------------------------------- next task


async def test_next_task_is_the_earliest_open_one_overdue_first_skipping_done(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    assert (await _get(client, t, lead["id"]))["nextTask"] is None
    now = datetime.now(UTC).replace(microsecond=0)  # whole seconds: stored exactly
    owner_id, mgr_id = t["owner"]["user_id"], t["manager"]["user_id"]
    await make_task(db, t["id"], lead["id"], owner_id, "מחר", now + DAY)
    await make_task(db, t["id"], lead["id"], owner_id, "בוצע", now - 5 * DAY, status="DONE")
    late = await make_task(db, t["id"], lead["id"], mgr_id, "באיחור", now - 2 * DAY)
    await make_task(db, t["id"], None, owner_id, "בלי ליד", now - 9 * DAY)
    got = await _get(client, t, lead["id"])
    due = late.due_at.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    assert got["nextTask"] == {
        "id": str(late.id),
        "title": "באיחור",
        "dueAt": due,
        "assignee": {"id": mgr_id, "name": got["nextTask"]["assignee"]["name"]},
    }
    assert got["nextTask"]["assignee"]["name"]
    assert (await _listed(client, t, lead["id"]))["nextTask"]["id"] == str(late.id)

    # Same due time: the earlier-created one.
    tie = await _lead(client, t, phone="050-5555555")
    at = now + 3 * DAY
    first = await make_task(db, t["id"], tie["id"], owner_id, "א", at, created_at=now - DAY)
    await make_task(db, t["id"], tie["id"], owner_id, "ב", at, created_at=now)
    assert (await _get(client, t, tie["id"]))["nextTask"]["id"] == str(first.id)

    await db.execute(
        update(models.Task).where(models.Task.lead_id == uuid.UUID(tie["id"])).values(status="DONE")
    )
    await db.commit()
    assert (await _get(client, t, tie["id"]))["nextTask"] is None


async def test_an_employee_sees_only_their_own_task_as_the_next_action(client, db):
    t = await _team(client, db)
    emp, mgr = t["employee"], t["manager"]
    lead = await _lead(client, t, ownerId=emp["user_id"])
    now = datetime.now(UTC)
    teammate = await make_task(db, t["id"], lead["id"], mgr["user_id"], "של המנהל", now - DAY)
    assert (await _get(client, t, lead["id"], emp["token"]))["nextTask"] is None
    own = await make_task(db, t["id"], lead["id"], emp["user_id"], "שלי", now + DAY)
    for got in (
        await _get(client, t, lead["id"], emp["token"]),
        await _listed(client, t, lead["id"], emp["token"]),
    ):
        assert got["nextTask"]["id"] == str(own.id) and got["nextTask"]["title"] == "שלי"
    # Owners and managers see the team's earliest task.
    assert (await _get(client, t, lead["id"]))["nextTask"]["id"] == str(teammate.id)
    assert (await _get(client, t, lead["id"], mgr["token"]))["nextTask"]["id"] == str(teammate.id)
    # Updates answer with the member's view too.
    patched = await req(client, "PATCH", leads_url(t["id"], f"/{lead['id']}"), emp["token"], {"tags": ["x"]})
    assert patched.json()["lead"]["nextTask"]["id"] == str(own.id)


# --------------------------------------------------------------------------- the one save


async def test_an_invalid_custom_field_in_a_patch_changes_nothing(client, db):
    t = await _team(client, db)
    token = t["owner"]["token"]
    field = (
        await req(
            client, "POST", business_url(t["id"], "/lead-fields"), token, {"label": "דגם", "type": "text"}
        )
    ).json()["field"]
    number = (
        await req(
            client,
            "POST",
            business_url(t["id"], "/lead-fields"),
            token,
            {"label": "שנה", "type": "number"},
        )
    ).json()["field"]
    lead = await _lead(client, t)
    before = (await db.execute(select(func.count()).select_from(models.Activity))).scalar_one()
    res = await req(
        client,
        "PATCH",
        leads_url(t["id"], f"/{lead['id']}"),
        token,
        {
            "tags": ["VIP"],
            "stageId": t["stages"][1]["id"],
            "customFields": {field["id"]: "מאזדה", number["id"]: "x"},
        },
    )
    assert res.status_code == 400 and f"customFields.{number['id']}" in res.json()["error"]["fields"]
    after = await _get(client, t, lead["id"])
    assert after["tags"] == [] and after["customFields"] == {} and after["stage"]["id"] == lead["stage"]["id"]
    assert (await db.execute(select(func.count()).select_from(models.Activity))).scalar_one() == before
