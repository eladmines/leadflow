"""Businesses (F02), ported from apps/api/src/modules/businesses/businesses.test.ts."""

import re

from sqlalchemy import func, select

from app.db import models
from tests.conftest import (
    BUSINESSES,
    add_member,
    business_url,
    create_business,
    new_user,
    owner_with_business,
    req,
)

HEBREW = re.compile("[֐-׿]")
DEFAULT_HOURS = {
    d: {"open": True, "from": "09:00", "to": "18:00"} for d in ("sun", "mon", "tue", "wed", "thu")
} | {
    "fri": {"open": True, "from": "09:00", "to": "13:00"},
    "sat": {"open": False, "from": "09:00", "to": "18:00"},
}


# --------------------------------------------------------------------------- create and list


async def test_create_starts_onboarding_at_step_2_with_the_caller_as_owner_and_audits(client, db):
    token, user_id = await new_user(client)
    res = await req(client, "POST", BUSINESSES, token, {"name": "  מספרת שירן ", "industry": "beauty"})
    assert res.status_code == 201
    business = res.json()["business"]
    assert (
        business
        | {
            "name": "מספרת שירן",
            "industry": "beauty",
            "status": "ONBOARDING",
            "onboardingStep": 2,
            "role": "OWNER",
            "timezone": "Asia/Jerusalem",
            "phone": None,
            "serviceAreas": [],
            "openingHours": None,
        }
        == business
    )
    audit = (
        await db.execute(select(models.AuditLog).where(models.AuditLog.action == "business.created"))
    ).scalar_one()
    assert str(audit.business_id) == business["id"] and str(audit.actor_user_id) == user_id
    assert audit.metadata_ == {"industry": "beauty"}


async def test_create_ignores_client_supplied_id_status_and_role(client):
    token, _ = await new_user(client)
    forged = "00000000-0000-4000-8000-000000000000"
    res = await req(
        client,
        "POST",
        BUSINESSES,
        token,
        {"name": "מוסך הצפון", "industry": "garage", "id": forged, "status": "ACTIVE", "role": "EMPLOYEE"},
    )
    assert res.status_code == 201
    business = res.json()["business"]
    assert business["status"] == "ONBOARDING" and business["role"] == "OWNER" and business["id"] != forged


async def test_create_validates_name_and_industry_in_hebrew(client):
    token, _ = await new_user(client)
    res = await req(client, "POST", BUSINESSES, token, {"name": "א", "industry": "bank"})
    assert res.status_code == 400
    fields = res.json()["error"]["fields"]
    assert HEBREW.search(fields["name"]) and HEBREW.search(fields["industry"])


async def test_business_routes_require_sign_in(client):
    assert (await req(client, "GET", BUSINESSES)).status_code == 401
    assert (await req(client, "POST", BUSINESSES, None, {})).status_code == 401


async def test_list_returns_only_the_callers_businesses(client):
    a = await owner_with_business(client, "a")
    await owner_with_business(client, "b")
    res = await req(client, "GET", BUSINESSES, a["token"])
    assert res.status_code == 200
    assert [b["name"] for b in res.json()["businesses"]] == ["מספרת שירן"]
    assert res.json()["businesses"][0].keys() == {"id", "name", "status", "onboardingStep", "role"}


async def test_one_owned_business_per_user(client):
    a = await owner_with_business(client, "a")
    res = await req(client, "POST", BUSINESSES, a["token"], {"name": "סניף שני", "industry": "beauty"})
    assert res.status_code == 409


async def test_an_invited_member_can_still_create_their_own_business(client, db):
    owner = await owner_with_business(client, "owner")
    token, user_id = await new_user(client, "guest")
    await add_member(db, owner["business"]["id"], user_id, "EMPLOYEE")
    res = await req(client, "POST", BUSINESSES, token, {"name": "העסק שלי", "industry": "garage"})
    assert res.status_code == 201
    assert len((await req(client, "GET", BUSINESSES, token)).json()["businesses"]) == 2


# --------------------------------------------------------------------------- onboarding


async def test_wizard_steps_are_saved_and_resumable(client):
    o = await owner_with_business(client)
    url = business_url(o["business"]["id"])
    res = await req(
        client,
        "PATCH",
        url,
        o["token"],
        {"phone": "050-1234567", "address": "הרצל 10, חיפה", "onboardingStep": 3},
    )
    assert res.status_code == 200
    b = res.json()["business"]
    assert (b["phone"], b["address"], b["onboardingStep"]) == ("+972501234567", "הרצל 10, חיפה", 3)

    res = await req(
        client, "PATCH", url, o["token"], {"serviceAreas": ["חיפה", "יקנעם", "חיפה"], "onboardingStep": 4}
    )
    assert res.json()["business"]["serviceAreas"] == ["חיפה", "יקנעם"]

    again = (await req(client, "GET", url, o["token"])).json()["business"]
    assert again["onboardingStep"] == 4 and again["status"] == "ONBOARDING"


async def test_invalid_phone_and_invalid_opening_hours_are_rejected(client):
    o = await owner_with_business(client)
    url = business_url(o["business"]["id"])
    res = await req(client, "PATCH", url, o["token"], {"phone": "12345"})
    assert res.status_code == 400 and res.json()["error"]["fields"]["phone"]
    bad = DEFAULT_HOURS | {"sun": {"open": True, "from": "18:00", "to": "09:00"}}
    res = await req(client, "PATCH", url, o["token"], {"openingHours": bad})
    assert res.status_code == 400
    assert res.json()["error"]["fields"]["openingHours.sun.to"]


async def test_complete_needs_a_phone_then_activates_and_is_idempotent(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    complete = business_url(bid, "/onboarding/complete")

    res = await req(client, "POST", complete, o["token"])
    assert res.status_code == 400 and res.json()["error"]["fields"]["phone"]

    await req(
        client, "PATCH", business_url(bid), o["token"], {"phone": "03-1234567", "openingHours": DEFAULT_HOURS}
    )
    res = await req(client, "POST", complete, o["token"])
    assert res.status_code == 200
    b = res.json()["business"]
    assert b["status"] == "ACTIVE" and b["openingHours"] == DEFAULT_HOURS

    assert (await req(client, "POST", complete, o["token"])).status_code == 200
    done = await db.execute(
        select(func.count())
        .select_from(models.AuditLog)
        .where(models.AuditLog.action == "business.onboarding.completed")
    )
    assert done.scalar_one() == 1


async def test_onboarding_step_is_ignored_once_active_and_the_audit_has_field_names_only(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await req(client, "PATCH", business_url(bid), o["token"], {"phone": "050-1234567"})
    await req(client, "POST", business_url(bid, "/onboarding/complete"), o["token"])
    res = await req(
        client, "PATCH", business_url(bid), o["token"], {"onboardingStep": 1, "address": "הנביאים 5"}
    )
    assert res.json()["business"]["onboardingStep"] != 1
    audit = (
        (
            await db.execute(
                select(models.AuditLog)
                .where(models.AuditLog.action == "business.updated")
                .order_by(models.AuditLog.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    assert audit.metadata_ == {"fields": ["address"]}
    assert "הנביאים" not in str(audit.metadata_)


async def test_website_address_is_saved_validated_and_cleared(client):
    o = await owner_with_business(client)
    url = business_url(o["business"]["id"])
    res = await req(client, "PATCH", url, o["token"], {"websiteUrl": "www.shiran.co.il"})
    assert res.status_code == 200 and res.json()["business"]["websiteUrl"] == "https://www.shiran.co.il"
    res = await req(client, "PATCH", url, o["token"], {"websiteUrl": "javascript:alert(1)"})
    assert res.status_code == 400 and "כתובת האתר אינה תקינה" in res.json()["error"]["fields"]["websiteUrl"]
    res = await req(client, "PATCH", url, o["token"], {"websiteUrl": None})
    assert res.json()["business"]["websiteUrl"] is None


async def test_changing_the_website_forgets_what_was_read_about_the_old_domain(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await req(client, "PATCH", business_url(bid), o["token"], {"websiteUrl": "old.co.il"})
    from datetime import UTC, datetime

    business = (await db.execute(select(models.Business))).scalar_one()
    business.domain_check = "ok"
    business.domain_expires_at = datetime.now(UTC)
    business.domain_reminded_days = 30
    await db.commit()
    await req(client, "PATCH", business_url(bid), o["token"], {"websiteUrl": "new.co.il"})
    db.expire_all()
    business = (await db.execute(select(models.Business))).scalar_one()
    assert business.domain_check is None and business.domain_expires_at is None
    assert business.domain_reminded_days is None


async def test_a_business_id_in_the_body_cannot_redirect_a_write(client, db):
    a = await owner_with_business(client, "a")
    b = await owner_with_business(client, "b")
    res = await req(
        client,
        "PATCH",
        business_url(a["business"]["id"]),
        a["token"],
        {"businessId": b["business"]["id"], "name": "שם חדש"},
    )
    assert res.status_code == 200
    other = (
        await db.execute(select(models.Business.name).where(models.Business.id == b["business"]["id"]))
    ).scalar_one()
    assert other == "מספרת שירן"


async def test_update_changes_name_industry_language_and_ignores_status(client):
    o = await owner_with_business(client)
    res = await req(
        client,
        "PATCH",
        business_url(o["business"]["id"]),
        o["token"],
        {"name": "  סלון חדש ", "industry": "nails", "language": "en", "status": "ACTIVE"},
    )
    b = res.json()["business"]
    assert (b["name"], b["industry"], b["language"], b["status"]) == ("סלון חדש", "nails", "en", "ONBOARDING")


async def test_notification_preferences_belong_to_each_member(client, db):
    owner = await owner_with_business(client, "owner")
    emp_token, emp_id = await new_user(client, "emp")
    bid = owner["business"]["id"]
    await add_member(db, bid, emp_id, "EMPLOYEE")
    url = business_url(bid, "/me/notifications")
    assert (await req(client, "GET", url, emp_token)).json() == {"prefs": {"newLeadEmail": True}}
    res = await req(client, "PUT", url, emp_token, {"newLeadEmail": False})
    assert res.json() == {"prefs": {"newLeadEmail": False}}
    assert (await req(client, "GET", url, emp_token)).json()["prefs"]["newLeadEmail"] is False
    assert (await req(client, "GET", url, owner["token"])).json()["prefs"]["newLeadEmail"] is True


# --------------------------------------------------------------------------- roles


async def _team(client, db):
    owner = await owner_with_business(client, "owner")
    manager_token, manager_id = await new_user(client, "manager")
    employee_token, employee_id = await new_user(client, "employee")
    bid = owner["business"]["id"]
    await add_member(db, bid, manager_id, "MANAGER")
    await add_member(db, bid, employee_id, "EMPLOYEE")
    return owner["token"], manager_token, employee_token, bid


async def test_every_member_sees_the_business_with_their_own_role(client, db):
    owner, manager, employee, bid = await _team(client, db)
    for token, role in ((owner, "OWNER"), (manager, "MANAGER"), (employee, "EMPLOYEE")):
        res = await req(client, "GET", business_url(bid), token)
        assert res.status_code == 200 and res.json()["business"]["role"] == role


async def test_only_the_owner_can_update_or_complete_onboarding(client, db):
    _, manager, employee, bid = await _team(client, db)
    for token in (manager, employee):
        res = await req(client, "PATCH", business_url(bid), token, {"name": "xx"})
        assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"
        assert (
            await req(client, "POST", business_url(bid, "/onboarding/complete"), token)
        ).status_code == 403


async def test_owner_and_manager_list_members_employee_cannot_and_no_secrets(client, db):
    _, manager, employee, bid = await _team(client, db)
    res = await req(client, "GET", business_url(bid, "/members"), manager)
    assert res.status_code == 200
    assert [m["role"] for m in res.json()["members"]] == ["OWNER", "MANAGER", "EMPLOYEE"]
    assert not re.search(r"passwordHash|password_hash|\$argon2", res.text)
    assert (await req(client, "GET", business_url(bid, "/members"), employee)).status_code == 403


async def test_outsiders_get_404_not_403(client):
    a = await owner_with_business(client, "a")
    b = await owner_with_business(client, "b")
    res = await req(client, "GET", business_url(a["business"]["id"]), b["token"])
    assert res.status_code == 404
    assert (
        await req(client, "PATCH", business_url(a["business"]["id"]), b["token"], {"name": "hack"})
    ).status_code == 404


async def test_create_business_helper_matches_the_api(client):
    token, _ = await new_user(client)
    assert (await create_business(client, token))["role"] == "OWNER"
