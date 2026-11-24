"""Team invitations (F09), ported from apps/api/src/modules/team/team.test.ts."""

import logging

from sqlalchemy import func, select

from app.db import models
from tests.conftest import (
    business_url,
    last_email_token,
    new_user,
    owner_with_business,
    register_user,
    req,
)

PREVIEW = "/api/v1/invitations/preview"
ACCEPT = "/api/v1/invitations/accept"


def inv_url(bid, tail=""):
    return business_url(bid, f"/invitations{tail}")


def member_url(bid, uid):
    return business_url(bid, f"/members/{uid}")


async def invite(client, bid, token, email, role="EMPLOYEE"):
    return await req(client, "POST", inv_url(bid), token, {"email": email, "role": role})


async def test_invite_email_preview_accept_gives_a_member_with_the_role_and_verified_email(client, db, email):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    res = await invite(client, bid, o["token"], " Yossi@Example.com ")
    assert res.status_code == 201
    inv = res.json()["invitation"]
    assert inv["email"] == "yossi@example.com" and inv["role"] == "EMPLOYEE"

    mail = email.to("yossi@example.com")[-1]
    assert mail.subject == "הוזמנת להצטרף לצוות של מספרת שירן ב-SimpleCatch"
    assert "/invite?token=" in mail.text
    token = last_email_token(email, "yossi@example.com")

    preview = await req(client, "POST", PREVIEW, None, {"token": token})
    assert preview.json()["invite"] == {
        "status": "valid",
        "businessName": "מספרת שירן",
        "role": "EMPLOYEE",
        "email": "yossi@example.com",
        "invitedBy": inv["invitedBy"],
    }

    _, yossi_token, _ = await register_user(client, email="yossi@example.com", fullName="יוסי מזרחי")
    accepted = await req(client, "POST", ACCEPT, yossi_token, {"token": token})
    assert accepted.status_code == 200 and accepted.json() == {"businessId": bid}

    business = await req(client, "GET", business_url(bid), yossi_token)
    assert business.json()["business"]["role"] == "EMPLOYEE"
    verified = (
        await db.execute(
            select(models.User.email_verified_at).where(models.User.email == "yossi@example.com")
        )
    ).scalar_one()
    assert verified is not None
    assert (await req(client, "POST", PREVIEW, None, {"token": token})).json()["invite"]["status"] == "used"
    assert (await req(client, "POST", ACCEPT, yossi_token, {"token": token})).status_code == 400
    count = await db.execute(
        select(func.count())
        .select_from(models.AuditLog)
        .where(models.AuditLog.action.in_(["member.invited", "member.joined"]))
    )
    assert count.scalar_one() == 2


async def test_accept_needs_the_invited_account_and_a_session(client, email):
    o = await owner_with_business(client)
    await invite(client, o["business"]["id"], o["token"], "yossi@example.com")
    token = last_email_token(email, "yossi@example.com")
    other_token, _ = await new_user(client, "other")
    res = await req(client, "POST", ACCEPT, other_token, {"token": token})
    assert res.status_code == 403 and "כתובת אימייל אחרת" in res.json()["error"]["message"]
    assert (await req(client, "POST", ACCEPT, None, {"token": token})).status_code == 401
    assert (await req(client, "POST", PREVIEW, None, {"token": "A" * 43})).status_code == 404


async def test_reinvite_replaces_the_old_link_resend_issues_a_new_one_and_revoke_kills_it(client, email):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await invite(client, bid, o["token"], "yossi@example.com")
    first = last_email_token(email, "yossi@example.com")
    await invite(client, bid, o["token"], "yossi@example.com", "MANAGER")
    second = last_email_token(email, "yossi@example.com")
    assert (await req(client, "POST", PREVIEW, None, {"token": first})).json()["invite"][
        "status"
    ] == "revoked"

    listing = (await req(client, "GET", inv_url(bid), o["token"])).json()["invitations"]
    assert len(listing) == 1 and listing[0]["role"] == "MANAGER"

    await req(client, "POST", inv_url(bid, f"/{listing[0]['id']}/resend"), o["token"])
    third = last_email_token(email, "yossi@example.com")
    assert third != second
    assert (await req(client, "POST", PREVIEW, None, {"token": second})).status_code == 404

    assert (await req(client, "DELETE", inv_url(bid, f"/{listing[0]['id']}"), o["token"])).status_code == 204
    assert (await req(client, "POST", PREVIEW, None, {"token": third})).json()["invite"][
        "status"
    ] == "revoked"
    assert (await req(client, "GET", inv_url(bid), o["token"])).json()["invitations"] == []


async def test_inviting_an_existing_member_or_an_invalid_role_is_rejected(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    owner_email = (
        await db.execute(select(models.User.email).where(models.User.id == o["user_id"]))
    ).scalar_one()
    dup = await invite(client, bid, o["token"], owner_email)
    assert dup.status_code == 409 and dup.json()["error"]["fields"]["email"]
    assert (await invite(client, bid, o["token"], "x@example.com", "OWNER")).status_code == 400


async def _team_with_employee(client, email):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await invite(client, bid, o["token"], "emp@example.com")
    token = last_email_token(email, "emp@example.com")  # before sign-up sends its own email
    _, emp_token, emp = await register_user(client, email="emp@example.com")
    accepted = await req(client, "POST", ACCEPT, emp_token, {"token": token})
    assert accepted.status_code == 200
    return o, bid, emp_token, emp


async def test_only_the_owner_manages_the_team_and_the_owner_cannot_be_demoted_or_removed(client, email):
    o, bid, emp_token, _ = await _team_with_employee(client, email)
    assert (await invite(client, bid, emp_token, "z@example.com")).status_code == 403
    assert (await req(client, "GET", inv_url(bid), emp_token)).status_code == 403
    owner_id = o["user_id"]
    assert (
        await req(client, "PATCH", member_url(bid, owner_id), emp_token, {"role": "MANAGER"})
    ).status_code == 403
    assert (
        await req(client, "PATCH", member_url(bid, owner_id), o["token"], {"role": "MANAGER"})
    ).status_code == 403
    assert (await req(client, "DELETE", member_url(bid, owner_id), o["token"])).status_code == 403


async def test_role_changes_and_removal_take_effect_immediately_and_a_removed_member_can_return(
    client, email
):
    o, bid, emp_token, emp = await _team_with_employee(client, email)
    assert (
        await req(client, "PATCH", member_url(bid, emp["id"]), o["token"], {"role": "MANAGER"})
    ).status_code == 204
    assert (await req(client, "GET", business_url(bid), emp_token)).json()["business"]["role"] == "MANAGER"

    assert (await req(client, "DELETE", member_url(bid, emp["id"]), o["token"])).status_code == 204
    assert (await req(client, "GET", business_url(bid), emp_token)).status_code == 404
    members = (await req(client, "GET", business_url(bid, "/members"), o["token"])).json()["members"]
    assert [m["userId"] for m in members] == [o["user_id"]]

    await invite(client, bid, o["token"], "emp@example.com")
    await req(client, "POST", ACCEPT, emp_token, {"token": last_email_token(email, "emp@example.com")})
    assert (await req(client, "GET", business_url(bid), emp_token)).json()["business"]["role"] == "EMPLOYEE"


async def test_member_routes_for_unknown_users_are_404(client):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    assert (
        await req(client, "PATCH", member_url(bid, "not-a-uuid"), o["token"], {"role": "MANAGER"})
    ).status_code == 404
    assert (await req(client, "DELETE", inv_url(bid, "/not-a-uuid"), o["token"])).status_code == 404


async def test_invitation_tokens_never_reach_the_logs(client, email, caplog):
    caplog.set_level(logging.DEBUG)
    o = await owner_with_business(client)
    await invite(client, o["business"]["id"], o["token"], "yossi@example.com")
    token = last_email_token(email, "yossi@example.com")
    await req(client, "POST", PREVIEW, None, {"token": token})
    assert token not in caplog.text
