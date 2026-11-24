"""Leads and tracking from a website built elsewhere (F30-F32), ported from embed.test.ts."""

import json
import re

from sqlalchemy import delete, func, select

from app.db import models
from app.modules.embed.routes import EVENT_PATH, LEAD_PATH, SCRIPT_PATH, VISIT_PATH
from tests.conftest import business_url, new_user, owner_with_business, req

UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"
UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"


async def key_of(client, o):
    return (await req(client, "GET", business_url(o["business"]["id"], "/embed"), o["token"])).json()


async def post(client, path, body, ua=UA_DESKTOP, raw=None):
    """What the script sends: JSON in a text/plain body, from another origin."""
    headers = {"content-type": "text/plain", "origin": "https://my-wix-site.example"}
    if ua:
        headers["user-agent"] = ua
    return await client.post(path, headers=headers, content=raw if raw is not None else json.dumps(body))


def base(key, **extra):
    body = {
        "key": key, "id": "a1b2c3d4e5f6g7h8i9j0", "name": "דנה כהן", "phone": "052-7654321",
        "consent": "on", "page": "https://www.my-site.example/contact?x=1", **extra,
    }  # fmt: skip
    return {k: v for k, v in body.items() if v is not None}


def wrong(key):
    return key[:-1] + ("B" if key.endswith("A") else "A")


async def test_the_owner_gets_the_script_tag_with_a_stable_key(client):
    o = await owner_with_business(client, "embed-a")
    info = await key_of(client, o)
    assert info["snippet"] == f'<script async src="{info["scriptUrl"]}" data-key="{info["key"]}"></script>'
    assert info["scriptUrl"].endswith(SCRIPT_PATH)
    assert (await key_of(client, o))["key"] == info["key"]


async def test_only_the_owner_gets_it_outsiders_get_nothing(client, db):
    o = await owner_with_business(client, "embed-b")
    stranger, _ = await new_user(client, "stranger")
    assert (
        await req(client, "GET", business_url(o["business"]["id"], "/embed"), stranger)
    ).status_code == 404


async def test_the_script_is_served_to_other_sites_and_parses_as_text(client):
    res = await client.get(SCRIPT_PATH)
    assert res.status_code == 200 and "application/javascript" in res.headers["content-type"]
    assert res.headers["access-control-allow-origin"] == "*" and "form[data-simplecatch]" in res.text


async def test_the_lead_is_saved_with_its_ad_once_and_never_the_click_id(client, db):
    o = await owner_with_business(client, "embed-c")
    key = (await key_of(client, o))["key"]
    body = base(
        key,
        params={"gclid": "SECRET-CLICK", "utm_campaign": "summer", "utm_term": "hairdresser", "junk": "x"},
        landing="https://www.my-site.example/sale?gclid=SECRET-CLICK",
    )
    first = await post(client, LEAD_PATH, body)
    assert (
        first.status_code == 200
        and first.headers["access-control-allow-origin"] == "*"
        and first.json() == {"ok": True}
    )
    assert (await post(client, LEAD_PATH, body)).json() == {"ok": True}  # a double click: the same id

    leads = (await db.execute(select(models.Lead))).scalars().all()
    assert len(leads) == 1
    lead = leads[0]
    assert (
        lead.source == models.LeadSource.WEBSITE_FORM
        and lead.source_url == "https://www.my-site.example/contact"
    )
    assert lead.attribution_source == "google_ads"
    assert lead.attribution["campaign"] == "summer" and lead.attribution["term"] == "hairdresser"
    assert lead.attribution["clickIdType"] == "gclid" and lead.attribution["landingPath"] == "/sale"
    assert "SECRET-CLICK" not in json.dumps(lead.attribution) and "junk" not in json.dumps(lead.attribution)


async def test_organic_other_site_and_direct_visits_are_named_like_a_simplecatch_site(client, db):
    o = await owner_with_business(client, "embed-d")
    key = (await key_of(client, o))["key"]
    await post(
        client,
        LEAD_PATH,
        base(key, id="org0000000000000001", phone="052-1111111", referrer="https://www.google.co.il/"),
    )
    await post(
        client,
        LEAD_PATH,
        base(key, id="oth0000000000000001", phone="052-2222222", referrer="https://blog.example.org/x"),
    )
    await post(client, LEAD_PATH, base(key, id="dir0000000000000001", phone="052-3333333"))

    async def by(phone):
        return (
            await db.execute(
                select(models.Lead.attribution_source)
                .join(models.Contact)
                .where(models.Contact.phone == phone)
            )
        ).scalar_one()

    assert await by("+972521111111") == "google"
    assert await by("+972522222222") == "referral"
    assert await by("+972523333333") == "direct"


async def test_a_wrong_key_is_refused_and_a_missing_phone_is_explained(client, db):
    o = await owner_with_business(client, "embed-e")
    key = (await key_of(client, o))["key"]
    assert (await post(client, LEAD_PATH, base(wrong(key)))).status_code == 400
    assert (await post(client, LEAD_PATH, base("0" * 32 + "." + "A" * 22))).status_code == 400
    no_phone = await post(client, LEAD_PATH, base(key, phone=None))
    assert (
        no_phone.status_code == 400 and no_phone.json()["ok"] is False and len(no_phone.json()["errors"]) > 0
    )
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 0


async def test_errors_are_in_the_business_language(client):
    o = await owner_with_business(client, "embed-en")
    await req(client, "PATCH", business_url(o["business"]["id"]), o["token"], {"language": "en"})
    key = (await key_of(client, o))["key"]
    res = await post(client, LEAD_PATH, base(key, phone="123"))
    assert res.status_code == 400 and any("not valid" in e for e in res.json()["errors"])


async def test_no_consent_field_is_needed_on_the_owners_own_site(client, db):
    o = await owner_with_business(client, "embed-g")
    key = (await key_of(client, o))["key"]
    assert (await post(client, LEAD_PATH, base(key, consent=None))).json() == {"ok": True}
    count = await db.execute(
        select(func.count()).select_from(models.Lead).where(models.Lead.business_id == o["business"]["id"])
    )
    assert count.scalar_one() == 1


async def test_bots_that_fill_the_hidden_field_and_garbage_bodies_are_dropped(client, db):
    o = await owner_with_business(client, "embed-f")
    key = (await key_of(client, o))["key"]
    assert (await post(client, LEAD_PATH, base(key, website="http://spam.example"))).json() == {"ok": True}
    junk = await post(client, LEAD_PATH, None, raw="not json")
    assert junk.status_code == 400
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 0


async def test_new_embed_leads_notify_the_team_in_the_app(client, db, email):
    o = await owner_with_business(client, "embed-n")
    key = (await key_of(client, o))["key"]
    email.clear()
    await post(client, LEAD_PATH, base(key))
    notes = (await req(client, "GET", business_url(o["business"]["id"], "/notifications"), o["token"])).json()
    assert notes["unreadCount"] == 1 and notes["notifications"][0]["data"]["source"] == "website_form"
    for _ in range(100):
        if email.sent:
            break
        import asyncio

        await asyncio.sleep(0.02)
    assert len(email.sent) == 1 and "דנה כהן" in email.sent[0].text


async def test_embed_lead_requests_are_rate_limited_per_visitor(tmp_path):
    from httpx import ASGITransport, AsyncClient

    from app.integrations.email import MemoryEmailSender
    from app.integrations.storage import LocalDiskStorage
    from app.main import create_app
    from tests.conftest import make_settings

    app = create_app(
        make_settings(LEAD_FORM_RATE_LIMIT_MAX=2),
        email=MemoryEmailSender(),
        storage=LocalDiskStorage(str(tmp_path)),
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            o = await owner_with_business(c, "embed-rl")
            key = (await key_of(c, o))["key"]
            codes = [
                (await post(c, LEAD_PATH, base(key, id=f"rate00000000000000{i}"))).status_code
                for i in range(3)
            ]
            assert codes == [200, 200, 429]
    finally:
        await app.state.engine.dispose()


# --------------------------------------------------------------------------- visits (F31)


async def summary(client, o, days=7):
    return (
        await req(
            client, "GET", business_url(o["business"]["id"], f"/reports/summary?days={days}"), o["token"]
        )
    ).json()


async def test_visits_are_counted_per_source_and_campaign_next_to_the_leads(client, db):
    o = await owner_with_business(client, "visit-a")
    key = (await key_of(client, o))["key"]
    ad = {
        "key": key,
        "params": {"gclid": "SECRET-CLICK", "utm_campaign": "summer"},
        "page": "https://www.my-site.example/",
    }
    for _ in range(3):
        assert (await post(client, VISIT_PATH, ad)).status_code == 200
    await post(client, VISIT_PATH, {"key": key, "page": "https://www.my-site.example/"})
    await post(
        client,
        VISIT_PATH,
        {"key": key, "referrer": "https://blog.example.org/post", "page": "https://www.my-site.example/"},
    )
    # One of the three ad visitors left their details.
    await post(client, LEAD_PATH, base(key, params=ad["params"], landing=ad["page"]))

    rep = await summary(client, o)
    assert rep["visits"] == 5
    google = next(r for r in rep["byAttribution"] if r["source"] == "google_ads")
    assert google["visits"] == 3 and google["leads"] == 1
    camp = rep["byCampaign"][0]
    assert (camp["campaign"], camp["visits"], camp["leads"]) == ("summer", 3, 1)
    unknown = next(r for r in rep["byAttribution"] if r["source"] == "unknown")
    assert unknown["visits"] == 1 and unknown["leads"] == 0
    blog = next(r for r in rep["byAttribution"] if r["name"] == "blog.example.org")
    assert blog["source"] == "referral" and blog["visits"] == 1
    rows = (await db.execute(select(models.VisitCount))).scalars().all()
    assert "SECRET-CLICK" not in json.dumps([(r.source, r.name, r.campaign) for r in rows])


async def test_visits_ignore_bots_a_wrong_key_and_garbage_and_businesses_are_separate(client, db):
    a = await owner_with_business(client, "visit-b")
    b = await owner_with_business(client, "visit-c")
    key = (await key_of(client, a))["key"]
    body = {"key": key, "page": "https://www.my-site.example/"}
    await post(client, VISIT_PATH, body, ua="Googlebot/2.1 (+http://www.google.com/bot.html)")
    await post(client, VISIT_PATH, body, ua="curl/8.4.0")
    assert (await post(client, VISIT_PATH, {**body, "key": wrong(key)})).status_code == 400
    assert (await post(client, VISIT_PATH, {"nonsense": True})).status_code == 400
    assert (await db.execute(select(func.count()).select_from(models.VisitCount))).scalar_one() == 0
    await post(client, VISIT_PATH, body)
    assert (await summary(client, a))["visits"] == 1 and (await summary(client, b))["visits"] == 0


# --------------------------------------------------------------------------- behaviour (F32)


async def behavior(client, o):
    return (await summary(client, o))["behavior"]


async def test_pages_landing_pages_devices_taps_scroll_and_form_starts_are_counted(client):
    o = await owner_with_business(client, "beh-a")
    key = (await key_of(client, o))["key"]

    async def send(evs):
        return await post(client, EVENT_PATH, {"key": key, "events": evs}, ua=UA_PHONE)

    await send(
        [{"k": "page", "l": "/sale/"}, {"k": "landing", "l": "/sale/"}, {"k": "device", "l": "mobile"}]
    )
    await send([{"k": "page", "l": "/sale"}, {"k": "landing", "l": "/sale"}, {"k": "device", "l": "desktop"}])
    await send([{"k": "page", "l": "/"}, {"k": "landing", "l": "/"}, {"k": "device", "l": "mobile"}])
    await send([{"k": "page", "l": "/sale?utm=x#top"}])
    await send([{"k": "click", "l": "phone"}, {"k": "click", "l": "whatsapp"}, {"k": "form", "l": "start"}])
    await send([{"k": "scroll", "l": "50"}, {"k": "scroll", "l": "90"}])
    await send([{"k": "scroll", "l": "50"}])
    await post(
        client, LEAD_PATH,
        base(key, landing="https://www.my-site.example/sale", params={"utm_source": "google", "utm_medium": "cpc", "utm_campaign": "summer"}),
    )  # fmt: skip
    await post(
        client,
        LEAD_PATH,
        base(key, id="dir0000000000000002", phone="052-9999999", landing="https://www.my-site.example/sale/"),
    )

    b = await behavior(client, o)
    assert b["pageViews"] == 4
    assert b["topPages"] == [{"path": "/sale", "views": 3}, {"path": "/", "views": 1}]
    assert b["landing"] == [
        {"path": "/sale", "visits": 2, "leads": 2},
        {"path": "/", "visits": 1, "leads": 0},
    ]
    assert b["devices"] == {"mobile": 2, "tablet": 0, "desktop": 1}
    assert b["clicks"] == {"phone": 1, "whatsapp": 1, "email": 0}
    assert b["scroll"] == {"p50": 2, "p90": 1} and b["formStarts"] == 1


async def test_buttons_an_owner_named_are_counted_with_a_clean_short_name(client):
    o = await owner_with_business(client, "beh-d")
    key = (await key_of(client, o))["key"]
    await post(
        client, EVENT_PATH,
        {"key": key, "events": [
            {"k": "page", "l": "/"}, {"k": "cta", "l": "book-appointment"}, {"k": "cta", "l": "book-appointment"},
            {"k": "cta", "l": "  קבע\n\u0007  תור  "}, {"k": "cta", "l": "x" * 100}, {"k": "cta", "l": "   "},
        ]},
    )  # fmt: skip
    ctas = (await behavior(client, o))["ctas"]
    assert len(ctas) == 3
    assert {"name": "book-appointment", "count": 2} in ctas and {"name": "קבע תור", "count": 1} in ctas
    assert {"name": "x" * 40, "count": 1} in ctas


async def test_sections_seen_per_page_rebuild_a_clean_label_from_their_parts(client):
    o = await owner_with_business(client, "beh-e")
    key = (await key_of(client, o))["key"]
    await post(
        client, EVENT_PATH,
        {"key": key, "events": [
            {"k": "page", "l": "/sale/"}, {"k": "section", "l": "/sale/#pricing"}, {"k": "section", "l": "/sale?x=1#pricing"},
            {"k": "section", "l": "/sale#  "}, {"k": "sclick", "l": "/sale/#pricing"}, {"k": "section", "l": "no hash at all"},
            {"k": "section", "l": f"/{'p' * 100}#{'n' * 80}"},
        ]},
    )  # fmt: skip
    b = await behavior(client, o)
    assert {"path": "/sale", "name": "pricing", "views": 2, "clicks": 1, "pageViews": 1} in b["sections"]
    assert len(b["sections"]) == 2
    long = next(x for x in b["sections"] if x["name"].startswith("n"))
    assert len(f"{long['path']}#{long['name']}") <= 100


async def test_only_known_labels_are_stored_and_bots_wrong_keys_and_other_businesses_are_ignored(client, db):
    a = await owner_with_business(client, "beh-b")
    other = await owner_with_business(client, "beh-c")
    key = (await key_of(client, a))["key"]
    await post(
        client, EVENT_PATH,
        {"key": key, "events": [
            {"k": "device", "l": "toaster"}, {"k": "click", "l": "carrier-pigeon"}, {"k": "scroll", "l": "75"},
            {"k": "form", "l": "sent"}, {"k": "page", "l": "/x" * 200},
        ]},
    )  # fmt: skip
    rows = (await db.execute(select(models.EventCount))).scalars().all()
    assert [r.kind for r in rows] == ["page"] and len(rows[0].label) <= 100
    await db.execute(delete(models.EventCount))
    await db.commit()

    await post(client, EVENT_PATH, {"key": key, "events": [{"k": "page", "l": "/"}]}, ua="Googlebot/2.1")
    assert (
        await post(client, EVENT_PATH, {"key": wrong(key), "events": [{"k": "page", "l": "/"}]})
    ).status_code == 400
    assert (await post(client, EVENT_PATH, {"key": key, "events": [{"k": "nonsense"}]})).status_code == 400
    assert (await db.execute(select(func.count()).select_from(models.EventCount))).scalar_one() == 0
    await post(client, EVENT_PATH, {"key": key, "events": [{"k": "page", "l": "/"}]})
    assert (await behavior(client, a))["pageViews"] == 1 and (await behavior(client, other))["pageViews"] == 0


async def test_the_shipped_script_has_the_pieces_the_owner_relies_on(client):
    text = (await client.get(SCRIPT_PATH)).text
    for piece in (
        "data-simplecatch",
        "data-forms",
        "data-key",
        "/api/v1/embed/lead",
        "/api/v1/embed/visit",
        "/api/v1/embed/event",
    ):
        assert piece in text
    assert re.match(r"^\(function \(\) \{", text)
