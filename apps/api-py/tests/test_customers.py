"""Customers (D-163, D-178) and spreadsheet import (D-179), ported from the Node tests."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.db import models
from app.modules.leads.schemas import IMPORT_MAX_ROWS
from tests.conftest import add_member, business_url, new_user, owner_with_business, req


async def _setup(client):
    o = await owner_with_business(client, "cust")
    bid = o["business"]["id"]
    stages = (await req(client, "GET", business_url(bid, "/pipeline"), o["token"])).json()["stages"]
    won = next(s for s in stages if s["kind"] == "WON")["id"]

    async def lead(name, phone, value, is_won):
        created = (
            await req(
                client,
                "POST",
                business_url(bid, "/leads"),
                o["token"],
                {"name": name, "phone": phone, "expectedValue": value},
            )
        ).json()["lead"]
        if is_won:
            await req(
                client, "PATCH", business_url(bid, f"/leads/{created['id']}"), o["token"], {"stageId": won}
            )
        return created

    return o, bid, lead


CUSTOMERS = "/customers"


async def test_lists_only_people_who_bought_one_row_each_newest_purchase_first(client, db):
    o, bid, lead = await _setup(client)
    first = await lead("דנה כהן", "052-1111111", 1000, True)
    await lead("יוסי לוי", "052-2222222", 500, False)
    second = await lead("דנה כהן", "052-1111111", 1500, True)  # same phone → same contact
    seen = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    for lead_id, src in ((first["id"], "meta_ads"), (second["id"], "google_ads")):
        row = (await db.execute(select(models.Lead).where(models.Lead.id == lead_id))).scalar_one()
        row.attribution = {"source": src, "seenAt": seen}
        row.attribution_source = src
    await db.commit()

    res = await req(client, "GET", business_url(bid, CUSTOMERS), o["token"])
    assert res.status_code == 200
    customers = res.json()["customers"]
    assert len(customers) == 1
    c = customers[0]
    assert c["name"] == "דנה כהן" and c["phone"] == "+972521111111" and c["totalValue"] == 2500
    assert c["attribution"]["source"] == "meta_ads"  # where they first came from
    assert [p["leadId"] for p in c["purchases"]] == [second["id"], first["id"]]
    assert c["purchases"][0]["value"] == 1500 and c["purchases"][0]["via"] == "won"

    assert (
        len(
            (
                await req(client, "GET", business_url(bid, CUSTOMERS) + "?q=%D7%93%D7%A0%D7%94", o["token"])
            ).json()["customers"]
        )
        == 1
    )
    assert (
        await req(client, "GET", business_url(bid, CUSTOMERS) + "?q=%D7%99%D7%95%D7%A1%D7%99", o["token"])
    ).json()["customers"] == []


async def test_an_accepted_quote_makes_a_customer_employees_see_only_their_own_outsiders_404(client, db):
    o, bid, lead = await _setup(client)
    open_lead = await lead("רוני", "052-3333333", 800, False)
    now = datetime.now(UTC)
    db.add(
        models.Quote(
            id=uuid.uuid4(),
            business_id=uuid.UUID(bid),
            lead_id=uuid.UUID(open_lead["id"]),
            number=1,
            title="",
            items=[],
            discount=0,
            vat_rate=0,
            notes="",
            status=models.QuoteStatus.ACCEPTED,
            decided_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    c = (await req(client, "GET", business_url(bid, CUSTOMERS), o["token"])).json()["customers"][0]
    assert c["name"] == "רוני" and c["purchases"][0]["via"] == "quote" and c["purchases"][0]["value"] == 800

    emp_token, emp_id = await new_user(client, "cust-emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    assert (await req(client, "GET", business_url(bid, CUSTOMERS), emp_token)).json()["customers"] == []
    other = await owner_with_business(client, "cust-other")
    assert (await req(client, "GET", business_url(bid, CUSTOMERS), other["token"])).status_code == 404


async def test_people_who_booked_are_customers_too_but_not_requests(client, db):
    o, bid, lead = await _setup(client)
    bus = uuid.UUID(bid)
    now = datetime.now(UTC)

    async def contact(name, phone):
        c = models.Contact(
            id=uuid.uuid4(), business_id=bus, name=name, phone=phone, created_at=now, updated_at=now
        )
        db.add(c)
        await db.flush()
        return c

    async def book(contact_id, status, days, staff_id=o["user_id"], service_id=None):
        start = now + timedelta(days=days)
        a = models.Appointment(
            id=uuid.uuid4(),
            business_id=bus,
            contact_id=contact_id,
            staff_id=uuid.UUID(staff_id) if staff_id else None,
            service_id=service_id,
            status=models.AppointmentStatus(status),
            source="manual",
            starts_at=start,
            ends_at=start + timedelta(minutes=30),
            created_at=now,
            updated_at=now,
        )
        db.add(a)
        await db.flush()
        return a

    service = models.Service(
        id=uuid.uuid4(),
        business_id=bus,
        name="תספורת",
        duration_min=30,
        active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(service)
    dana = await contact("דנה כהן", "+972521111111")
    await book(dana.id, "COMPLETED", -3)
    await book(dana.id, "CANCELLED", 2, service_id=service.id)
    yossi = await contact("יוסי לוי", "+972522222222")
    await book(yossi.id, "REQUESTED", 1)
    noa = await contact("נועה", "+972523333333")
    await book(noa.id, "CONFIRMED", 5, staff_id=None)
    bought = await lead("רונית", "052-4444444", 900, True)
    await book(uuid.UUID(bought["contact"]["id"]), "CONFIRMED", 1)
    await db.commit()

    customers = (await req(client, "GET", business_url(bid, CUSTOMERS), o["token"])).json()["customers"]
    names = [c["name"] for c in customers]
    assert {"דנה כהן", "נועה", "רונית"} <= set(names) and "יוסי לוי" not in names
    d = next(c for c in customers if c["name"] == "דנה כהן")
    assert d["totalValue"] == 0 and d["lastPurchaseAt"] is None and d["purchases"] == []
    assert [b["status"] for b in d["bookings"]] == ["CANCELLED", "COMPLETED"]
    assert d["bookings"][0]["serviceName"] == "תספורת"
    r = next(c for c in customers if c["name"] == "רונית")
    assert len(r["purchases"]) == 1 and len(r["bookings"]) == 1 and r["totalValue"] == 900
    assert (
        len(
            (
                await req(
                    client, "GET", business_url(bid, CUSTOMERS) + "?q=%D7%A0%D7%95%D7%A2%D7%94", o["token"]
                )
            ).json()["customers"]
        )
        == 1
    )

    emp_token, emp_id = await new_user(client, "cust-emp2")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    mine = await contact("לקוח של העובד", "+972525555555")
    await book(mine.id, "CONFIRMED", 1, staff_id=emp_id)
    await db.commit()
    seen = (await req(client, "GET", business_url(bid, CUSTOMERS), emp_token)).json()["customers"]
    assert [c["name"] for c in seen] == ["לקוח של העובד"]


# --------------------------------------------------------------------------- import


def imp(bid):
    return business_url(bid, "/customers/import")


async def test_import_creates_a_contact_and_a_won_lead_per_row(client, db):
    o = await owner_with_business(client, "imp")
    bid = o["business"]["id"]
    res = await req(
        client,
        "POST",
        imp(bid),
        o["token"],
        {
            "rows": [
                {"name": "דנה כהן", "phone": "052-1111111", "email": "Dana@Example.com", "value": "₪1,500"},
                {"name": "יוסי לוי", "phone": "0522222222"},
                {"name": "רונית", "email": "ronit@example.com", "value": ""},
            ]
        },
    )
    assert res.status_code == 200 and res.json() == {"imported": 3, "duplicates": 0, "invalid": []}
    customers = (await req(client, "GET", business_url(bid, CUSTOMERS), o["token"])).json()["customers"]
    assert len(customers) == 3
    dana = next(c for c in customers if c["name"] == "דנה כהן")
    assert (dana["phone"], dana["email"], dana["totalValue"]) == ("+972521111111", "dana@example.com", 1500)
    count = await db.execute(
        select(func.count())
        .select_from(models.AuditLog)
        .where(models.AuditLog.action == "customers.imported")
    )
    assert count.scalar_one() == 1


async def test_import_skips_existing_customers_and_repeats_and_reports_bad_rows(client, db):
    o = await owner_with_business(client, "imp2")
    bid = o["business"]["id"]
    first = await req(
        client, "POST", imp(bid), o["token"], {"rows": [{"name": "דנה כהן", "phone": "0521111111"}]}
    )
    assert first.json()["imported"] == 1
    res = await req(
        client,
        "POST",
        imp(bid),
        o["token"],
        {
            "rows": [
                {"name": "דנה כהן", "phone": "+972521111111"},  # already a customer (same phone)
                {"name": "אבי", "phone": "0523333333"},
                {"name": "אבי כהן", "phone": "052-3333333"},  # same phone twice in the file
                {"name": "א", "phone": "0524444444"},  # name too short
                {"name": "ללא פרטים"},  # no phone or email
                {"name": "טלפון שגוי", "phone": "abc"},
                {"name": "מייל שגוי", "email": "not-an-email"},
                {"name": "סכום שגוי", "phone": "0525555555", "value": "12abc"},
            ]
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["imported"] == 1 and body["duplicates"] == 2
    assert [i["row"] for i in body["invalid"]] == [4, 5, 6, 7, 8]
    contacts = await db.execute(
        select(func.count()).select_from(models.Contact).where(models.Contact.business_id == bid)
    )
    assert contacts.scalar_one() == 2


async def test_import_turns_an_existing_lead_contact_into_a_customer_without_a_second_contact(client, db):
    o = await owner_with_business(client, "imp3")
    bid = o["business"]["id"]
    await req(
        client, "POST", business_url(bid, "/leads"), o["token"], {"name": "מיכל", "phone": "0526666666"}
    )
    assert (await req(client, "GET", business_url(bid, CUSTOMERS), o["token"])).json()["customers"] == []
    res = await req(
        client,
        "POST",
        imp(bid),
        o["token"],
        {"rows": [{"name": "מיכל", "phone": "0526666666", "value": "800"}]},
    )
    assert res.json()["imported"] == 1 and res.json()["duplicates"] == 0
    contacts = await db.execute(
        select(func.count()).select_from(models.Contact).where(models.Contact.business_id == bid)
    )
    assert contacts.scalar_one() == 1
    assert len((await req(client, "GET", business_url(bid, CUSTOMERS), o["token"])).json()["customers"]) == 1


async def test_import_is_limited_by_role_size_and_tenant(client, db):
    o = await owner_with_business(client, "imp4")
    bid = o["business"]["id"]
    row = {"name": "דנה", "phone": "0527777777"}
    mgr_token, mgr_id = await new_user(client, "imp-mgr")
    await add_member(db, bid, mgr_id, "MANAGER")
    assert (await req(client, "POST", imp(bid), mgr_token, {"rows": [row]})).status_code == 200
    emp_token, emp_id = await new_user(client, "imp-emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    assert (await req(client, "POST", imp(bid), emp_token, {"rows": [row]})).status_code == 403
    outsider = await owner_with_business(client, "imp-out")
    assert (await req(client, "POST", imp(bid), outsider["token"], {"rows": [row]})).status_code == 404

    assert (await req(client, "POST", imp(bid), o["token"], {"rows": []})).status_code == 400
    too_many = [{"name": f"לקוח {i}", "phone": f"05299{i:05d}"} for i in range(IMPORT_MAX_ROWS + 1)]
    assert (await req(client, "POST", imp(bid), o["token"], {"rows": too_many})).status_code == 400
