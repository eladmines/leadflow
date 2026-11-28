"""Quotes (F18), ported from apps/api/src/modules/quotes/quotes.test.ts."""

import asyncio

from sqlalchemy import select

from app.db import models
from app.modules.quotes.schemas import format_agorot, quote_totals
from tests.conftest import HEADERS, add_member, business_url, new_user, owner_with_business, req


def body(lead_id, **over):
    return {
        "leadId": lead_id,
        "title": "שיפוץ מטבח",
        "items": [
            {"description": "פירוק", "quantity": 1, "unitPrice": 150000},
            {"description": "אריחים (מ״ר)", "quantity": 12, "unitPrice": 12050},
        ],
        "discount": 10000,
        "vatRate": 18,
        "notes": "כולל פינוי פסולת",
    } | over


def quotes(bid, tail=""):
    return business_url(bid, f"/quotes{tail}")


async def _setup(client):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    lead = (
        await req(
            client,
            "POST",
            business_url(bid, "/leads"),
            o["token"],
            {"name": "רון לוי", "phone": "052-1112233", "email": "ron@example.com"},
        )
    ).json()["lead"]
    return o, bid, lead


async def pub(client, method, url, payload=None):
    return await client.request(method, url, headers=HEADERS, **({"json": payload} if payload else {}))


def test_totals_and_currency_match_the_typescript_originals():
    items = [{"quantity": 1, "unitPrice": 150000}, {"quantity": 12, "unitPrice": 12050}]
    assert quote_totals(items, 10000, 18) == {
        "subtotal": 294600,
        "discount": 10000,
        "vat": 51228,
        "total": 335828,
    }
    assert quote_totals(items, 0, 0) == {"subtotal": 294600, "discount": 0, "vat": 0, "total": 294600}
    assert quote_totals(items, 9_999_999, 18)["discount"] == 294600  # clamped to the subtotal
    assert quote_totals([{"quantity": 1, "unitPrice": 5}], 0, 10)["vat"] == 1  # 0.5 rounds up
    assert format_agorot(335828) == "\u200f3,358.28 \u200f₪"
    assert format_agorot(5) == "\u200f0.05 \u200f₪"
    assert format_agorot(123456750) == "\u200f1,234,567.50 \u200f₪"


async def test_creates_numbered_drafts_with_server_totals(client, db):
    o, bid, lead = await _setup(client)
    res = await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))
    assert res.status_code == 201
    q = res.json()["quote"]
    # 1500 + 12×120.50 = 2946 ₪; −100 = 2846; VAT 18% = 512.28 → 3358.28
    assert (q["number"], q["status"], q["publicUrl"]) == (1001, "DRAFT", None)
    assert q["totals"] == {"subtotal": 294600, "discount": 10000, "vat": 51228, "total": 335828}
    assert q["customer"]["name"] == "רון לוי" and q["vatRate"] == 18
    second = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    assert second["number"] == 1002

    no_vat = (
        await req(client, "POST", quotes(bid), o["token"], body(lead["id"], vatRate=0, discount=0))
    ).json()["quote"]
    assert no_vat["totals"] == {"subtotal": 294600, "discount": 0, "vat": 0, "total": 294600}

    bad = await req(client, "POST", quotes(bid), o["token"], body(lead["id"], discount=9_999_999))
    assert bad.status_code == 400 and "ההנחה" in bad.text
    detail = (await req(client, "GET", business_url(bid, f"/leads/{lead['id']}"), o["token"])).json()
    assert (
        detail["activities"][0]["type"] == "quote.created"
        and detail["activities"][0]["data"]["number"] == 1003
    )


async def test_quote_validation_messages_are_hebrew(client, db):
    o, bid, lead = await _setup(client)
    none = await req(client, "POST", quotes(bid), o["token"], body(lead["id"], items=[]))
    assert none.status_code == 400 and none.json()["error"]["fields"]["items"] == "יש להוסיף לפחות שורה אחת"
    bad_item = await req(
        client,
        "POST",
        quotes(bid),
        o["token"],
        body(lead["id"], items=[{"description": " ", "quantity": 0, "unitPrice": -1}]),
    )
    fields = bad_item.json()["error"]["fields"]
    assert fields["items.0.description"] == "יש לתאר את השירות או המוצר"
    assert (
        fields["items.0.quantity"] == "כמות בין 1 ל־9,999" and fields["items.0.unitPrice"] == "מחיר לא תקין"
    )
    assert (
        await req(client, "POST", quotes(bid), o["token"], body(lead["id"], vatRate=31))
    ).status_code == 400
    assert (
        await req(client, "POST", quotes(bid), o["token"], body(lead["id"], title="x" * 121))
    ).status_code == 400


async def test_send_page_accept_updates_status_history_and_team_email_drafts_stay_private(client, db, email):
    o, bid, lead = await _setup(client)
    q = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    email.clear()  # drop the sign-up verification email
    sent = (await req(client, "POST", quotes(bid, f"/{q['id']}/send"), o["token"], {"email": True})).json()[
        "quote"
    ]
    assert sent["status"] == "SENT"
    import re

    assert re.search(r"/q/[A-Za-z0-9_-]{43}$", sent["publicUrl"])
    assert [m.to for m in email.sent] == ["ron@example.com"]
    assert sent["publicUrl"] in email.sent[0].text and "3,358.28" in email.sent[0].text

    # A sent quote can't be edited; duplicate makes a new draft.
    assert (
        await req(client, "PUT", quotes(bid, f"/{q['id']}"), o["token"], body(lead["id"]))
    ).status_code == 409
    copy = (await req(client, "POST", quotes(bid, f"/{q['id']}/duplicate"), o["token"])).json()["quote"]
    assert (copy["status"], copy["number"], copy["publicUrl"]) == ("DRAFT", 1002, None)

    token = sent["publicUrl"].split("/")[-1]
    page = await pub(client, "GET", f"/api/v1/public/quotes/{token}")
    assert page.status_code == 200 and page.headers["cache-control"] == "no-store"
    p = page.json()["quote"]
    assert (p["number"], p["customerName"], p["status"]) == (1001, "רון לוי", "SENT") and p["totals"][
        "total"
    ] == 335828
    assert lead["id"] not in page.text
    # The draft copy is never public.
    assert (await pub(client, "GET", "/api/v1/public/quotes/" + "x" * 43)).status_code == 404

    email.clear()
    accept = await pub(client, "POST", f"/api/v1/public/quotes/{token}/decision", {"decision": "accept"})
    assert accept.json()["quote"]["status"] == "ACCEPTED"
    for _ in range(100):
        if email.sent:
            break
        await asyncio.sleep(0.02)
    assert len(email.sent) == 1 and "אישר/ה" in email.sent[0].subject
    note = (
        await db.execute(select(models.Notification).where(models.Notification.user_id == o["user_id"]))
    ).scalar_one()
    assert note.type == "quote.accepted" and note.data["quoteId"] and note.data["number"] == 1001
    assert (
        await pub(client, "POST", f"/api/v1/public/quotes/{token}/decision", {"decision": "reject"})
    ).status_code == 409
    detail = (await req(client, "GET", business_url(bid, f"/leads/{lead['id']}"), o["token"])).json()
    # F35: the follow-up closed itself right after the customer's answer.
    by_type = {x["type"]: x for x in detail["activities"][:2]}
    assert set(by_type) == {"task.completed", "quote.accepted"}
    assert by_type["quote.accepted"]["actor"] is None and by_type["task.completed"]["data"]["auto"] is True


async def test_expired_quotes_show_as_expired_and_cannot_be_accepted(client, db):
    o, bid, lead = await _setup(client)
    q = (
        await req(client, "POST", quotes(bid), o["token"], body(lead["id"], validUntil="2020-01-01"))
    ).json()["quote"]
    sent = (await req(client, "POST", quotes(bid, f"/{q['id']}/send"), o["token"], {"email": False})).json()[
        "quote"
    ]
    assert sent["expired"] is True
    token = sent["publicUrl"].split("/")[-1]
    res = await pub(client, "POST", f"/api/v1/public/quotes/{token}/decision", {"decision": "accept"})
    assert res.status_code == 409 and "תוקף" in res.json()["error"]["message"]


async def test_emailing_a_customer_without_an_email_is_refused_and_the_business_can_record_a_decision(
    client, db
):
    o, bid, _ = await _setup(client)
    no_mail = (
        await req(
            client, "POST", business_url(bid, "/leads"), o["token"], {"name": "דנה", "phone": "052-0000009"}
        )
    ).json()["lead"]
    q = (await req(client, "POST", quotes(bid), o["token"], body(no_mail["id"]))).json()["quote"]
    assert (
        await req(client, "POST", quotes(bid, f"/{q['id']}/send"), o["token"], {"email": True})
    ).status_code == 400
    rejected = await req(
        client, "POST", quotes(bid, f"/{q['id']}/status"), o["token"], {"status": "REJECTED"}
    )
    assert rejected.json()["quote"]["status"] == "REJECTED"
    assert (
        await req(client, "DELETE", quotes(bid, f"/{q['id']}"), o["token"])
    ).status_code == 409  # only drafts


async def test_drafts_can_be_edited_and_deleted(client, db):
    o, bid, lead = await _setup(client)
    q = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    edited = await req(
        client,
        "PUT",
        quotes(bid, f"/{q['id']}"),
        o["token"],
        body(lead["id"], title="חדש", discount=0, validUntil="2031-05-06"),
    )
    assert edited.status_code == 200
    e = edited.json()["quote"]
    assert (e["title"], e["discount"], e["validUntil"], e["number"]) == ("חדש", 0, "2031-05-06", 1001)
    assert (await req(client, "DELETE", quotes(bid, f"/{q['id']}"), o["token"])).status_code == 204
    assert (await req(client, "GET", quotes(bid, f"/{q['id']}"), o["token"])).status_code == 404
    listing = (await req(client, "GET", quotes(bid), o["token"])).json()["quotes"]
    assert listing == []


async def test_employees_only_see_quotes_on_their_leads_other_businesses_see_nothing(client, db):
    o, bid, lead = await _setup(client)
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    q = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    assert (await req(client, "GET", quotes(bid), emp_token)).json()["quotes"] == []
    assert (await req(client, "GET", quotes(bid, f"/{q['id']}"), emp_token)).status_code == 404
    assert (await req(client, "POST", quotes(bid), emp_token, body(lead["id"]))).status_code == 400

    await req(client, "PATCH", business_url(bid, f"/leads/{lead['id']}"), o["token"], {"ownerId": emp_id})
    assert len((await req(client, "GET", quotes(bid), emp_token)).json()["quotes"]) == 1

    other = await owner_with_business(client, "other")
    obid = other["business"]["id"]
    assert (await req(client, "GET", quotes(obid, f"/{q['id']}"), other["token"])).status_code == 404
    assert (await req(client, "POST", quotes(obid), other["token"], body(lead["id"]))).status_code == 400


async def test_the_public_decision_is_rate_limited(client, db):
    o, bid, lead = await _setup(client)
    q = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    sent = (await req(client, "POST", quotes(bid, f"/{q['id']}/send"), o["token"], {"email": False})).json()[
        "quote"
    ]
    token = sent["publicUrl"].split("/")[-1]
    codes = [
        (
            await pub(client, "POST", f"/api/v1/public/quotes/{token}/decision", {"decision": "accept"})
        ).status_code
        for _ in range(22)
    ]
    assert codes[0] == 200 and codes[1] == 409 and codes[-1] == 429


async def _stage_of(client, bid, token, lead_id):
    leads = (await req(client, "GET", business_url(bid, "/leads"), token)).json()["leads"]
    return next(lead["stage"]["name"] for lead in leads if lead["id"] == lead_id)


async def test_sending_a_quote_moves_an_early_lead_to_quote_sent_and_never_moves_one_back(client, db):
    o, bid, lead = await _setup(client)
    assert await _stage_of(client, bid, o["token"], lead["id"]) == "חדש"
    q = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    # A draft changes nothing.
    assert await _stage_of(client, bid, o["token"], lead["id"]) == "חדש"
    await req(client, "POST", quotes(bid, f"/{q['id']}/send"), o["token"], {"email": False})
    assert await _stage_of(client, bid, o["token"], lead["id"]) == "הצעה נשלחה"
    history = (
        (await db.execute(select(models.Activity).where(models.Activity.type == "lead.stage_changed")))
        .scalars()
        .all()
    )
    assert [(a.data["from"], a.data["to"]) for a in history] == [("חדש", "הצעה נשלחה")]

    # Sending another quote leaves it where it is (no second move).
    q2 = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    await req(client, "POST", quotes(bid, f"/{q2['id']}/send"), o["token"], {"email": False})
    assert await _stage_of(client, bid, o["token"], lead["id"]) == "הצעה נשלחה"

    # A lead that is already waiting stays in "waiting".
    stages = (await req(client, "GET", business_url(bid, "/pipeline"), o["token"])).json()["stages"]
    waiting = next(s for s in stages if s["name"] == "ממתין")
    await req(
        client, "PATCH", business_url(bid, f"/leads/{lead['id']}"), o["token"], {"stageId": waiting["id"]}
    )
    q3 = (await req(client, "POST", quotes(bid), o["token"], body(lead["id"]))).json()["quote"]
    await req(client, "POST", quotes(bid, f"/{q3['id']}/send"), o["token"], {"email": False})
    assert await _stage_of(client, bid, o["token"], lead["id"]) == "ממתין"


async def test_a_lead_cannot_be_put_in_quote_sent_without_a_sent_quote(client, db):
    o, bid, lead = await _setup(client)
    tok = o["token"]
    stages = (await req(client, "GET", business_url(bid, "/pipeline"), tok)).json()["stages"]
    quote_sent = next(s for s in stages if s["name"] == "הצעה נשלחה")
    move = lambda: req(  # noqa: E731
        client, "PATCH", business_url(bid, f"/leads/{lead['id']}"), tok, {"stageId": quote_sent["id"]}
    )

    refused = await move()
    assert refused.status_code == 400
    assert "ליצור ולשלוח הצעת מחיר" in refused.json()["error"]["message"]
    assert await _stage_of(client, bid, tok, lead["id"]) == "חדש"

    # A draft is not a sent quote.
    q = (await req(client, "POST", quotes(bid), tok, body(lead["id"]))).json()["quote"]
    assert (await move()).status_code == 400

    # A new lead can't start there either.
    created = await req(
        client,
        "POST",
        business_url(bid, "/leads"),
        tok,
        {"name": "דנה", "phone": "052-9998877", "stageId": quote_sent["id"]},
    )
    assert created.status_code == 400

    # Once the quote is sent the lead is there (by itself), and the stage is accepted for it.
    await req(client, "POST", quotes(bid, f"/{q['id']}/send"), tok, {"email": False})
    assert await _stage_of(client, bid, tok, lead["id"]) == "הצעה נשלחה"
    other = next(s for s in stages if s["name"] == "ממתין")
    await req(client, "PATCH", business_url(bid, f"/leads/{lead['id']}"), tok, {"stageId": other["id"]})
    assert (await move()).status_code == 200
    assert await _stage_of(client, bid, tok, lead["id"]) == "הצעה נשלחה"
