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
