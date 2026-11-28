"""Appointments (F17), ported from apps/api/src/modules/appointments/appointments.test.ts."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core.timezone import zoned_time_to_utc
from app.db import models
from app.modules.appointments.availability import BusinessInfo, free_times
from app.modules.appointments.service import AppointmentService
from tests.conftest import add_member, business_url, new_user, owner_with_business, req


def at(h, m=0):
    """A Sunday far from 'now', in UTC."""
    return datetime(2030, 1, 6, h, m, tzinfo=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


DAY = {"from": at(0), "to": at(23, 59)}


def list_qs(extra=""):
    return f"?from={DAY['from']}&to={DAY['to']}{extra}"


def appts(bid, tail=""):
    return business_url(bid, f"/appointments{tail}")


async def _team(client, db):
    owner = await owner_with_business(client, "owner")
    bid = owner["business"]["id"]
    emp_token, emp_id = await new_user(client, "emp")
    emp2_token, emp2_id = await new_user(client, "emp2")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    await add_member(db, bid, emp2_id, "EMPLOYEE")
    service = (
        await req(
            client,
            "POST",
            business_url(bid, "/services"),
            owner["token"],
            {"name": "תספורת", "durationMin": 45, "price": 120},
        )
    ).json()["service"]
    return {
        "owner": owner,
        "emp": {"token": emp_token, "user_id": emp_id},
        "emp2": {"token": emp2_token, "user_id": emp2_id},
        "id": bid,
        "service": service,
    }


async def book(client, bid, token, body):
    return await req(client, "POST", appts(bid), token, body)


async def test_books_with_the_service_duration_reuses_the_contact_by_phone_and_lists_the_day(client, db):
    t = await _team(client, db)
    res = await book(
        client,
        t["id"],
        t["owner"]["token"],
        {
            "startsAt": at(9),
            "serviceId": t["service"]["id"],
            "staffId": t["emp"]["user_id"],
            "customer": {"name": "דנה כהן", "phone": "052-1112233"},
            "notes": "פעם ראשונה",
        },
    )
    assert res.status_code == 201
    a = res.json()["appointment"]
    assert (a["startsAt"], a["endsAt"], a["status"]) == (at(9), at(9, 45), "CONFIRMED")
    assert a["service"]["name"] == "תספורת" and a["staff"]["id"] == t["emp"]["user_id"]
    assert a["customer"]["name"] == "דנה כהן" and a["customer"]["phone"] == "+972521112233"
    assert a["notes"] == "פעם ראשונה" and a["source"] == "manual"

    await book(
        client,
        t["id"],
        t["owner"]["token"],
        {
            "startsAt": at(11),
            "staffId": t["emp"]["user_id"],
            "customer": {"name": "דנה", "phone": "0521112233"},
        },
    )
    assert (await db.execute(select(func.count()).select_from(models.Contact))).scalar_one() == 1
    listing = (await req(client, "GET", f"{appts(t['id'])}{list_qs()}", t["owner"]["token"])).json()
    assert [x["startsAt"] for x in listing["appointments"]] == [at(9), at(11)]
    assert listing["appointments"][1]["endsAt"] == at(11, 30)  # default 30 minutes


async def test_double_booking_a_staff_member_is_prevented_back_to_back_and_other_staff_are_fine(client, db):
    t = await _team(client, db)
    c = {"name": "לקוח", "phone": "052-0000001"}
    tok, emp = t["owner"]["token"], t["emp"]["user_id"]
    await book(client, t["id"], tok, {"startsAt": at(10), "durationMin": 60, "staffId": emp, "customer": c})
    clash = await book(
        client, t["id"], tok, {"startsAt": at(10, 30), "durationMin": 30, "staffId": emp, "customer": c}
    )
    assert clash.status_code == 409 and "יש כבר פגישה" in clash.json()["error"]["message"]
    assert (
        await book(client, t["id"], tok, {"startsAt": at(11), "staffId": emp, "customer": c})
    ).status_code == 201
    other = await book(
        client, t["id"], tok, {"startsAt": at(10, 15), "staffId": t["emp2"]["user_id"], "customer": c}
    )
    assert other.status_code == 201


async def test_simultaneous_bookings_for_one_slot_exactly_one_wins(client, db):
    t = await _team(client, db)
    results = await asyncio.gather(
        *[
            book(
                client,
                t["id"],
                t["owner"]["token"],
                {
                    "startsAt": at(14),
                    "staffId": t["emp"]["user_id"],
                    "customer": {"name": f"לקוח {n}", "phone": f"052-000000{n}"},
                },
            )
            for n in (1, 2, 3)
        ]
    )
    assert sorted(r.status_code for r in results) == [201, 409, 409]


async def test_cancelling_frees_the_slot_and_rescheduling_into_a_busy_slot_is_refused(client, db):
    t = await _team(client, db)
    c = {"name": "לקוח", "phone": "052-0000001"}
    tok, emp = t["owner"]["token"], t["emp"]["user_id"]
    a = (await book(client, t["id"], tok, {"startsAt": at(9), "staffId": emp, "customer": c})).json()[
        "appointment"
    ]
    b = (await book(client, t["id"], tok, {"startsAt": at(12), "staffId": emp, "customer": c})).json()[
        "appointment"
    ]

    move = await req(client, "PATCH", appts(t["id"], f"/{b['id']}"), tok, {"startsAt": at(9, 15)})
    assert move.status_code == 409
    await req(client, "PATCH", appts(t["id"], f"/{a['id']}"), tok, {"status": "CANCELLED"})
    moved = await req(client, "PATCH", appts(t["id"], f"/{b['id']}"), tok, {"startsAt": at(9, 15)})
    assert moved.status_code == 200
    back = await req(client, "PATCH", appts(t["id"], f"/{a['id']}"), tok, {"status": "CONFIRMED"})
    assert back.status_code == 409  # re-confirming the cancelled one now clashes


async def test_confirming_needs_a_staff_member(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    made = await book(
        client,
        t["id"],
        tok,
        {"startsAt": at(9), "staffId": None, "customer": {"name": "לקוח", "phone": "052-0000001"}},
    )
    appt = made.json()["appointment"]
    assert appt["status"] == "REQUESTED" and appt["staff"] is None
    res = await req(client, "PATCH", appts(t["id"], f"/{appt['id']}"), tok, {"status": "CONFIRMED"})
    assert res.status_code == 400 and res.json()["error"]["fields"]["staffId"]
    ok = await req(
        client,
        "PATCH",
        appts(t["id"], f"/{appt['id']}"),
        tok,
        {"status": "CONFIRMED", "staffId": t["emp"]["user_id"]},
    )
    assert ok.status_code == 200 and ok.json()["appointment"]["status"] == "CONFIRMED"
    reqs = (await req(client, "GET", appts(t["id"], "/requests"), tok)).json()["appointments"]
    assert reqs == []


async def test_books_from_a_lead_and_records_it_in_the_lead_history(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    lead = (
        await req(
            client, "POST", business_url(t["id"], "/leads"), tok, {"name": "רון", "phone": "054-1112233"}
        )
    ).json()["lead"]
    res = await book(
        client, t["id"], tok, {"startsAt": at(9), "leadId": lead["id"], "serviceId": t["service"]["id"]}
    )
    a = res.json()["appointment"]
    assert a["lead"] == {"id": lead["id"]} and a["customer"]["name"] == "רון"
    detail = (await req(client, "GET", business_url(t["id"], f"/leads/{lead['id']}"), tok)).json()
    # F35: the booking's confirm task lands in the history right after it.
    by_type = {x["type"]: x for x in detail["activities"][:2]}
    assert set(by_type) == {"task.created", "appointment.created"}
    assert by_type["task.created"]["data"]["auto"] == "appointment_confirm"
    assert by_type["appointment.created"]["data"]["service"] == "תספורת"
    by_lead = (await req(client, "GET", f"{appts(t['id'])}{list_qs(f'&leadId={lead["id"]}')}", tok)).json()
    assert len(by_lead["appointments"]) == 1
    assert (await book(client, t["id"], tok, {"startsAt": at(9)})).status_code == 400  # no customer


async def test_employees_see_and_book_only_themselves_and_only_owners_manage_services(client, db):
    t = await _team(client, db)
    c = {"name": "לקוח", "phone": "052-0000001"}
    owner_tok, emp = t["owner"]["token"], t["emp"]
    await book(
        client, t["id"], owner_tok, {"startsAt": at(9), "staffId": t["emp2"]["user_id"], "customer": c}
    )
    mine = await book(client, t["id"], emp["token"], {"startsAt": at(9), "customer": c})
    assert mine.status_code == 201 and mine.json()["appointment"]["staff"]["id"] == emp["user_id"]
    other = await book(
        client, t["id"], emp["token"], {"startsAt": at(15), "staffId": t["emp2"]["user_id"], "customer": c}
    )
    assert other.status_code == 403

    seen = (await req(client, "GET", f"{appts(t['id'])}{list_qs()}", emp["token"])).json()
    assert len(seen["appointments"]) == 1
    everyone = (await req(client, "GET", f"{appts(t['id'])}{list_qs()}", owner_tok)).json()["appointments"]
    theirs = next(a for a in everyone if a["staff"]["id"] == t["emp2"]["user_id"])
    cancel = await req(
        client, "PATCH", appts(t["id"], f"/{theirs['id']}"), emp["token"], {"status": "CANCELLED"}
    )
    assert cancel.status_code == 404

    svc = business_url(t["id"], "/services")
    assert (await req(client, "POST", svc, emp["token"], {"name": "x", "durationMin": 30})).status_code == 403
    assert (await req(client, "GET", svc, emp["token"])).status_code == 200


async def test_services_validate_and_used_ones_are_deactivated_instead_of_deleted(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    svc = business_url(t["id"], "/services")
    bad = await req(client, "POST", svc, tok, {"name": "", "durationMin": 2})
    assert bad.status_code == 400 and "5 דקות" in bad.json()["error"]["fields"]["durationMin"]

    await book(
        client,
        t["id"],
        tok,
        {
            "startsAt": at(9),
            "serviceId": t["service"]["id"],
            "customer": {"name": "לקוח", "phone": "052-0000001"},
        },
    )
    await req(client, "DELETE", f"{svc}/{t['service']['id']}", tok)
    used = (
        await db.execute(select(models.Service.active).where(models.Service.id == t["service"]["id"]))
    ).scalar_one()
    assert used is False
    unused = (await req(client, "POST", svc, tok, {"name": "צבע", "durationMin": 90})).json()["service"]
    await req(client, "DELETE", f"{svc}/{unused['id']}", tok)
    count = await db.execute(
        select(func.count()).select_from(models.Service).where(models.Service.id == unused["id"])
    )
    assert count.scalar_one() == 0

    edited = await req(
        client,
        "PUT",
        f"{svc}/{t['service']['id']}",
        tok,
        {"name": "תספורת גברים", "durationMin": 30, "price": None, "active": True},
    )
    assert edited.json()["service"] == {
        "id": t["service"]["id"],
        "name": "תספורת גברים",
        "durationMin": 30,
        "price": None,
        "active": True,
    }


async def test_another_business_cannot_use_our_services_staff_or_appointments(client, db):
    t = await _team(client, db)
    other = await owner_with_business(client, "other")
    obid, otok = other["business"]["id"], other["token"]
    appt = (
        await book(
            client,
            t["id"],
            t["owner"]["token"],
            {"startsAt": at(9), "customer": {"name": "לקוח", "phone": "052-0000001"}},
        )
    ).json()["appointment"]
    foreign = {"name": "זר", "phone": "052-9999999"}
    assert (
        await book(
            client, obid, otok, {"startsAt": at(9), "serviceId": t["service"]["id"], "customer": foreign}
        )
    ).status_code == 400
    assert (
        await book(
            client, obid, otok, {"startsAt": at(9), "staffId": t["emp"]["user_id"], "customer": foreign}
        )
    ).status_code == 400
    res = await req(client, "PATCH", appts(obid, f"/{appt['id']}"), otok, {"status": "CANCELLED"})
    assert res.status_code == 404


async def test_the_list_window_is_validated(client, db):
    t = await _team(client, db)
    tok = t["owner"]["token"]
    assert (await req(client, "GET", appts(t["id"]), tok)).status_code == 400
    backwards = f"{appts(t['id'])}?from={at(10)}&to={at(9)}"
    assert (await req(client, "GET", backwards, tok)).status_code == 400
    too_long = f"{appts(t['id'])}?from=2030-01-01T00:00:00.000Z&to=2030-04-01T00:00:00.000Z"
    assert (await req(client, "GET", too_long, tok)).status_code == 400


# --------------------------------------------------------------------------- customer bookings


async def test_a_website_request_is_held_without_staff_and_makes_a_task_for_the_owner(client, db):
    t = await _team(client, db)
    lead = (
        await req(
            client,
            "POST",
            business_url(t["id"], "/leads"),
            t["owner"]["token"],
            {"name": "רון", "phone": "054-1112233"},
        )
    ).json()["lead"]
    starts = datetime(2030, 1, 6, 9, 0, tzinfo=UTC)
    await AppointmentService(db).request_from_website(
        uuid.UUID(t["id"]),
        uuid.UUID(lead["id"]),
        uuid.UUID(lead["contact"]["id"]),
        uuid.UUID(t["service"]["id"]),
        starts,
    )
    reqs = (await req(client, "GET", appts(t["id"], "/requests"), t["owner"]["token"])).json()["appointments"]
    assert len(reqs) == 1 and reqs[0]["source"] == "website" and reqs[0]["staff"] is None
    assert reqs[0]["endsAt"] == at(9, 45)
    task = (await db.execute(select(models.Task))).scalar_one()
    assert str(task.assignee_id) == t["owner"]["user_id"] and task.remind is False
    # D-216 (2): the notice is the appointment's confirm task (REQUESTED: due now, no reminder).
    assert task.title.startswith("לאשר את הפגישה: רון · תספורת · ")
    assert task.notes == "מחכה לאישור שלכם בעמוד הפגישות."
    assert task.auto_kind == "appointment_confirm" and task.appointment_id is not None
    detail = (
        await req(client, "GET", business_url(t["id"], f"/leads/{lead['id']}"), t["owner"]["token"])
    ).json()
    assert detail["activities"][0]["data"]["requested"] is True


async def test_the_whatsapp_booking_paths_hold_time_and_conflicts_are_reported(client, db):
    t = await _team(client, db)
    lead = (
        await req(
            client,
            "POST",
            business_url(t["id"], "/leads"),
            t["owner"]["token"],
            {"name": "רון", "phone": "054-1112233"},
        )
    ).json()["lead"]
    bus, lid, cid = uuid.UUID(t["id"]), uuid.UUID(lead["id"]), uuid.UUID(lead["contact"]["id"])
    staff = uuid.UUID(t["emp"]["user_id"])
    starts = datetime(2030, 1, 6, 9, 0, tzinfo=UTC)
    svc = AppointmentService(db)
    appt_id = await svc.book_from_whatsapp(bus, cid, lid, None, "תספורת", staff, starts, 30, confirmed=True)
    row = (await db.execute(select(models.Appointment).where(models.Appointment.id == appt_id))).scalar_one()
    assert row.status == models.AppointmentStatus.CONFIRMED and row.source == "whatsapp"
    try:
        await svc.book_from_whatsapp(
            bus, cid, lid, None, None, staff, starts + timedelta(minutes=10), 30, confirmed=True
        )
        raise AssertionError("expected a clash")
    except Exception as err:
        assert getattr(err, "code", None) == "CONFLICT"
    await db.rollback()

    # The customer cancels from WhatsApp: the time is free again and the team gets a task.
    other = (await db.execute(select(models.Contact.id).where(models.Contact.id == cid))).scalar_one()
    assert await svc.cancel_from_whatsapp(bus, appt_id, uuid.uuid4()) is None  # someone else's
    done = await svc.cancel_from_whatsapp(bus, appt_id, other)
    assert done == {"leadId": lid, "staffId": staff}
    titles = [r[0] for r in await db.execute(select(models.Task.title))]
    assert any(x.startswith("פגישה בוטלה: רון") for x in titles)
    again = await svc.book_from_whatsapp(bus, cid, lid, None, None, staff, starts, 30, confirmed=False)
    assert again

    call_back = await svc.call_back_from_whatsapp(
        bus, cid, lid, staff, starts + timedelta(hours=3), "שיחה חוזרת"
    )
    cb = (await db.execute(select(models.Appointment).where(models.Appointment.id == call_back))).scalar_one()
    assert (cb.ends_at - cb.starts_at) == timedelta(minutes=15)
    event = await svc.request_event_from_whatsapp(
        bus,
        cid,
        lid,
        None,
        starts + timedelta(days=1),
        starts + timedelta(days=1, hours=1),
        "x" * 2000,
        "חתונה",
    )
    ev = (await db.execute(select(models.Appointment).where(models.Appointment.id == event))).scalar_one()
    assert ev.staff_id is None and len(ev.notes) == 1000


# --------------------------------------------------------------------------- availability


async def test_free_times_respect_hours_notice_bookings_and_the_least_busy_staff(client, db):
    t = await _team(client, db)
    bus = uuid.UUID(t["id"])
    business = (await db.execute(select(models.Business).where(models.Business.id == bus))).scalar_one()
    info = BusinessInfo(id=bus, timezone=business.timezone, opening_hours=None)  # null hours = the defaults
    sunday, saturday = "2030-01-06", "2030-01-05"
    now = datetime(2030, 1, 1, 0, 0, tzinfo=UTC)
    out = await free_times(db, info, [sunday, saturday], 60, now=now)
    assert out[saturday] == []  # closed
    times = [x.time for x in out[sunday]]
    assert times[0] == "09:00" and times[-1] == "17:00" and len(times) == 17  # 60 min fits until 18:00

    # Book everyone on Sunday 09:00 → that start is gone; staff already busy that day sort last.
    owner_id = uuid.UUID(t["owner"]["user_id"])
    starts = zoned_time_to_utc(sunday, "09:00", business.timezone)
    now_ = datetime.now(UTC)
    contact = models.Contact(
        id=uuid.uuid4(), business_id=bus, name="x", phone="+972521112233", created_at=now_, updated_at=now_
    )
    db.add(contact)
    await db.flush()
    for staff in (owner_id, uuid.UUID(t["emp"]["user_id"]), uuid.UUID(t["emp2"]["user_id"])):
        db.add(
            models.Appointment(
                id=uuid.uuid4(), business_id=bus, contact_id=contact.id, staff_id=staff, starts_at=starts,
                ends_at=starts + timedelta(minutes=60), status=models.AppointmentStatus.CONFIRMED,
                source="manual", created_at=now_, updated_at=now_,
            )
        )  # fmt: skip
    await db.commit()
    out = await free_times(db, info, [sunday], 60, now=now)
    assert "09:00" not in [x.time for x in out[sunday]] and "09:30" not in [x.time for x in out[sunday]]
    assert out[sunday][0].time == "10:00"

    # Notice: nothing earlier than an hour from now.
    soon = zoned_time_to_utc(sunday, "09:30", business.timezone)
    out = await free_times(db, info, [sunday], 30, now=soon - timedelta(minutes=30))
    assert min(x.time for x in out[sunday]) >= "10:00"
