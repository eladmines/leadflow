"""Follow-up tasks (F10), ported from apps/api/src/modules/tasks/tasks.test.ts."""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.db import models
from app.modules.tasks.reminders import start_task_reminders, stop
from app.modules.tasks.service import TaskService
from tests.conftest import add_member, business_url, make_lead, new_user, owner_with_business, req


def in_hours(h: float) -> str:
    return (datetime.now(UTC) + timedelta(hours=h)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def tasks_url(bid, tail=""):
    return business_url(bid, f"/tasks{tail}")


async def _team(client, db, email):
    owner = await owner_with_business(client, "owner")
    bid = owner["business"]["id"]
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    email.clear()
    return owner, {"token": emp_token, "user_id": emp_id}, bid


async def _create(client, bid, token, body):
    return await req(client, "POST", tasks_url(bid), token, body)


async def test_create_defaults_to_the_creator_and_lists_open_tasks_by_due_time(client, db, email):
    owner, _, bid = await _team(client, db, email)
    later = await _create(client, bid, owner["token"], {"title": "לשלוח הצעת מחיר", "dueAt": in_hours(48)})
    assert later.status_code == 201
    task = later.json()["task"]
    assert task["title"] == "לשלוח הצעת מחיר" and task["status"] == "OPEN" and task["remind"] is True
    assert task["assignee"]["id"] == owner["user_id"] and task["lead"] is None
    await _create(client, bid, owner["token"], {"title": "להתקשר", "dueAt": in_hours(2)})

    bad = await _create(client, bid, owner["token"], {"title": " ", "dueAt": "tomorrow"})
    assert bad.status_code == 400
    assert {"title", "dueAt"} <= set(bad.json()["error"]["fields"])

    listing = (await req(client, "GET", tasks_url(bid), owner["token"])).json()["tasks"]
    assert [t["title"] for t in listing] == ["להתקשר", "לשלוח הצעת מחיר"]


async def test_a_task_linked_to_a_lead_lands_in_the_lead_history(client, db, email):
    owner, _, bid = await _team(client, db, email)
    lead = await make_lead(db, bid)
    created = await _create(
        client, bid, owner["token"], {"title": "לחזור ללקוח", "dueAt": in_hours(1), "leadId": lead["id"]}
    )
    task = created.json()["task"]
    assert task["lead"] == lead

    done = await req(client, "PATCH", tasks_url(bid, f"/{task['id']}"), owner["token"], {"status": "DONE"})
    assert done.json()["task"]["status"] == "DONE" and done.json()["task"]["completedAt"]
    reopened = await req(
        client, "PATCH", tasks_url(bid, f"/{task['id']}"), owner["token"], {"status": "OPEN"}
    )
    assert reopened.json()["task"]["completedAt"] is None

    types = [r[0] for r in await db.execute(select(models.Activity.type))]
    assert {"task.created", "task.completed"} <= set(types)
    linked = await req(client, "GET", f"{tasks_url(bid)}?leadId={lead['id']}", owner["token"])
    assert len(linked.json()["tasks"]) == 1


async def test_filters_overdue_and_mine(client, db, email):
    owner, emp, bid = await _team(client, db, email)
    await _create(client, bid, owner["token"], {"title": "באיחור", "dueAt": in_hours(-3)})
    await _create(
        client, bid, owner["token"], {"title": "של העובד", "dueAt": in_hours(5), "assigneeId": emp["user_id"]}
    )

    async def titles(qs):
        res = await req(client, "GET", f"{tasks_url(bid)}?{qs}", owner["token"])
        return [t["title"] for t in res.json()["tasks"]]

    assert await titles("due=overdue") == ["באיחור"]
    assert await titles("assigneeId=me") == ["באיחור"]
    assert await titles(f"assigneeId={emp['user_id']}") == ["של העובד"]


async def test_employees_see_and_change_only_their_own_tasks(client, db, email):
    owner, emp, bid = await _team(client, db, email)
    owner_task = (
        await _create(client, bid, owner["token"], {"title": "של הבעלים", "dueAt": in_hours(1)})
    ).json()["task"]
    emp_task = (
        await _create(
            client,
            bid,
            owner["token"],
            {"title": "של העובד", "dueAt": in_hours(1), "assigneeId": emp["user_id"]},
        )
    ).json()["task"]

    mine = (await req(client, "GET", tasks_url(bid), emp["token"])).json()["tasks"]
    assert [t["id"] for t in mine] == [emp_task["id"]]
    patch_other = await req(
        client, "PATCH", tasks_url(bid, f"/{owner_task['id']}"), emp["token"], {"status": "DONE"}
    )
    assert patch_other.status_code == 404
    assert (
        await req(client, "DELETE", tasks_url(bid, f"/{owner_task['id']}"), emp["token"])
    ).status_code == 404
    patch_own = await req(
        client, "PATCH", tasks_url(bid, f"/{emp_task['id']}"), emp["token"], {"status": "DONE"}
    )
    assert patch_own.status_code == 200

    forbidden = await _create(
        client, bid, emp["token"], {"title": "x", "dueAt": in_hours(1), "assigneeId": owner["user_id"]}
    )
    assert forbidden.status_code == 403
    owners_lead = await make_lead(db, bid, owner_id=owner["user_id"])
    linked = await _create(
        client, bid, emp["token"], {"title": "x", "dueAt": in_hours(1), "leadId": owners_lead["id"]}
    )
    assert linked.status_code == 400 and linked.json()["error"]["fields"]["leadId"]
    own = await _create(client, bid, emp["token"], {"title": "שלי", "dueAt": in_hours(1)})
    assert own.json()["task"]["assignee"]["id"] == emp["user_id"]


async def test_assignees_and_leads_from_outside_the_business_are_rejected(client, db, email):
    owner, _, bid = await _team(client, db, email)
    other = await owner_with_business(client, "other")
    foreign_lead = await make_lead(db, other["business"]["id"], phone="+972529998877")
    res = await _create(
        client, bid, owner["token"], {"title": "x", "dueAt": in_hours(1), "assigneeId": other["user_id"]}
    )
    assert res.status_code == 400
    res = await _create(
        client, bid, owner["token"], {"title": "x", "dueAt": in_hours(1), "leadId": foreign_lead["id"]}
    )
    assert res.status_code == 400


async def test_edit_title_notes_due_time_and_link_or_unlink_a_lead(client, db, email):
    owner, emp, bid = await _team(client, db, email)
    ron = await make_lead(db, bid)
    made = (await _create(client, bid, owner["token"], {"title": "להתקשר", "dueAt": in_hours(5)})).json()[
        "task"
    ]

    def patch(token, body, task_id=made["id"]):
        return req(client, "PATCH", tasks_url(bid, f"/{task_id}"), token, body)

    linked = await patch(
        owner["token"],
        {"title": "להתקשר לרון", "notes": "אחרי הצהריים", "dueAt": in_hours(30), "leadId": ron["id"]},
    )
    assert linked.status_code == 200
    t = linked.json()["task"]
    assert (t["title"], t["notes"], t["lead"]) == ("להתקשר לרון", "אחרי הצהריים", ron)

    assert (await patch(owner["token"], {"leadId": None})).json()["task"]["lead"] is None
    assert (await patch(owner["token"], {"notes": ""})).json()["task"]["notes"] is None

    other = await owner_with_business(client, "other-edit")
    foreign = await make_lead(db, other["business"]["id"], phone="+972529998811")
    assert (await patch(owner["token"], {"leadId": foreign["id"]})).status_code == 400
    emp_task = (await _create(client, bid, emp["token"], {"title": "שלי", "dueAt": in_hours(2)})).json()[
        "task"
    ]
    assert (await patch(emp["token"], {"leadId": ron["id"]}, emp_task["id"])).status_code == 400


# --------------------------------------------------------------------------- reminders


async def _send(app, db, email, now=None):
    return await TaskService(db).send_due_reminders(email, app.state.settings, now)


async def test_emails_the_assignee_once_when_due_and_skips_future_done_muted_and_stale(
    client, db, app, email
):
    owner, emp, bid = await _team(client, db, email)
    lead = await make_lead(db, bid)
    await _create(
        client,
        bid,
        owner["token"],
        {"title": "להתקשר לרון", "dueAt": in_hours(-0.1), "assigneeId": emp["user_id"], "leadId": lead["id"]},
    )
    await _create(client, bid, owner["token"], {"title": "עתידי", "dueAt": in_hours(3)})
    await _create(client, bid, owner["token"], {"title": "מושתק", "dueAt": in_hours(-0.1), "remind": False})
    await _create(client, bid, owner["token"], {"title": "ישן מאוד", "dueAt": in_hours(-48)})
    done = (await _create(client, bid, owner["token"], {"title": "הושלם", "dueAt": in_hours(-0.1)})).json()[
        "task"
    ]
    await req(client, "PATCH", tasks_url(bid, f"/{done['id']}"), owner["token"], {"status": "DONE"})

    assert await _send(app, db, email) == 1
    notes = (
        (await db.execute(select(models.Notification).where(models.Notification.type == "task.due")))
        .scalars()
        .all()
    )
    assert len(notes) == 1 and str(notes[0].user_id) == emp["user_id"]
    assert notes[0].data["title"] == "להתקשר לרון" and notes[0].data["leadId"] == lead["id"]
    assert len(email.sent) == 1
    mail = email.sent[0]
    assert mail.subject == "תזכורת: להתקשר לרון"
    assert "ליד: רון לוי" in mail.text and f"/b/{bid}/leads/{lead['id']}" in mail.text
    assert await _send(app, db, email) == 0  # once only


async def test_a_new_due_time_rearms_the_reminder_and_removed_members_get_none(client, db, app, email):
    owner, emp, bid = await _team(client, db, email)
    task = (
        await _create(
            client,
            bid,
            owner["token"],
            {"title": "שוב", "dueAt": in_hours(-0.1), "assigneeId": emp["user_id"]},
        )
    ).json()["task"]
    assert await _send(app, db, email) == 1
    await req(client, "PATCH", tasks_url(bid, f"/{task['id']}"), owner["token"], {"dueAt": in_hours(-0.05)})
    await db.execute(
        update(models.Membership).where(models.Membership.user_id == emp["user_id"]).values(status="DISABLED")
    )
    await db.commit()
    assert await _send(app, db, email) == 0
    await db.execute(
        update(models.Membership).where(models.Membership.user_id == emp["user_id"]).values(status="ACTIVE")
    )
    await db.commit()
    await req(client, "PATCH", tasks_url(bid, f"/{task['id']}"), owner["token"], {"dueAt": in_hours(-0.02)})
    assert await _send(app, db, email) == 1


async def test_the_due_time_is_shown_in_the_business_time_zone(client, db, app, email):
    owner, _, bid = await _team(client, db, email)
    await _create(client, bid, owner["token"], {"title": "בדיקת שעה", "dueAt": "2026-10-27T08:00:00.000Z"})
    await _send(app, db, email, datetime(2026, 10, 27, 8, 1, tzinfo=UTC))
    text = email.sent[0].text
    assert "10:00" in text  # Israel is UTC+2 on this date
    assert "יום שלישי, 27 באוקטובר 2026" in text


async def test_english_businesses_get_english_reminders(client, db, app, email):
    owner, _, bid = await _team(client, db, email)
    await req(client, "PATCH", business_url(bid), owner["token"], {"language": "en"})
    await _create(client, bid, owner["token"], {"title": "Call back", "dueAt": "2026-10-27T08:00:00.000Z"})
    await _send(app, db, email, datetime(2026, 10, 27, 8, 1, tzinfo=UTC))
    mail = email.sent[0]
    assert mail.subject == "Reminder: Call back" and "Tuesday 27 October 2026 at 10:00" in mail.text


async def test_the_reminder_job_starts_after_the_app_is_ready_and_stops_cleanly(app):
    job = start_task_reminders(app, 10)
    assert not job.done()
    await asyncio.sleep(0)
    await stop(job)
    assert job.cancelled() or job.done()


# =========================================================================== F35: task subjects


async def _subjects(client, db, email):
    """A team with a lead (owned by the employee) that has a quote and an appointment, plus a
    second lead (the owner's) with its own quote."""
    from tests.conftest import make_quote

    owner, emp, bid = await _team(client, db, email)
    lead = await make_lead(db, bid, owner_id=emp["user_id"])
    other = await make_lead(db, bid, owner_id=owner["user_id"], name="שירה", phone="+972529998877")
    quote = await make_quote(db, bid, lead["id"], "SENT", 10000)
    other_quote = await make_quote(db, bid, other["id"], "DRAFT", 5000)
    appt = (
        await req(
            client,
            "POST",
            business_url(bid, "/appointments"),
            owner["token"],
            {"startsAt": "2030-01-08T09:00:00.000Z", "leadId": lead["id"], "staffId": owner["user_id"]},
        )
    ).json()["appointment"]
    return owner, emp, bid, lead, other, str(quote.id), str(other_quote.id), appt


def _fields(res):
    assert res.status_code == 400, res.text
    assert "Traceback" not in res.text
    return res.json()["error"]["fields"]


async def test_link_a_task_to_a_quote_or_an_appointment_and_the_lead_defaults(client, db, email):
    owner, _, bid, lead, _, qid, _, appt = await _subjects(client, db, email)
    by_quote = await _create(
        client, bid, owner["token"], {"title": "לברר", "dueAt": in_hours(5), "quoteId": qid}
    )
    assert by_quote.status_code == 201
    t = by_quote.json()["task"]
    assert t["lead"]["id"] == lead["id"] and t["autoKind"] is None
    assert t["subject"]["kind"] == "quote" and t["subject"]["id"] == qid and t["subject"]["status"] == "SENT"
    by_appt = await _create(
        client,
        bid,
        owner["token"],
        {"title": "להכין", "dueAt": in_hours(5), "appointmentId": appt["id"], "leadId": lead["id"]},
    )
    assert by_appt.status_code == 201
    assert by_appt.json()["task"]["subject"] == {
        "kind": "appointment",
        "id": appt["id"],
        "startsAt": appt["startsAt"],
        "status": "CONFIRMED",
    }
    both = await _create(
        client,
        bid,
        owner["token"],
        {"title": "x", "dueAt": in_hours(5), "quoteId": qid, "appointmentId": appt["id"]},
    )
    assert _fields(both) == {"appointmentId": "אפשר לקשר משימה להצעה או לתור, לא לשניהם"}
    plain = (await _create(client, bid, owner["token"], {"title": "רגילה", "dueAt": in_hours(5)})).json()[
        "task"
    ]
    assert plain["subject"] is None and plain["autoKind"] is None


async def test_a_lead_other_than_the_subjects_is_refused(client, db, email):
    owner, _, bid, _, other, qid, _, appt = await _subjects(client, db, email)
    res = await _create(
        client,
        bid,
        owner["token"],
        {"title": "x", "dueAt": in_hours(5), "quoteId": qid, "leadId": other["id"]},
    )
    assert _fields(res) == {"leadId": "ההצעה או התור שייכים לליד אחר. בטלו את הקישור או בחרו את הליד שלהם."}
    # An appointment without a lead + a lead on the task: same error.
    no_lead = (
        await req(
            client,
            "POST",
            business_url(bid, "/appointments"),
            owner["token"],
            {"startsAt": "2030-01-09T09:00:00.000Z", "customer": {"name": "דנה", "phone": "052-1234567"}},
        )
    ).json()["appointment"]
    res = await _create(
        client,
        bid,
        owner["token"],
        {"title": "x", "dueAt": in_hours(5), "appointmentId": no_lead["id"], "leadId": other["id"]},
    )
    assert "leadId" in _fields(res)
    ok = await _create(
        client, bid, owner["token"], {"title": "x", "dueAt": in_hours(5), "appointmentId": no_lead["id"]}
    )
    assert ok.status_code == 201 and ok.json()["task"]["lead"] is None


async def test_unknown_other_business_and_invisible_subjects_are_refused_alike(client, db, email):
    owner, emp, bid, lead, _, qid, other_qid, appt = await _subjects(client, db, email)
    import uuid as _uuid

    from tests.conftest import make_quote

    stranger = await owner_with_business(client, "stranger")
    sbid = stranger["business"]["id"]
    foreign_lead = await make_lead(db, sbid)
    foreign_quote = await make_quote(db, sbid, foreign_lead["id"], "SENT", 100)
    for quote_id in (str(_uuid.uuid4()), str(foreign_quote.id)):
        res = await _create(
            client, bid, owner["token"], {"title": "x", "dueAt": in_hours(1), "quoteId": quote_id}
        )
        assert _fields(res) == {"quoteId": "ההצעה שנבחרה אינה קיימת"}
    res = await _create(
        client, bid, owner["token"], {"title": "x", "dueAt": in_hours(1), "appointmentId": str(_uuid.uuid4())}
    )
    assert _fields(res) == {"appointmentId": "התור שנבחר אינו קיים"}

    # The employee: a quote on someone else's lead, an appointment booked on the owner → refused.
    res = await _create(client, bid, emp["token"], {"title": "x", "dueAt": in_hours(1), "quoteId": other_qid})
    assert _fields(res) == {"quoteId": "ההצעה שנבחרה אינה קיימת"}
    res = await _create(
        client, bid, emp["token"], {"title": "x", "dueAt": in_hours(1), "appointmentId": appt["id"]}
    )
    assert _fields(res) == {"appointmentId": "התור שנבחר אינו קיים"}
    # …but a quote on their own lead is fine.
    res = await _create(client, bid, emp["token"], {"title": "x", "dueAt": in_hours(1), "quoteId": qid})
    assert res.status_code == 201 and res.json()["task"]["lead"]["id"] == lead["id"]

    # PATCH: the same rule.
    tid = res.json()["task"]["id"]
    res = await req(client, "PATCH", tasks_url(bid, f"/{tid}"), emp["token"], {"quoteId": other_qid})
    assert _fields(res) == {"quoteId": "ההצעה שנבחרה אינה קיימת"}


async def test_a_direct_cross_business_link_fails_at_commit(client, db, email):
    import uuid as _uuid

    import pytest
    from sqlalchemy.exc import IntegrityError

    from tests.conftest import make_quote, make_task

    owner, _, bid, _, _, _, _, _ = await _subjects(client, db, email)
    stranger = await owner_with_business(client, "stranger")
    sbid = stranger["business"]["id"]
    foreign_quote = await make_quote(db, sbid, (await make_lead(db, sbid))["id"], "SENT", 100)
    task_id = (await make_task(db, bid, None, owner["user_id"], "x", datetime.now(UTC))).id
    foreign_id = foreign_quote.id
    await db.execute(update(models.Task).where(models.Task.id == task_id).values(quote_id=foreign_id))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    assert (
        await db.execute(select(models.Task.quote_id).where(models.Task.id == task_id))
    ).scalar_one() is None
    assert _uuid.UUID(bid) != _uuid.UUID(sbid)


async def test_patch_swaps_unlinks_and_a_changed_subject_makes_an_automatic_task_a_persons(client, db, email):
    owner, _, bid, lead, other, qid, other_qid, appt = await _subjects(client, db, email)
    tid = (
        await _create(client, bid, owner["token"], {"title": "x", "dueAt": in_hours(1), "quoteId": qid})
    ).json()["task"]["id"]
    url = tasks_url(bid, f"/{tid}")
    swapped = (await req(client, "PATCH", url, owner["token"], {"appointmentId": appt["id"]})).json()["task"]
    assert swapped["subject"]["kind"] == "appointment" and swapped["lead"]["id"] == lead["id"]
    row = (await db.execute(select(models.Task).where(models.Task.id == uuid_of(tid)))).scalar_one()
    assert row.quote_id is None and row.appointment_id is not None

    # Changing the lead while the subject stays → refused; with the unlink in the same request → fine.
    res = await req(client, "PATCH", url, owner["token"], {"leadId": other["id"]})
    assert "leadId" in _fields(res)
    moved = await req(client, "PATCH", url, owner["token"], {"leadId": other["id"], "appointmentId": None})
    assert moved.status_code == 200
    assert moved.json()["task"]["subject"] is None and moved.json()["task"]["lead"]["id"] == other["id"]
    # Setting a subject takes its lead.
    relinked = (await req(client, "PATCH", url, owner["token"], {"quoteId": other_qid})).json()["task"]
    assert relinked["subject"]["id"] == other_qid and relinked["lead"]["id"] == other["id"]
    unlinked = (await req(client, "PATCH", url, owner["token"], {"quoteId": None})).json()["task"]
    assert unlinked["subject"] is None and unlinked["lead"]["id"] == other["id"]

    # An automatic task whose subject a person changes becomes a person's task.
    await db.execute(
        update(models.Task)
        .where(models.Task.id == uuid_of(tid))
        .values(quote_id=uuid_of(qid), lead_id=uuid_of(lead["id"]), auto_kind="quote_followup")
    )
    await db.commit()
    same = (await req(client, "PATCH", url, owner["token"], {"title": "שם חדש"})).json()["task"]
    assert same["autoKind"] == "quote_followup"
    changed = (await req(client, "PATCH", url, owner["token"], {"appointmentId": appt["id"]})).json()["task"]
    assert changed["autoKind"] is None


async def test_reopening_an_old_follow_up_while_a_newer_one_is_open_makes_it_a_persons(client, db, email):
    from tests.conftest import make_quote

    owner, _, bid, lead, _, qid, _, _ = await _subjects(client, db, email)
    old = await make_quote(db, bid, lead["id"], "SENT", 100)
    now = datetime.now(UTC)
    for quote_id, status in ((old.id, "DONE"), (uuid_of(qid), "OPEN")):
        db.add(
            models.Task(
                id=__import__("uuid").uuid4(),
                business_id=uuid_of(bid),
                title="מעקב",
                due_at=now,
                status=models.TaskStatus(status),
                assignee_id=uuid_of(owner["user_id"]),
                lead_id=uuid_of(lead["id"]),
                quote_id=quote_id,
                auto_kind="quote_followup",
                remind=True,
                completed_at=now if status == "DONE" else None,
                created_at=now,
                updated_at=now,
            )
        )
    await db.commit()
    done = (
        await db.execute(select(models.Task).where(models.Task.status == models.TaskStatus.DONE))
    ).scalar_one()
    res = await req(client, "PATCH", tasks_url(bid, f"/{done.id}"), owner["token"], {"status": "OPEN"})
    assert (
        res.status_code == 200
        and res.json()["task"]["autoKind"] is None
        and res.json()["task"]["status"] == "OPEN"
    )


async def test_list_filters_by_subject_and_employees_see_only_their_own(client, db, email):
    owner, emp, bid, _, _, qid, _, appt = await _subjects(client, db, email)
    await _create(client, bid, owner["token"], {"title": "של הבעלים", "dueAt": in_hours(1), "quoteId": qid})
    await _create(
        client,
        bid,
        owner["token"],
        {"title": "של העובד", "dueAt": in_hours(2), "quoteId": qid, "assigneeId": emp["user_id"]},
    )
    await _create(
        client, bid, owner["token"], {"title": "על התור", "dueAt": in_hours(3), "appointmentId": appt["id"]}
    )

    def titles(res):
        assert res.status_code == 200, res.text
        return sorted(t["title"] for t in res.json()["tasks"])

    assert titles(await req(client, "GET", tasks_url(bid) + f"?quoteId={qid}", owner["token"])) == [
        "של הבעלים",
        "של העובד",
    ]
    assert titles(await req(client, "GET", tasks_url(bid) + f"?quoteId={qid}", emp["token"])) == ["של העובד"]
    by_appt = titles(
        await req(client, "GET", tasks_url(bid) + f"?appointmentId={appt['id']}", owner["token"])
    )
    assert "על התור" in by_appt and all(t in ("על התור", "לאשר את התור") for t in by_appt)
    assert (
        titles(await req(client, "GET", tasks_url(bid) + f"?appointmentId={appt['id']}", emp["token"])) == []
    )
    bad = await req(client, "GET", tasks_url(bid) + "?quoteId=nope", owner["token"])
    assert bad.status_code == 400 and "quoteId" in bad.json()["error"]["fields"]


async def test_a_deleted_draft_quote_leaves_a_persons_task_without_a_subject(client, db, email):
    owner, _, bid, _, other, _, other_qid, _ = await _subjects(client, db, email)
    tid = (
        await _create(client, bid, owner["token"], {"title": "x", "dueAt": in_hours(1), "quoteId": other_qid})
    ).json()["task"]["id"]
    assert (
        await req(client, "DELETE", business_url(bid, f"/quotes/{other_qid}"), owner["token"])
    ).status_code == 204
    task = (await req(client, "GET", tasks_url(bid), owner["token"])).json()["tasks"]
    [row] = [t for t in task if t["id"] == tid]
    assert row["subject"] is None and row["lead"]["id"] == other["id"]


def uuid_of(v):
    import uuid as _uuid

    return _uuid.UUID(str(v))
