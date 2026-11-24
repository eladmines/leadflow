"""In-app notifications (D-097)."""

import uuid

from app.modules.notifications.service import MANAGERS, notify
from tests.conftest import add_member, business_url, new_user, owner_with_business, req


async def _setup(client, db):
    owner = await owner_with_business(client, "owner")
    bid = owner["business"]["id"]
    mgr_token, mgr_id = await new_user(client, "mgr")
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, mgr_id, "MANAGER")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    return owner, (mgr_token, mgr_id), (emp_token, emp_id), bid


async def test_notify_reaches_the_roles_and_users_asked_for_and_nobody_else(client, db):
    owner, (_, mgr_id), (_, emp_id), bid = await _setup(client, db)
    bus = uuid.UUID(bid)
    n = await notify(db, business_id=bus, type="lead.new", data={"leadId": "x"}, roles=MANAGERS)
    await db.commit()
    assert n == 2  # owner + manager
    n = await notify(
        db,
        business_id=bus,
        type="lead.new",
        data={},
        roles=MANAGERS,
        user_ids=[uuid.UUID(emp_id)],
        except_user_id=uuid.UUID(owner["user_id"]),
    )
    await db.commit()
    assert n == 2  # manager + employee, not the person who caused it
    # A user from another business is never notified, whatever ids are passed in.
    other = await owner_with_business(client, "other")
    assert (
        await notify(db, business_id=bus, type="lead.new", data={}, user_ids=[uuid.UUID(other["user_id"])])
        == 0
    )


async def test_each_member_sees_only_their_own_notifications_newest_first(client, db):
    owner, (mgr_token, mgr_id), (emp_token, emp_id), bid = await _setup(client, db)
    bus = uuid.UUID(bid)
    await notify(db, business_id=bus, type="lead.new", data={"n": 1}, roles=MANAGERS)
    await notify(db, business_id=bus, type="task.due", data={"n": 2}, user_ids=[uuid.UUID(mgr_id)])
    await db.commit()
    url = business_url(bid, "/notifications")
    mine = (await req(client, "GET", url, mgr_token)).json()
    assert mine["unreadCount"] == 2
    assert [n["data"]["n"] for n in mine["notifications"]] == [2, 1]
    assert (await req(client, "GET", url, emp_token)).json() == {"notifications": [], "unreadCount": 0}


async def test_mark_read_by_ids_or_all(client, db):
    owner, (mgr_token, mgr_id), _, bid = await _setup(client, db)
    bus = uuid.UUID(bid)
    for i in range(3):
        await notify(db, business_id=bus, type="lead.new", data={"n": i}, user_ids=[uuid.UUID(mgr_id)])
    await db.commit()
    url = business_url(bid, "/notifications")
    items = (await req(client, "GET", url, mgr_token)).json()["notifications"]
    res = await req(client, "POST", f"{url}/read", mgr_token, {"ids": [items[0]["id"]]})
    assert res.status_code == 204
    assert (await req(client, "GET", url, mgr_token)).json()["unreadCount"] == 2
    await req(client, "POST", f"{url}/read", mgr_token, {})
    after = (await req(client, "GET", url, mgr_token)).json()
    assert after["unreadCount"] == 0 and all(n["readAt"] for n in after["notifications"])


async def test_one_member_cannot_mark_anothers_notifications_read(client, db):
    owner, (mgr_token, mgr_id), (emp_token, _), bid = await _setup(client, db)
    await notify(db, business_id=uuid.UUID(bid), type="lead.new", data={}, user_ids=[uuid.UUID(mgr_id)])
    await db.commit()
    url = business_url(bid, "/notifications")
    note = (await req(client, "GET", url, mgr_token)).json()["notifications"][0]
    await req(client, "POST", f"{url}/read", emp_token, {"ids": [note["id"]]})
    assert (await req(client, "GET", url, mgr_token)).json()["unreadCount"] == 1


async def test_the_list_is_capped_at_30_and_hides_unknown_types(client, db):
    owner, (mgr_token, mgr_id), _, bid = await _setup(client, db)
    bus = uuid.UUID(bid)
    for i in range(35):
        await notify(db, business_id=bus, type="lead.new", data={"n": i}, user_ids=[uuid.UUID(mgr_id)])
    await notify(db, business_id=bus, type="retired.type", data={}, user_ids=[uuid.UUID(mgr_id)])
    await db.commit()
    body = (await req(client, "GET", business_url(bid, "/notifications"), mgr_token)).json()
    assert len(body["notifications"]) <= 30 and body["unreadCount"] == 36
    assert all(n["type"] != "retired.type" for n in body["notifications"])


async def test_notification_routes_need_membership(client, db):
    owner, *_, bid = await _setup(client, db)
    outsider, _ = await new_user(client, "out")
    assert (await req(client, "GET", business_url(bid, "/notifications"), outsider)).status_code == 404
    assert (await req(client, "GET", business_url(bid, "/notifications"))).status_code == 401
