"""Leads CRM (F08), tags, deletion and CSV export, ported from apps/api/src/modules/leads/*.test.ts."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.db import models
from tests.conftest import add_member, business_url, new_user, owner_with_business, req


def leads_url(bid, tail=""):
    return business_url(bid, f"/leads{tail}")


async def _team(client, db):
    owner = await owner_with_business(client, "owner")
    bid = owner["business"]["id"]
    mgr_token, mgr_id = await new_user(client, "mgr")
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, mgr_id, "MANAGER")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    stages = (await req(client, "GET", business_url(bid, "/pipeline"), owner["token"])).json()["stages"]
    return {
        "owner": owner,
        "manager": {"token": mgr_token, "user_id": mgr_id},
        "employee": {"token": emp_token, "user_id": emp_id},
        "id": bid,
        "stages": stages,
    }


async def create(client, bid, token, body):
    return await req(client, "POST", leads_url(bid), token, body)


# --------------------------------------------------------------------------- CRM


async def test_seeds_the_default_hebrew_pipeline_in_order(client, db):
    t = await _team(client, db)
    assert [s["name"] for s in t["stages"]] == ["חדש", "נוצר קשר", "הצעה נשלחה", "ממתין", "נסגר", "אבוד"]
    assert t["stages"][-2]["kind"] == "WON"


async def test_creates_a_manual_lead_needing_phone_or_email_and_reuses_a_matching_contact(client, db):
    t = await _team(client, db)
    bad = await create(client, t["id"], t["owner"]["token"], {"name": "רון"})
    assert bad.status_code == 400 and "טלפון או אימייל" in bad.json()["error"]["fields"]["phone"]

    res = await create(
        client,
        t["id"],
        t["owner"]["token"],
        {"name": "רון לוי", "phone": "052-1112233", "expectedValue": 1500, "message": "הגיע מהמלצה"},
    )
    assert res.status_code == 201
    lead = res.json()["lead"]
    assert lead["source"] == "manual" and lead["stage"]["name"] == "חדש" and lead["owner"] is None
    assert lead["expectedValue"] == 1500
    assert lead["contact"]["name"] == "רון לוי" and lead["contact"]["phone"] == "+972521112233"
    assert lead["tags"] == [] and lead["lastWhatsApp"] is None and lead["attribution"] is None
    assert lead["customFields"] == {}  # F34: always sent

    await create(client, t["id"], t["owner"]["token"], {"name": "רוני", "phone": "0521112233"})
    contacts = (await db.execute(select(func.count()).select_from(models.Contact))).scalar_one()
    leads = (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one()
    assert (contacts, leads) == (1, 2)


async def test_duplicate_warning_is_for_owners_and_managers_only(client, db):
    t = await _team(client, db)
    await create(client, t["id"], t["owner"]["token"], {"name": "רון לוי", "phone": "052-1112233"})
    url = business_url(t["id"], "/contacts/duplicates") + "?phone=%2B972%2052%20111%202233"
    manager = (await req(client, "GET", url, t["manager"]["token"])).json()["contacts"]
    assert len(manager) == 1 and manager[0]["name"] == "רון לוי" and manager[0]["leadCount"] == 1
    assert (await req(client, "GET", url, t["employee"]["token"])).json()["contacts"] == []


async def test_stage_moves_assignment_and_edits_are_recorded_with_the_actor(client, db):
    t = await _team(client, db)
    lead = (
        await create(client, t["id"], t["owner"]["token"], {"name": "רון", "phone": "052-1112233"})
    ).json()["lead"]
    url = leads_url(t["id"], f"/{lead['id']}")
    patched = await req(
        client,
        "PATCH",
        url,
        t["manager"]["token"],
        {
            "stageId": t["stages"][1]["id"],
            "ownerId": t["employee"]["user_id"],
            "expectedValue": 2000,
            "nextActionAt": "2026-11-01T09:00:00.000Z",
        },
    )
    assert patched.status_code == 200
    p = patched.json()["lead"]
    assert p["stage"]["name"] == "נוצר קשר" and p["owner"]["id"] == t["employee"]["user_id"]
    assert p["expectedValue"] == 2000 and p["nextActionAt"] == "2026-11-01T09:00:00.000Z"

    note = await req(client, "POST", f"{url}/notes", t["manager"]["token"], {"text": "דיברנו, שולחים הצעה"})
    assert note.status_code == 201

    detail = (await req(client, "GET", url, t["owner"]["token"])).json()
    types = [a["type"] for a in detail["activities"]]
    assert {"lead.created", "lead.stage_changed", "lead.assigned", "lead.updated", "lead.note"} <= set(types)
    change = next(a for a in detail["activities"] if a["type"] == "lead.stage_changed")
    assert change["data"]["from"] == "חדש" and change["data"]["to"] == "נוצר קשר"
    assert change["actor"]["id"] == t["manager"]["user_id"]
    assert detail["activities"][0]["type"] == "lead.note"
    assert detail["activities"][0]["data"] == {"text": "דיברנו, שולחים הצעה"}

    # A no-op patch adds nothing.
    await req(client, "PATCH", url, t["manager"]["token"], {"stageId": t["stages"][1]["id"]})
    count = await db.execute(
        select(func.count())
        .select_from(models.Activity)
        .where(models.Activity.lead_id == lead["id"], models.Activity.type == "lead.stage_changed")
    )
    assert count.scalar_one() == 1


async def test_employees_see_and_update_only_their_leads_and_cannot_assign(client, db):
    t = await _team(client, db)
    owner_token, emp = t["owner"]["token"], t["employee"]
    mine = (
        await create(
            client, t["id"], owner_token, {"name": "שלי", "phone": "052-0000001", "ownerId": emp["user_id"]}
        )
    ).json()["lead"]
    other = (await create(client, t["id"], owner_token, {"name": "לא שלי", "phone": "052-0000002"})).json()[
        "lead"
    ]

    listed = (await req(client, "GET", leads_url(t["id"]), emp["token"])).json()["leads"]
    assert [lead["id"] for lead in listed] == [mine["id"]]
    assert (await req(client, "GET", leads_url(t["id"], f"/{other['id']}"), emp["token"])).status_code == 404
    patch_other = await req(
        client,
        "PATCH",
        leads_url(t["id"], f"/{other['id']}"),
        emp["token"],
        {"stageId": t["stages"][1]["id"]},
    )
    assert patch_other.status_code == 404
    note_other = await req(
        client, "POST", leads_url(t["id"], f"/{other['id']}/notes"), emp["token"], {"text": "x"}
    )
    assert note_other.status_code == 404

    own = await req(
        client, "PATCH", leads_url(t["id"], f"/{mine['id']}"), emp["token"], {"stageId": t["stages"][3]["id"]}
    )
    assert own.status_code == 200
    unassign = await req(
        client, "PATCH", leads_url(t["id"], f"/{mine['id']}"), emp["token"], {"ownerId": None}
    )
    assert unassign.status_code == 403

    # An employee's own manual lead is assigned to them (so they can see it).
    made = (await create(client, t["id"], emp["token"], {"name": "חדש שלי", "phone": "052-0000003"})).json()[
        "lead"
    ]
    assert made["owner"]["id"] == emp["user_id"]
    other_owner = await create(
        client,
        t["id"],
        emp["token"],
        {"name": "אבי לוי", "phone": "052-0000004", "ownerId": t["manager"]["user_id"]},
    )
    assert other_owner.status_code == 403


async def test_stages_and_owners_from_outside_the_business_are_rejected(client, db):
    t = await _team(client, db)
    other = await owner_with_business(client, "other")
    foreign = (
        await req(client, "GET", business_url(other["business"]["id"], "/pipeline"), other["token"])
    ).json()["stages"]
    lead = (
        await create(client, t["id"], t["owner"]["token"], {"name": "רון", "phone": "052-1112233"})
    ).json()["lead"]
    url = leads_url(t["id"], f"/{lead['id']}")

    bad_stage = await req(client, "PATCH", url, t["owner"]["token"], {"stageId": foreign[0]["id"]})
    assert bad_stage.status_code == 400 and bad_stage.json()["error"]["fields"]["stageId"]
    bad_owner = await req(client, "PATCH", url, t["owner"]["token"], {"ownerId": other["user_id"]})
    assert bad_owner.status_code == 400 and bad_owner.json()["error"]["fields"]["ownerId"]
    theirs = (
        await create(client, other["business"]["id"], other["token"], {"name": "זר", "phone": "052-9999999"})
    ).json()["lead"]
    assert (
        await req(client, "GET", leads_url(t["id"], f"/{theirs['id']}"), t["owner"]["token"])
    ).status_code == 404


async def test_search_by_name_phone_and_email_and_filters(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    await create(
        client, t["id"], tok, {"name": "דנה כהן", "phone": "052-7654321", "email": "dana@example.com"}
    )
    ron = (
        await create(
            client,
            t["id"],
            tok,
            {"name": "רון לוי", "phone": "054-1112233", "ownerId": t["employee"]["user_id"]},
        )
    ).json()["lead"]
    await req(client, "PATCH", leads_url(t["id"], f"/{ron['id']}"), tok, {"stageId": t["stages"][4]["id"]})

    async def names(qs):
        res = await req(client, "GET", f"{leads_url(t['id'])}?{qs}", tok)
        return [lead["contact"]["name"] for lead in res.json()["leads"]]

    assert await names("q=דנה") == ["דנה כהן"]
    assert await names("q=0527654321") == ["דנה כהן"]
    assert await names("q=765") == ["דנה כהן"]
    assert await names("q=DANA@") == ["דנה כהן"]
    assert await names(f"stageId={t['stages'][4]['id']}") == ["רון לוי"]
    assert await names(f"ownerId={t['employee']['user_id']}") == ["רון לוי"]
    assert await names("ownerId=none") == ["דנה כהן"]
    assert await names("source=website_form") == []
    assert (await req(client, "GET", f"{leads_url(t['id'])}?stageId=nope", tok)).status_code == 400


async def test_search_treats_like_wildcards_as_text(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    await create(client, t["id"], tok, {"name": "דנה", "phone": "052-7654321"})
    assert (await req(client, "GET", f"{leads_url(t['id'])}?q=%25", tok)).json()["leads"] == []


async def test_attribution_filters(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    a = (await create(client, t["id"], tok, {"name": "אחת", "phone": "052-0000001"})).json()["lead"]
    b = (await create(client, t["id"], tok, {"name": "שתיים", "phone": "052-0000002"})).json()["lead"]
    await create(client, t["id"], tok, {"name": "שלוש", "phone": "052-0000003"})
    seen = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    for lead_id, src, campaign in ((a["id"], "google_ads", "spring"), (b["id"], "direct", None)):
        row = (await db.execute(select(models.Lead).where(models.Lead.id == lead_id))).scalar_one()
        row.attribution = {"source": src, "seenAt": seen, **({"campaign": campaign} if campaign else {})}
        row.attribution_source = src
    await db.commit()

    async def names(qs):
        res = await req(client, "GET", f"{leads_url(t['id'])}?{qs}", tok)
        return sorted(lead["contact"]["name"] for lead in res.json()["leads"])

    assert await names("from=google_ads") == ["אחת"]
    assert await names("campaign=spring") == ["אחת"]
    assert await names("from=unknown") == ["שלוש", "שתיים"]  # none recorded, or direct
    got = (await req(client, "GET", leads_url(t["id"], f"/{a['id']}"), tok)).json()["lead"]
    assert got["attribution"]["source"] == "google_ads" and got["attribution"]["campaign"] == "spring"


async def test_last_whatsapp_message_shows_in_the_list(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    lead = (await create(client, t["id"], tok, {"name": "רון", "phone": "052-1112233"})).json()["lead"]
    now = datetime.now(UTC)
    number = models.WhatsAppNumber(
        id=__import__("uuid").uuid4(),
        business_id=lead["id"] and (await db.execute(select(models.Lead.business_id))).scalar_one(),
        phone="+972521112233",
        status=models.WhatsAppNumberStatus.BUSINESS,
        created_at=now,
        updated_at=now,
    )
    db.add(number)
    await db.flush()
    contact_id = lead["contact"]["id"]
    for i, body in enumerate(["ראשונה", "אחרונה"]):
        db.add(
            models.WhatsAppMessage(
                id=__import__("uuid").uuid4(),
                business_id=number.business_id,
                number_id=number.id,
                contact_id=contact_id,
                direction=models.WhatsAppDirection.IN,
                wa_message_id=f"wamid-{i}",
                body=body,
                status="received",
                created_at=now + timedelta(seconds=i),
            )
        )
    await db.commit()
    listed = (await req(client, "GET", leads_url(t["id"]), tok)).json()["leads"][0]
    assert listed["lastWhatsApp"]["body"] == "אחרונה" and listed["lastWhatsApp"]["direction"] == "IN"


# --------------------------------------------------------------------------- tags


async def test_tags_are_trimmed_deduplicated_logged_filtered_and_suggested(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    a = (await create(client, bid, o["token"], {"name": "רון", "phone": "052-0000001"})).json()["lead"]
    b = (await create(client, bid, o["token"], {"name": "דנה", "phone": "052-0000002"})).json()["lead"]
    assert a["tags"] == []

    res = await req(
        client, "PATCH", leads_url(bid, f"/{a['id']}"), o["token"], {"tags": [" VIP ", "חוזר", "vip"]}
    )
    assert res.json()["lead"]["tags"] == ["VIP", "חוזר"]
    await req(client, "PATCH", leads_url(bid, f"/{b['id']}"), o["token"], {"tags": ["VIP"]})

    detail = (await req(client, "GET", leads_url(bid, f"/{a['id']}"), o["token"])).json()
    assert detail["activities"][0]["type"] == "lead.updated"
    assert detail["activities"][0]["data"] == {"fields": ["tags"]}

    async def names(qs):
        res = await req(client, "GET", f"{leads_url(bid)}?{qs}", o["token"])
        return sorted(lead["contact"]["name"] for lead in res.json()["leads"])

    assert await names("tag=%D7%97%D7%95%D7%96%D7%A8") == ["רון"]
    assert await names("tag=VIP") == ["דנה", "רון"]
    assert (await req(client, "GET", leads_url(bid, "/tags"), o["token"])).json()["tags"] == ["VIP", "חוזר"]


async def test_too_many_or_too_long_tags_get_hebrew_messages(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    lead = (await create(client, bid, o["token"], {"name": "רון", "phone": "052-0000001"})).json()["lead"]
    url = leads_url(bid, f"/{lead['id']}")
    many = await req(client, "PATCH", url, o["token"], {"tags": [f"t{i}" for i in range(11)]})
    assert many.status_code == 400 and "עד 10 תגיות" in many.text
    long = await req(client, "PATCH", url, o["token"], {"tags": ["x" * 31]})
    assert long.status_code == 400


async def test_employees_only_get_tag_suggestions_from_their_leads(client, db):
    o = await owner_with_business(client, "owner")
    bid = o["business"]["id"]
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    mine = (
        await create(client, bid, o["token"], {"name": "שלי", "phone": "052-0000001", "ownerId": emp_id})
    ).json()["lead"]
    other = (await create(client, bid, o["token"], {"name": "אחר", "phone": "052-0000002"})).json()["lead"]
    await req(client, "PATCH", leads_url(bid, f"/{mine['id']}"), o["token"], {"tags": ["שלי"]})
    await req(client, "PATCH", leads_url(bid, f"/{other['id']}"), o["token"], {"tags": ["סודי"]})
    assert (await req(client, "GET", leads_url(bid, "/tags"), emp_token)).json()["tags"] == ["שלי"]


# --------------------------------------------------------------------------- delete


async def test_deleting_removes_history_and_an_orphaned_contact_keeps_tasks_unlinked_and_audits(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    first = (await create(client, bid, o["token"], {"name": "רון", "phone": "052-1112233"})).json()["lead"]
    second = (await create(client, bid, o["token"], {"name": "רון", "phone": "052-1112233"})).json()["lead"]
    await req(client, "POST", leads_url(bid, f"/{first['id']}/notes"), o["token"], {"text": "פרטי"})
    due = (datetime.now(UTC) + timedelta(hours=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    await req(
        client,
        "POST",
        business_url(bid, "/tasks"),
        o["token"],
        {"title": "להתקשר", "dueAt": due, "leadId": first["id"]},
    )

    assert (await req(client, "DELETE", leads_url(bid, f"/{first['id']}"), o["token"])).status_code == 204
    assert (await req(client, "GET", leads_url(bid, f"/{first['id']}"), o["token"])).status_code == 404
    acts = await db.execute(
        select(func.count()).select_from(models.Activity).where(models.Activity.lead_id == first["id"])
    )
    assert acts.scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(models.Contact))).scalar_one() == 1
    assert (await db.execute(select(models.Task.lead_id))).scalar_one() is None

    await req(client, "DELETE", leads_url(bid, f"/{second['id']}"), o["token"])
    assert (await db.execute(select(func.count()).select_from(models.Contact))).scalar_one() == 0
    audits = (
        await db.execute(
            select(models.AuditLog.metadata_)
            .where(models.AuditLog.action == "lead.deleted")
            .order_by(models.AuditLog.created_at)
        )
    ).all()
    assert [a[0] for a in audits] == [{"contactRemoved": False}, {"contactRemoved": True}]


async def test_delete_is_owner_only_and_another_businesss_lead_is_not_found(client, db):
    o = await owner_with_business(client, "owner")
    bid = o["business"]["id"]
    lead = (await create(client, bid, o["token"], {"name": "רון", "phone": "052-1112233"})).json()["lead"]
    mgr_token, mgr_id = await new_user(client, "mgr")
    await add_member(db, bid, mgr_id, "MANAGER")
    assert (await req(client, "DELETE", leads_url(bid, f"/{lead['id']}"), mgr_token)).status_code == 403
    other = await owner_with_business(client, "other")
    res = await req(client, "DELETE", leads_url(other["business"]["id"], f"/{lead['id']}"), other["token"])
    assert res.status_code == 404
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 1


# --------------------------------------------------------------------------- export


async def test_export_is_excel_friendly_csv_with_hebrew_headers_and_safe_cells(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await create(
        client,
        bid,
        o["token"],
        {
            "name": "דנה, כהן",
            "phone": "052-7654321",
            "expectedValue": 1500,
            "message": 'שורה ראשונה\nשורה "שנייה"',
        },
    )
    await create(client, bid, o["token"], {"name": '=HYPERLINK("http://evil","x")', "email": "x@example.com"})

    res = await req(client, "GET", leads_url(bid, "/export.csv"), o["token"])
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/csv; charset=utf-8"
    import re

    assert re.match(
        r'^attachment; filename="simplecatch-leads-\d{4}-\d{2}-\d{2}\.csv"$',
        res.headers["content-disposition"],
    )
    body = res.text
    assert body[0] == "﻿"
    header = body[1:].split("\r\n")[0]
    assert header == "שם,טלפון,אימייל,שלב,מקור,אחראי,ערך משוער (₪),טיפול הבא,תגיות,פרטי הפנייה,נוצר"
    assert '"דנה, כהן",052-7654321,,חדש,הוזן ידנית,,1500,,,"שורה ראשונה\nשורה ""שנייה""",' in body
    assert """"'=HYPERLINK(""http://evil"",""x"")\"""" in body
    audit = (
        await db.execute(select(models.AuditLog).where(models.AuditLog.action == "leads.exported"))
    ).scalar_one()
    assert audit.metadata_ == {"count": 2}


async def test_export_applies_the_same_filters_as_the_list(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await create(client, bid, o["token"], {"name": "דנה", "phone": "052-7654321"})
    await create(client, bid, o["token"], {"name": "רון", "phone": "054-1112233"})
    res = await req(client, "GET", leads_url(bid, "/export.csv") + "?q=%D7%A8%D7%95%D7%9F", o["token"])
    rows = res.text.strip().split("\r\n")
    assert len(rows) == 2 and rows[1].startswith("רון,")


async def test_only_the_owner_can_export(client, db):
    o = await owner_with_business(client)
    for role in ("MANAGER", "EMPLOYEE"):
        token, uid = await new_user(client, role.lower())
        await add_member(db, o["business"]["id"], uid, role)
        assert (
            await req(client, "GET", leads_url(o["business"]["id"], "/export.csv"), token)
        ).status_code == 403
