"""F35 automatic follow-ups (D-213, D-214, D-216): the due-time port (parity with
packages/shared/src/tasks.ts), the per-business switches, the quote follow-up, the appointment
confirm task (incl. customer bookings' D-152 notices), lead owner change and lead deletion."""

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, update

from app.core.timeutil import iso
from app.db import models
from app.modules.appointments.service import AppointmentService
from app.modules.tasks import auto as task_auto
from app.modules.tasks.service import TaskService
from app.shared import tasks as st
from app.shared.tasks import (
    AUTO_TASK_TITLES,
    add_days,
    appointment_confirm_due_at,
    quote_follow_up_due_at,
    weekday_of,
)
from tests.conftest import (
    HEADERS,
    add_member,
    business_url,
    make_task,
    new_user,
    owner_with_business,
    req,
)

SHARED = Path(__file__).resolve().parents[3] / "packages" / "shared" / "src"
TZ = "Asia/Jerusalem"


def d(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def z(dt: datetime | None) -> str | None:
    return iso(dt) if dt else None


# =========================================================================== parity with the shared helpers


def test_quote_follow_up_due_matches_the_shared_vectors():
    cases = {
        "2026-11-29T16:30:00Z": "2026-12-01T07:00:00.000Z",  # Sun 18:30 → Tue 09:00
        "2026-11-29T23:30:00Z": "2026-12-02T07:00:00.000Z",  # already the 30th in Israel
        "2026-07-10T09:00:00Z": "2026-07-12T06:00:00.000Z",  # summer time (UTC+3)
        "2026-12-02T10:00:00Z": "2026-12-06T07:00:00.000Z",  # Wed → Fri → Sun
        "2026-12-03T10:00:00Z": "2026-12-06T07:00:00.000Z",  # Thu → Sat → Sun
        "2026-12-04T10:00:00Z": "2026-12-06T07:00:00.000Z",  # Fri → Sun
        "2026-10-22T12:00:00Z": "2026-10-25T07:00:00.000Z",  # Thu → Sun 25 Oct, summer time ends
        "2027-03-24T12:00:00Z": "2027-03-28T06:00:00.000Z",  # Wed → Fri 26 (DST starts) → Sun 28
    }
    for sent, due in cases.items():
        assert z(quote_follow_up_due_at(d(sent), TZ)) == due, sent


def test_appointment_confirm_due_matches_the_shared_vectors():
    now = "2026-11-30T08:00:00Z"
    cases = [
        ("2026-12-03T12:00:00Z", "2026-11-28T10:00:00Z", "2026-12-02T07:00:00.000Z"),  # Thu → Wed 09:00
        ("2026-12-03T12:00:00Z", "2026-12-02T18:00:00Z", "2026-12-02T18:00:00.000Z"),  # passed → now
        ("2026-12-03T15:00:00Z", "2026-12-03T06:00:00Z", None),  # today → no task
        ("2026-12-01T15:00:00Z", "2026-12-03T06:00:00Z", None),  # past → no task
        ("2026-12-03T22:30:00Z", "2026-12-03T06:00:00Z", "2026-12-03T07:00:00.000Z"),  # the 4th in Israel
        ("2026-12-04T12:00:00Z", now, "2026-12-03T07:00:00.000Z"),  # Friday → Thursday, no shift
        ("2026-12-05T18:00:00Z", now, "2026-12-03T07:00:00.000Z"),  # Saturday → Thursday
        ("2026-12-06T12:00:00Z", now, "2026-12-06T07:00:00.000Z"),  # Sunday 14:00 → Sunday 09:00
        ("2026-12-06T06:30:00Z", now, "2026-12-03T07:00:00.000Z"),  # Sunday 08:30 → Thursday
        ("2026-12-06T07:00:00Z", now, "2026-12-03T07:00:00.000Z"),  # Sunday exactly 09:00 → Thursday
        ("2026-12-07T12:00:00Z", now, "2026-12-06T07:00:00.000Z"),  # Monday → Sunday
        ("2026-12-05T18:00:00Z", "2026-12-04T10:00:00Z", "2026-12-04T10:00:00.000Z"),  # shifted, past → now
        ("2026-10-25T12:00:00Z", "2026-10-20T08:00:00Z", "2026-10-25T07:00:00.000Z"),  # DST ends
        ("2027-03-29T09:00:00Z", "2027-03-20T08:00:00Z", "2027-03-28T06:00:00.000Z"),  # DST starts
    ]
    for start, at, due in cases:
        assert z(appointment_confirm_due_at(d(start), d(at), TZ)) == due, (start, at)


def test_calendar_helpers_match_the_shared_ones():
    assert add_days("2026-12-31", 2) == "2027-01-02"
    assert add_days("2027-03-01", -1) == "2027-02-28"
    assert weekday_of("2026-12-04") == 5 and weekday_of("2026-12-06") == 0 and weekday_of("2026-12-05") == 6


def test_every_due_time_vector_in_the_shared_test_file_holds_in_python():
    """Replays the `due(...)` / `confirm(...)` vectors of packages/shared/src/tasks.test.ts, so a
    rule changed there and not here fails."""
    src = (SHARED / "tasks.test.ts").read_text(encoding="utf-8")
    default_now = re.search(r"const confirm = \(start: string, now = '([^']+)'\)", src)
    assert default_now
    due_cases = re.findall(r"(?<![\w.])due\('([^']+)'\)\)\.toBe\('([^']+)'\)", src)
    confirm_cases = re.findall(
        r"(?<![\w.])confirm\(\s*'([^']+)'(?:,\s*'([^']+)')?\s*\)\)\.toBe\(\s*'([^']+)',?\s*\)", src
    )
    assert len(due_cases) >= 5 and len(confirm_cases) >= 8
    for sent, due in due_cases:
        assert z(quote_follow_up_due_at(d(sent), TZ)) == due, sent
    for start, now, due in confirm_cases:
        assert z(appointment_confirm_due_at(d(start), d(now or default_now.group(1)), TZ)) == due, start


def test_titles_and_constants_match_the_shared_package_byte_for_byte():
    src = (SHARED / "tasks.ts").read_text(encoding="utf-8")
    assert f"export const AUTO_TASK_TIME = '{st.AUTO_TASK_TIME}';" in src
    assert f"export const QUOTE_FOLLOW_UP_DAYS = {st.QUOTE_FOLLOW_UP_DAYS};" in src
    assert "quote_followup: (number: number) => `לחזור לגבי הצעה #${number}`," in src
    assert "quote_followup: (number: number) => `Follow up on quote #${number}`," in src
    assert "details ? `לאשר את הפגישה: ${details}` : 'לאשר את הפגישה'," in src
    assert "details ? `Confirm the appointment: ${details}` : 'Confirm the appointment'," in src
    assert AUTO_TASK_TITLES["he"]["quote_followup"](12) == "לחזור לגבי הצעה #12"
    assert AUTO_TASK_TITLES["en"]["appointment_confirm"]() == "Confirm the appointment"
    assert AUTO_TASK_TITLES["he"]["appointment_confirm"]("דנה · תספורת") == "לאשר את הפגישה: דנה · תספורת"
    assert (
        AUTO_TASK_TITLES["en"]["appointment_confirm"]("Dana · Haircut")
        == "Confirm the appointment: Dana · Haircut"
    )
    assert "export const TASK_AUTO_KINDS = ['quote_followup', 'appointment_confirm'] as const;" in src
    perms = (SHARED / "permissions.ts").read_text(encoding="utf-8")
    assert "'automations.manage': ['OWNER', 'MANAGER']," in perms


def test_task_messages_match_the_shared_package():
    from app.modules.tasks.schemas import TASK_MESSAGES

    src = (SHARED / "tasks.ts").read_text(encoding="utf-8")
    block = src[src.index("export const taskMessages = {") : src.index("} as const;")]
    shared = dict(re.findall(r"^\s*(\w+): '(.*?)',$", block, re.M))
    assert shared == TASK_MESSAGES


# =========================================================================== helpers


async def _team(client, db):
    owner = await owner_with_business(client, "owner")
    bid = owner["business"]["id"]
    mgr_token, mgr_id = await new_user(client, "mgr")
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, mgr_id, "MANAGER")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    return {
        "id": bid,
        "owner": owner,
        "manager": {"token": mgr_token, "user_id": mgr_id},
        "employee": {"token": emp_token, "user_id": emp_id},
    }


def auto_url(bid):
    return business_url(bid, "/automations/tasks")


async def _switch(client, t, quote=True, appointment=True):
    res = await req(
        client,
        "PUT",
        auto_url(t["id"]),
        t["owner"]["token"],
        {"quoteFollowUp": quote, "appointmentConfirm": appointment},
    )
    assert res.status_code == 200, res.text


async def _tasks(db, **where) -> list[models.Task]:
    conds = [getattr(models.Task, k) == v for k, v in where.items()]
    rows = await db.execute(
        select(models.Task)
        .where(*conds)
        .order_by(models.Task.created_at)
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars())


QUOTE = {
    "title": "שיפוץ",
    "items": [{"description": "עבודה", "quantity": 1, "unitPrice": 100000}],
    "discount": 0,
    "vatRate": 18,
    "notes": "",
}


async def _lead(client, t, token=None, owner_id=None, phone="052-1112233"):
    body = {"name": "רון לוי", "phone": phone}
    if owner_id:
        body["ownerId"] = owner_id
    res = await req(client, "POST", business_url(t["id"], "/leads"), token or t["owner"]["token"], body)
    assert res.status_code == 201, res.text
    return res.json()["lead"]


async def _quote(client, t, lead_id, token=None):
    res = await req(
        client,
        "POST",
        business_url(t["id"], "/quotes"),
        token or t["owner"]["token"],
        {"leadId": lead_id, **QUOTE},
    )
    assert res.status_code == 201, res.text
    return res.json()["quote"]


async def _send(client, t, quote_id, token=None):
    res = await req(
        client,
        "POST",
        business_url(t["id"], f"/quotes/{quote_id}/send"),
        token or t["owner"]["token"],
        {"email": False},
    )
    assert res.status_code == 200, res.text
    return res.json()["quote"]


# =========================================================================== switches


async def test_switches_default_on_everyone_reads_owner_and_manager_change_audited(client, db):
    t = await _team(client, db)
    for who in ("owner", "manager", "employee"):
        res = await req(client, "GET", auto_url(t["id"]), t[who]["token"])
        assert res.status_code == 200
        assert res.json() == {"settings": {"quoteFollowUp": True, "appointmentConfirm": True}}

    body = {"quoteFollowUp": False, "appointmentConfirm": True}
    denied = await req(client, "PUT", auto_url(t["id"]), t["employee"]["token"], body)
    assert denied.status_code == 403
    ok = await req(client, "PUT", auto_url(t["id"]), t["manager"]["token"], body)
    assert ok.status_code == 200 and ok.json()["settings"] == body
    missing = await req(client, "PUT", auto_url(t["id"]), t["owner"]["token"], {"quoteFollowUp": True})
    assert missing.status_code == 400 and "appointmentConfirm" in missing.json()["error"]["fields"]
    loose = await req(
        client,
        "PUT",
        auto_url(t["id"]),
        t["owner"]["token"],
        {"quoteFollowUp": "yes", "appointmentConfirm": 1},
    )
    assert loose.status_code == 400
    # The same settings again: no second audit row.
    await req(client, "PUT", auto_url(t["id"]), t["owner"]["token"], body)
    audits = (
        (
            await db.execute(
                select(models.AuditLog).where(
                    models.AuditLog.action == "automations.tasks_updated",
                    models.AuditLog.business_id == uuid.UUID(t["id"]),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(audits) == 1 and str(audits[0].actor_user_id) == t["manager"]["user_id"]
    assert (await req(client, "GET", auto_url(t["id"]), t["employee"]["token"])).json()["settings"] == body


async def test_the_switch_route_is_tenant_scoped(client, db):
    a = await owner_with_business(client, "a")
    b = await owner_with_business(client, "b")
    res = await req(
        client,
        "PUT",
        auto_url(a["business"]["id"]),
        b["token"],
        {"quoteFollowUp": False, "appointmentConfirm": False},
    )
    assert res.status_code == 404
    assert (await req(client, "GET", auto_url(a["business"]["id"]), b["token"])).status_code == 404
    still = (await req(client, "GET", auto_url(a["business"]["id"]), a["token"])).json()["settings"]
    assert still == {"quoteFollowUp": True, "appointmentConfirm": True}


# =========================================================================== quote follow-up


async def test_sending_a_quote_creates_one_follow_up_for_the_lead_owner_and_resends_move_it(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t, owner_id=t["employee"]["user_id"])
    q = await _quote(client, t, lead["id"])
    sent = await _send(client, t, q["id"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert task.auto_kind == "quote_followup" and task.quote_id == uuid.UUID(q["id"])
    assert task.title == f"לחזור לגבי הצעה #{q['number']}" and task.remind is True
    assert task.created_by_id is None and str(task.assignee_id) == t["employee"]["user_id"]
    assert iso(task.due_at) == iso(quote_follow_up_due_at(d(sent["sentAt"]), TZ))
    # 09:00 Israel, never on Friday/Saturday.
    local = task.due_at.astimezone(__import__("zoneinfo").ZoneInfo(TZ))
    assert (local.hour, local.minute) == (9, 0) and local.isoweekday() not in (5, 6)
    history = (
        await req(client, "GET", business_url(t["id"], f"/leads/{lead['id']}"), t["owner"]["token"])
    ).json()
    created = [a for a in history["activities"] if a["type"] == "task.created"]
    assert len(created) == 1 and created[0]["data"]["auto"] == "quote_followup"
    assert created[0]["actor"]["id"] == t["owner"]["user_id"]

    # The reminder fired, then a re-send: still one task, due from the last send, reminder re-armed.
    await db.execute(update(models.Task).values(reminder_sent_at=datetime.now(UTC)))
    await db.commit()
    for _ in range(4):
        sent = await _send(client, t, q["id"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert task.reminder_sent_at is None
    assert iso(task.due_at) == iso(quote_follow_up_due_at(d(sent["sentAt"]), TZ))

    # The read model shows the subject and the kind.
    listed = (
        await req(client, "GET", business_url(t["id"], f"/tasks?quoteId={q['id']}"), t["owner"]["token"])
    ).json()
    [row] = listed["tasks"]
    assert row["autoKind"] == "quote_followup"
    assert row["subject"] == {"kind": "quote", "id": q["id"], "number": q["number"], "status": "SENT"}


async def test_follow_up_goes_to_the_sender_when_the_lead_owner_is_not_an_active_member(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t, owner_id=t["employee"]["user_id"])
    await db.execute(
        update(models.Membership)
        .where(models.Membership.user_id == uuid.UUID(t["employee"]["user_id"]))
        .values(status=models.MembershipStatus.DISABLED)
    )
    await db.commit()
    q = await _quote(client, t, lead["id"], t["manager"]["token"])
    await _send(client, t, q["id"], t["manager"]["token"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert str(task.assignee_id) == t["manager"]["user_id"]


async def test_a_revision_re_points_the_open_follow_up_and_keeps_the_assignee(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q1 = await _quote(client, t, lead["id"])
    await _send(client, t, q1["id"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    await db.execute(
        update(models.Task)
        .where(models.Task.id == task.id)
        .values(assignee_id=uuid.UUID(t["manager"]["user_id"]))
    )
    await db.commit()
    dup = (
        await req(client, "POST", business_url(t["id"], f"/quotes/{q1['id']}/duplicate"), t["owner"]["token"])
    ).json()["quote"]
    assert len(await _tasks(db, lead_id=uuid.UUID(lead["id"]))) == 1  # duplicating alone: nothing
    await _send(client, t, dup["id"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert task.quote_id == uuid.UUID(dup["id"]) and task.title == f"לחזור לגבי הצעה #{dup['number']}"
    assert str(task.assignee_id) == t["manager"]["user_id"]

    # A renamed follow-up keeps its title when re-pointed.
    task_id = task.id
    await db.execute(update(models.Task).where(models.Task.id == task_id).values(title="להתקשר לרון"))
    await db.commit()
    third = (
        await req(
            client, "POST", business_url(t["id"], f"/quotes/{dup['id']}/duplicate"), t["owner"]["token"]
        )
    ).json()["quote"]
    await _send(client, t, third["id"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert task.id == task_id and task.title == "להתקשר לרון" and task.quote_id == uuid.UUID(third["id"])


async def test_team_and_customer_decisions_close_the_follow_up_but_not_a_persons_task(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    person = await req(
        client,
        "POST",
        business_url(t["id"], "/tasks"),
        t["owner"]["token"],
        {"title": "לשלוח דוגמאות", "dueAt": "2030-01-01T07:00:00.000Z", "quoteId": q["id"]},
    )
    assert person.status_code == 201 and person.json()["task"]["autoKind"] is None
    res = await req(
        client,
        "POST",
        business_url(t["id"], f"/quotes/{q['id']}/status"),
        t["owner"]["token"],
        {"status": "REJECTED"},
    )
    assert res.status_code == 200
    tasks = {tk.title: tk for tk in await _tasks(db, quote_id=uuid.UUID(q["id"]))}
    auto = tasks[f"לחזור לגבי הצעה #{q['number']}"]
    assert auto.status == models.TaskStatus.DONE and auto.completed_at is not None
    assert tasks["לשלוח דוגמאות"].status == models.TaskStatus.OPEN
    done = (
        await db.execute(
            select(models.Activity).where(
                models.Activity.type == "task.completed", models.Activity.lead_id == uuid.UUID(lead["id"])
            )
        )
    ).scalar_one()
    assert done.actor_id is None and done.data["auto"] is True

    # The customer's link: a fresh quote, sent, accepted on its public page.
    q2 = await _quote(client, t, lead["id"])
    sent = await _send(client, t, q2["id"])
    token = sent["publicUrl"].rsplit("/", 1)[1]
    res = await client.post(
        f"/api/v1/public/quotes/{token}/decision", json={"decision": "accept"}, headers=HEADERS
    )
    assert res.status_code == 200
    [auto2] = [tk for tk in await _tasks(db, quote_id=uuid.UUID(q2["id"])) if tk.auto_kind]
    assert auto2.status == models.TaskStatus.DONE


async def test_switch_off_creates_nothing_but_closing_still_happens_and_a_done_follow_up_is_recreated(
    client, db
):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    await _switch(client, t, quote=False)
    q2 = await _quote(client, t, lead["id"])
    await _send(client, t, q2["id"])
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert task.quote_id == uuid.UUID(q["id"])  # not re-pointed while off
    await req(
        client,
        "POST",
        business_url(t["id"], f"/quotes/{q['id']}/status"),
        t["owner"]["token"],
        {"status": "ACCEPTED"},
    )
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert task.status == models.TaskStatus.DONE

    # On again: a later send creates a new one (no catch-up for the send made while off).
    await _switch(client, t, quote=True)
    assert len(await _tasks(db, lead_id=uuid.UUID(lead["id"]))) == 1
    await _send(client, t, q2["id"])
    tasks = await _tasks(db, lead_id=uuid.UUID(lead["id"]), status=models.TaskStatus.OPEN)
    assert len(tasks) == 1 and tasks[0].quote_id == uuid.UUID(q2["id"])


async def test_a_quote_sent_on_thursday_is_followed_up_on_sunday(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    quote = (await db.execute(select(models.Quote).where(models.Quote.id == uuid.UUID(q["id"])))).scalar_one()
    quote.sent_at = d("2030-01-03T10:00:00Z")  # Thursday 12:00 in Israel
    await task_auto.on_quote_sent(db, quote, uuid.UUID(t["owner"]["user_id"]))
    await db.commit()
    [task] = await _tasks(db, lead_id=uuid.UUID(lead["id"]))
    assert iso(task.due_at) == "2030-01-06T07:00:00.000Z"  # Sunday 09:00


async def test_a_lead_owner_change_moves_the_open_follow_up_only(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t, owner_id=t["manager"]["user_id"])
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    person = await make_task(db, t["id"], lead["id"], t["manager"]["user_id"], "שיחה", datetime.now(UTC))
    [auto] = [tk for tk in await _tasks(db, lead_id=uuid.UUID(lead["id"])) if tk.auto_kind]
    due_before = auto.due_at
    await _switch(client, t, quote=False)  # runs even with the switch off
    res = await req(
        client,
        "PATCH",
        business_url(t["id"], f"/leads/{lead['id']}"),
        t["owner"]["token"],
        {"ownerId": t["employee"]["user_id"]},
    )
    assert res.status_code == 200
    tasks = {tk.id: tk for tk in await _tasks(db, lead_id=uuid.UUID(lead["id"]))}
    assert str(tasks[auto.id].assignee_id) == t["employee"]["user_id"] and tasks[auto.id].due_at == due_before
    assert str(tasks[person.id].assignee_id) == t["manager"]["user_id"]
    # Unassigned → unchanged.
    await req(
        client, "PATCH", business_url(t["id"], f"/leads/{lead['id']}"), t["owner"]["token"], {"ownerId": None}
    )
    [auto] = [tk for tk in await _tasks(db, lead_id=uuid.UUID(lead["id"])) if tk.auto_kind]
    assert str(auto.assignee_id) == t["employee"]["user_id"]


async def test_deleting_a_lead_removes_its_automatic_tasks_and_keeps_a_persons(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    person = await req(
        client,
        "POST",
        business_url(t["id"], "/tasks"),
        t["owner"]["token"],
        {"title": "לחזור", "dueAt": "2030-01-01T07:00:00.000Z", "quoteId": q["id"]},
    )
    assert person.status_code == 201
    res = await req(client, "DELETE", business_url(t["id"], f"/leads/{lead['id']}"), t["owner"]["token"])
    assert res.status_code == 204
    left = await _tasks(db, business_id=uuid.UUID(t["id"]))
    assert len(left) == 1 and left[0].title == "לחזור"
    assert left[0].lead_id is None and left[0].quote_id is None and left[0].auto_kind is None


async def test_the_automatic_reminder_email_is_sent_once(client, db, app, email):
    t = await _team(client, db)
    lead = await _lead(client, t)
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    await db.execute(update(models.Task).values(due_at=datetime.now(UTC) - timedelta(minutes=5)))
    await db.commit()
    email.clear()
    svc = TaskService(db)
    assert await svc.send_due_reminders(email, app.state.settings) == 1
    assert await svc.send_due_reminders(email, app.state.settings) == 0
    assert len(email.sent) == 1 and f"#{q['number']}" in email.sent[0].text


# =========================================================================== appointment confirm


def at(day: int, h: int, m: int = 0) -> str:
    """January 2030 (6th = Sunday), in UTC."""
    return datetime(2030, 1, day, h, m, tzinfo=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def _book(client, t, body, token=None):
    res = await req(
        client, "POST", business_url(t["id"], "/appointments"), token or t["owner"]["token"], body
    )
    assert res.status_code == 201, res.text
    return res.json()["appointment"]


async def _patch_appt(client, t, aid, body):
    res = await req(client, "PATCH", business_url(t["id"], f"/appointments/{aid}"), t["owner"]["token"], body)
    assert res.status_code == 200, res.text
    return res.json()["appointment"]


CUSTOMER = {"customer": {"name": "דנה כהן", "phone": "052-7654321"}}


async def test_team_booking_creates_a_confirm_task_with_weekend_rules(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    # Sunday 11:00 Israel: the day before is Saturday → Sunday 09:00 (still before it).
    a = await _book(
        client, t, {"startsAt": at(6, 9), "leadId": lead["id"], "staffId": t["employee"]["user_id"]}
    )
    [task] = await _tasks(db, appointment_id=uuid.UUID(a["id"]))
    assert task.auto_kind == "appointment_confirm" and task.title == "לאשר את הפגישה" and task.remind is True
    assert iso(task.due_at) == "2030-01-06T07:00:00.000Z" and task.lead_id == uuid.UUID(lead["id"])
    assert str(task.assignee_id) == t["employee"]["user_id"] and task.created_by_id is None
    # Saturday → Thursday 09:00. Without a lead or staff: the first active owner.
    b = await _book(client, t, {"startsAt": at(5, 16), **CUSTOMER, "staffId": None})
    [task] = await _tasks(db, appointment_id=uuid.UUID(b["id"]))
    assert iso(task.due_at) == "2030-01-03T07:00:00.000Z" and task.lead_id is None
    assert str(task.assignee_id) == t["owner"]["user_id"]
    listed = (
        await req(
            client, "GET", business_url(t["id"], f"/tasks?appointmentId={b['id']}"), t["owner"]["token"]
        )
    ).json()
    assert listed["tasks"][0]["subject"] == {
        "kind": "appointment",
        "id": b["id"],
        "startsAt": b["startsAt"],
        "status": "REQUESTED",
    }


async def test_staff_not_active_falls_back_to_the_lead_owner(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t, owner_id=t["manager"]["user_id"])
    a = await _book(
        client, t, {"startsAt": at(8, 9), "leadId": lead["id"], "staffId": t["employee"]["user_id"]}
    )
    await db.execute(
        update(models.Task)
        .where(models.Task.appointment_id == uuid.UUID(a["id"]))
        .values(status=models.TaskStatus.DONE)
    )
    await db.execute(
        update(models.Membership)
        .where(models.Membership.user_id == uuid.UUID(t["employee"]["user_id"]))
        .values(status=models.MembershipStatus.DISABLED)
    )
    await db.commit()
    appt = (
        await db.execute(select(models.Appointment).where(models.Appointment.id == uuid.UUID(a["id"])))
    ).scalar_one()
    assert await task_auto.confirm_assignee(db, appt) == uuid.UUID(t["manager"]["user_id"])


async def test_no_confirm_task_for_today_or_with_the_switch_off(client, db):
    t = await _team(client, db)
    earlier = (
        (datetime.now(UTC) - timedelta(hours=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )
    a = await _book(client, t, {"startsAt": earlier, **CUSTOMER})
    assert await _tasks(db, appointment_id=uuid.UUID(a["id"])) == []
    await _switch(client, t, appointment=False)
    b = await _book(client, t, {"startsAt": at(8, 9), **CUSTOMER})
    assert await _tasks(db, appointment_id=uuid.UUID(b["id"])) == []


async def test_reschedule_moves_staff_change_hands_over_and_end_states_close(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    a = await _book(client, t, {"startsAt": at(8, 9), "leadId": lead["id"], "staffId": t["owner"]["user_id"]})
    [task] = await _tasks(db, appointment_id=uuid.UUID(a["id"]))
    assert iso(task.due_at) == "2030-01-07T07:00:00.000Z"  # Monday 09:00 for Tuesday
    await db.execute(update(models.Task).values(reminder_sent_at=datetime.now(UTC)))
    await db.commit()
    await _patch_appt(client, t, a["id"], {"startsAt": at(10, 9)})  # Thursday
    [task] = await _tasks(db, appointment_id=uuid.UUID(a["id"]))
    assert iso(task.due_at) == "2030-01-09T07:00:00.000Z" and task.reminder_sent_at is None
    await _patch_appt(client, t, a["id"], {"staffId": t["employee"]["user_id"]})
    [task] = await _tasks(db, appointment_id=uuid.UUID(a["id"]))
    assert str(task.assignee_id) == t["employee"]["user_id"]
    # Rescheduled to the past/today → due now, still open.
    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    await _patch_appt(client, t, a["id"], {"startsAt": past})
    [task] = await _tasks(db, appointment_id=uuid.UUID(a["id"]))
    assert (
        task.status == models.TaskStatus.OPEN and abs((task.due_at - datetime.now(UTC)).total_seconds()) < 60
    )

    for status in ("CANCELLED", "COMPLETED", "NO_SHOW"):
        b = await _book(client, t, {"startsAt": at(15, 9), **CUSTOMER, "staffId": t["owner"]["user_id"]})
        await _patch_appt(client, t, b["id"], {"status": status})
        [task] = await _tasks(db, appointment_id=uuid.UUID(b["id"]))
        assert task.status == models.TaskStatus.DONE, status
        if status == "CANCELLED":
            await _patch_appt(client, t, b["id"], {"status": "CONFIRMED"})
            [task] = await _tasks(db, appointment_id=uuid.UUID(b["id"]))
            assert task.status == models.TaskStatus.DONE  # never reopened
        await db.execute(
            update(models.Appointment)
            .where(models.Appointment.id == uuid.UUID(b["id"]))
            .values(status=models.AppointmentStatus.CANCELLED)
        )
        await db.commit()


async def _wa_setup(client, db):
    t = await _team(client, db)
    lead = await _lead(client, t)
    return t, lead, uuid.UUID(t["id"]), uuid.UUID(lead["id"]), uuid.UUID(lead["contact"]["id"])


async def test_customer_bookings_make_one_task_the_notice_is_the_confirm_task(client, db):
    t, lead, bid, lid, cid = await _wa_setup(client, db)
    staff = uuid.UUID(t["employee"]["user_id"])
    svc = AppointmentService(db)
    # WhatsApp booking with auto-confirm, next Tuesday: one task, due Monday 09:00 with a reminder.
    confirmed = await svc.book_from_whatsapp(bid, cid, lid, None, "תספורת", staff, d(at(8, 9)), 30, True)
    [task] = await _tasks(db, appointment_id=confirmed)
    assert task.auto_kind == "appointment_confirm" and task.title.startswith(
        "לאשר את הפגישה: רון לוי · תספורת · "
    )
    assert (
        iso(task.due_at) == "2030-01-07T07:00:00.000Z" and task.remind is True and task.assignee_id == staff
    )
    # REQUESTED (approval needed): due now, no reminder, D-152's note.
    requested = await svc.book_from_whatsapp(bid, cid, lid, None, "צבע", staff, d(at(9, 9)), 30, False)
    [task] = await _tasks(db, appointment_id=requested)
    assert task.auto_kind == "appointment_confirm" and task.remind is False
    assert abs((task.due_at - datetime.now(UTC)).total_seconds()) < 60
    assert task.notes == "מחכה לאישור שלכם בעמוד הפגישות."
    # Website request and event request: one task each, linked.
    await svc.request_from_website(bid, lid, cid, None, d(at(10, 9)))
    event = await svc.request_event_from_whatsapp(
        bid, cid, lid, None, d(at(11, 17)), d(at(11, 22)), "x", "חתונה"
    )
    [task] = await _tasks(db, appointment_id=event)
    assert task.auto_kind == "appointment_confirm" and task.title.startswith(
        "לאשר את הפגישה: רון לוי · חתונה · "
    )
    assert len(await _tasks(db, business_id=bid)) == 4
    assert all(tk.appointment_id for tk in await _tasks(db, business_id=bid))

    # The call-back slot gets no task.
    cb = await svc.call_back_from_whatsapp(bid, cid, lid, staff, d(at(14, 9)), "שיחה חוזרת")
    assert await _tasks(db, appointment_id=cb) == []

    # Same-day confirmed booking: the notice, due now, no reminder.
    soon = datetime.now(UTC) - timedelta(minutes=30)
    today = await svc.book_from_whatsapp(bid, cid, lid, None, "תספורת", staff, soon, 15, True)
    [task] = await _tasks(db, appointment_id=today)
    assert task.auto_kind == "appointment_confirm" and task.remind is False
    assert abs((task.due_at - datetime.now(UTC)).total_seconds()) < 60

    # WhatsApp cancel: the confirm task closes; the cancel notice is linked and plain.
    assert await svc.cancel_from_whatsapp(bid, confirmed, cid)
    tasks = await _tasks(db, appointment_id=confirmed)
    by_kind = {tk.auto_kind: tk for tk in tasks}
    assert by_kind["appointment_confirm"].status == models.TaskStatus.DONE
    assert by_kind[None].title.startswith("פגישה בוטלה: ") and by_kind[None].status == models.TaskStatus.OPEN


async def test_customer_bookings_with_the_switch_off_keep_the_plain_linked_notice(client, db):
    t, lead, bid, lid, cid = await _wa_setup(client, db)
    await _switch(client, t, appointment=False)
    staff = uuid.UUID(t["employee"]["user_id"])
    appt = await AppointmentService(db).book_from_whatsapp(
        bid, cid, lid, None, "תספורת", staff, d(at(8, 9)), 30, True
    )
    [task] = await _tasks(db, appointment_id=appt)
    assert task.auto_kind is None and task.title.startswith("פגישה חדשה: רון לוי · ")
    assert task.remind is False and abs((task.due_at - datetime.now(UTC)).total_seconds()) < 60
    # A plain notice is never closed by the system.
    await AppointmentService(db).cancel_from_whatsapp(bid, appt, cid)
    notice = (
        await db.execute(
            select(models.Task).where(models.Task.id == task.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert notice.status == models.TaskStatus.OPEN


async def test_english_business_titles(client, db):
    t = await _team(client, db)
    await db.execute(
        update(models.Business).where(models.Business.id == uuid.UUID(t["id"])).values(language="en")
    )
    await db.commit()
    lead = await _lead(client, t)
    q = await _quote(client, t, lead["id"])
    await _send(client, t, q["id"])
    a = await _book(client, t, {"startsAt": at(8, 9), "leadId": lead["id"]})
    [follow] = await _tasks(db, quote_id=uuid.UUID(q["id"]))
    [confirm] = await _tasks(db, appointment_id=uuid.UUID(a["id"]))
    assert follow.title == f"Follow up on quote #{q['number']}" and confirm.title == "Confirm the appointment"


@pytest.mark.parametrize("kind", ["quote", "appointment"])
async def test_the_unique_index_keeps_one_open_automatic_task_per_subject(client, db, kind):
    t = await _team(client, db)
    lead = await _lead(client, t)
    if kind == "quote":
        q = await _quote(client, t, lead["id"])
        await _send(client, t, q["id"])
        values = {"quote_id": uuid.UUID(q["id"]), "auto_kind": "quote_followup"}
    else:
        a = await _book(client, t, {"startsAt": at(8, 9), "leadId": lead["id"]})
        values = {"appointment_id": uuid.UUID(a["id"]), "auto_kind": "appointment_confirm"}
    inserted = await task_auto._insert_auto(
        db,
        {
            "business_id": uuid.UUID(t["id"]),
            "title": "x",
            "due_at": datetime.now(UTC),
            "assignee_id": uuid.UUID(t["owner"]["user_id"]),
            "lead_id": uuid.UUID(lead["id"]),
            "remind": True,
            **values,
        },
    )
    await db.commit()
    assert inserted is False
    assert len(await _tasks(db, lead_id=uuid.UUID(lead["id"]))) == 1
