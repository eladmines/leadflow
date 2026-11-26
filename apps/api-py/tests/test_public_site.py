"""The public site server and the website lead form (F06, F07), ported from the Node tests."""

import json
import logging
import re
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.form_token import create_form_token
from app.db import models
from app.integrations.email import MemoryEmailSender
from app.integrations.storage import LocalDiskStorage
from app.main import create_app
from app.public.app import create_public_app
from tests.conftest import (
    LEAD_FORM_PATH,
    add_member,
    business_url,
    make_settings,
    new_user,
    owner_with_business,
    req,
    site_host,
    wait_for,
)

FORM = {"content-type": "application/x-www-form-urlencoded"}


def site_url(bid, tail=""):
    return business_url(bid, f"/site{tail}")


def token(settings, sub, age_ms=10_000):
    """A token issued `age_ms` ago (default: long enough to pass the minimum fill time)."""
    return create_form_token(settings.FORM_TOKEN_SECRET, sub, int(time.time() * 1000) - age_ms)


async def live_site(client, sub="salon", configure=None, language="he"):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await req(client, "PATCH", business_url(bid), o["token"], {"phone": "050-1111111"})
    site = (
        await req(client, "POST", site_url(bid), o["token"], {"templateKey": "beauty", "language": language})
    ).json()["site"]
    revision = 0
    if configure:
        sections = [dict(s) for s in site["sections"]]
        configure(sections)
        draft = {k: site[k] for k in ("templateKey", "theme", "seo", "pages")}
        saved = await req(
            client, "PUT", site_url(bid, "/draft"), o["token"], {**draft, "revision": 0, "sections": sections}
        )
        revision = saved.json()["site"]["revision"]
    await req(client, "PUT", site_url(bid, "/subdomain"), o["token"], {"subdomain": sub})
    await req(client, "POST", site_url(bid, "/publish"), o["token"], {"revision": revision})
    contact_id = next(s for s in site["sections"] if s["type"] == "contact")["id"]
    return {**o, "id": bid, "contact_id": contact_id}


async def submit(public, settings, sub, fields):
    return await public.post(
        LEAD_FORM_PATH, headers={"host": site_host(settings, sub), **FORM}, content=urlencode(fields)
    )


def valid(settings, contact_id, sub="salon", **over):
    return {
        "_t": token(settings, sub), "_s": contact_id, "website": "", "name": "דנה כהן", "phone": "052-7654321",
        "email": "dana@example.com", "message": "אשמח לתור ליום חמישי", "consent": "on", **over,
    }  # fmt: skip


async def get(public, settings, sub, path="/", **headers):
    return await public.get(path, headers={"host": site_host(settings, sub), **headers})


# --------------------------------------------------------------------------- serving


async def test_serves_the_page_with_strict_security_headers_and_a_fresh_token_per_view(
    client, public, settings
):
    await live_site(client, "garage")
    res = await get(public, settings, "garage")
    assert res.status_code == 200 and "text/html" in res.headers["content-type"]
    csp = res.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "script-src 'self';" in csp and "connect-src 'self';" in csp
    assert not re.search(r"script-src[^;]*(https?:|unsafe)", csp)
    # The only script is our own, first-party one: nothing else may run or connect anywhere.
    assert len(re.findall(r"<script\b", res.text)) == 1
    assert '<script defer src="/__sc.js"></script>' in res.text
    assert res.headers["x-frame-options"] == "DENY" and res.headers["cache-control"] == "no-store"
    again = await get(public, settings, "garage")
    find = lambda html: re.search(r'name="_t" value="([^"]+)"', html).group(1)  # noqa: E731
    assert re.match(r"^\d{13}\.", find(res.text)) and find(again.text) != find(res.text)
    assert "__LF_FORM_TOKEN__" not in res.text
    assert "set-cookie" not in res.headers  # a direct visit remembers nothing
    assert 'dir="rtl"' in res.text


async def test_robots_and_sitemap_carry_the_site_origin(client, public, settings):
    await live_site(client, "garage")
    host = site_host(settings, "garage")
    robots = await get(public, settings, "garage", "/robots.txt")
    assert f"Sitemap: http://{host}/sitemap.xml" in robots.text
    sitemap = await get(public, settings, "garage", "/sitemap.xml")
    assert f"<loc>http://{host}/</loc>" in sitemap.text


@pytest.mark.parametrize("host", ["nobody.lvh.me:4100", "evil.example.com", "a.b.lvh.me:4100"])
async def test_unknown_foreign_and_nested_hosts_get_a_hebrew_noindex_404(public, host):
    res = await public.get("/", headers={"host": host})
    assert res.status_code == 404 and "האתר לא נמצא" in res.text and "noindex" in res.text


async def test_unknown_paths_on_a_live_site_are_404(client, public, settings):
    await live_site(client, "garage")
    res = await get(public, settings, "garage", "/wp-admin")
    assert res.status_code == 404 and "העמוד לא נמצא" in res.text


async def test_the_counting_script_is_served_first_party(client, public, settings):
    await live_site(client, "garage")
    res = await get(public, settings, "garage", "/__sc.js")
    assert res.status_code == 200 and "application/javascript" in res.headers["content-type"]
    assert res.headers["cache-control"] == "public, max-age=3600" and "(function ()" in res.text


# --------------------------------------------------------------------------- attribution and counting


async def test_a_campaign_visit_sets_the_attribution_cookie_and_is_counted(client, public, settings, db):
    o = await live_site(client, "garage")
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari"
    res = await get(
        public, settings, "garage", "/?utm_source=newsletter&utm_campaign=nov", **{"user-agent": ua}
    )
    assert res.status_code == 200
    set_cookie = res.headers["set-cookie"]
    assert set_cookie.startswith("lf_src=") and "HttpOnly" in set_cookie and "SameSite=lax" in set_cookie
    # No click id value, no visitor id: only names.
    await wait_for(lambda: True)
    # The visit and its events are counted by background tasks of their own: wait for both (the
    # events landing after the visit made this test flaky on slower machines).
    import asyncio

    expected = {("page", "/"), ("landing", "/"), ("device", "mobile")}
    for _ in range(250):
        db.expire_all()
        rows = (await db.execute(select(models.VisitCount))).scalars().all()
        events = {(e.kind, e.label): e.count for e in (await db.execute(select(models.EventCount))).scalars()}
        if rows and expected <= events.keys():
            break
        await asyncio.sleep(0.02)
    assert [(r.source, r.name, r.campaign, r.count) for r in rows] == [("utm", "newsletter", "nov", 1)]
    assert events[("page", "/")] == 1 and events[("landing", "/")] == 1 and events[("device", "mobile")] == 1

    # The lead made from that visit remembers where it came from.
    cookie_value = set_cookie.split(";")[0].split("=", 1)[1]
    res = await public.post(
        LEAD_FORM_PATH,
        headers={"host": site_host(settings, "garage"), "cookie": f"lf_src={cookie_value}", **FORM},
        content=urlencode(valid(settings, o["contact_id"], "garage")),
    )
    assert res.status_code == 200
    lead = (await db.execute(select(models.Lead))).scalar_one()
    assert lead.attribution["source"] == "utm" and lead.attribution["campaign"] == "nov"
    assert lead.attribution_source == "utm"


async def test_bots_are_not_counted(client, public, settings, db):
    await live_site(client, "garage")
    await get(public, settings, "garage", "/", **{"user-agent": "Googlebot/2.1"})
    await get(public, settings, "garage", "/")  # no user agent at all
    import asyncio

    await asyncio.sleep(0.2)
    assert (await db.execute(select(func.count()).select_from(models.EventCount))).scalar_one() == 0


async def test_the_site_script_reports_only_known_sections_and_kinds(client, public, settings, db):
    await live_site(client, "garage")
    ua = {"user-agent": "Mozilla/5.0 (Macintosh) Safari/605"}
    body = json.dumps(
        {
            "ev": [{"k": "click", "l": "phone"}, {"k": "scroll", "l": "50"}],
            "sec": ["s-hero", "s-nope"],
            "clk": "s-contact",
        }
    )
    res = await public.post(
        "/__sc",
        headers={"host": site_host(settings, "garage"), "content-type": "text/plain", **ua},
        content=body,
    )
    assert res.status_code == 204
    events = {(e.kind, e.label) for e in (await db.execute(select(models.EventCount))).scalars()}
    assert ("click", "phone") in events and ("scroll", "50") in events
    assert ("section", "/#hero") in events and ("sclick", "/#contact") in events
    assert not any(label.endswith("nope") for _, label in events)
    junk = await public.post(
        "/__sc",
        headers={"host": site_host(settings, "garage"), "content-type": "text/plain", **ua},
        content="not json",
    )
    assert junk.status_code == 204


# --------------------------------------------------------------------------- the lead form


async def test_the_published_page_carries_a_real_form(client, public, settings):
    await live_site(client)
    page = await get(public, settings, "salon")
    assert f'action="{LEAD_FORM_PATH}"' in page.text and re.search(r'name="_t" value="\d{13}\.', page.text)


async def test_a_lead_creates_contact_lead_activity_and_emails_owner_and_manager_only(
    client, public, settings, db, email
):
    o = await live_site(client)
    mgr_token, mgr_id = await new_user(client, "mgr")
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, o["id"], mgr_id, "MANAGER")
    await add_member(db, o["id"], emp_id, "EMPLOYEE")
    email.clear()

    res = await submit(public, settings, "salon", valid(settings, o["contact_id"]))
    assert res.status_code == 200 and "תודה!" in res.text and "קיבלנו את הפרטים" in res.text

    lead = (await db.execute(select(models.Lead))).scalar_one()
    contact = (await db.execute(select(models.Contact))).scalar_one()
    assert str(lead.business_id) == o["id"] and lead.source == models.LeadSource.WEBSITE_FORM
    assert (
        lead.source_url == f"http://{site_host(settings, 'salon')}/"
        and lead.message == "אשמח לתור ליום חמישי"
    )
    assert (contact.name, contact.phone, contact.email) == ("דנה כהן", "+972527654321", "dana@example.com")
    stages = await db.execute(select(models.PipelineStage).where(models.PipelineStage.business_id == o["id"]))
    assert len(stages.scalars().all()) == 6
    acts = await db.execute(
        select(func.count()).select_from(models.Activity).where(models.Activity.type == "lead.created")
    )
    assert acts.scalar_one() == 1

    await wait_for(lambda: len(email.sent) == 2)
    assert not any(m.to.startswith("emp-") for m in email.sent)
    mail = email.sent[0]
    assert mail.subject == "פנייה חדשה מהאתר — מספרת שירן" and "052-7654321" in mail.text
    assert f"/b/{o['id']}/leads" in mail.text and f"/b/{o['id']}/account" in mail.text

    # In the app too, for those who see all leads (D-097).
    owner_notes = (await req(client, "GET", business_url(o["id"], "/notifications"), o["token"])).json()
    assert owner_notes["unreadCount"] == 1 and owner_notes["notifications"][0]["type"] == "lead.new"
    assert owner_notes["notifications"][0]["data"]["name"] == "דנה כהן"
    assert (await req(client, "GET", business_url(o["id"], "/notifications"), mgr_token)).json()[
        "unreadCount"
    ] == 1
    assert (await req(client, "GET", business_url(o["id"], "/notifications"), emp_token)).json()[
        "unreadCount"
    ] == 0


async def test_a_member_who_turned_new_lead_emails_off_gets_none(client, public, settings, db, email):
    o = await live_site(client)
    mgr_token, mgr_id = await new_user(client, "mgr")
    await add_member(db, o["id"], mgr_id, "MANAGER")
    off = await req(
        client, "PUT", business_url(o["id"], "/me/notifications"), mgr_token, {"newLeadEmail": False}
    )
    assert off.json() == {"prefs": {"newLeadEmail": False}}
    email.clear()
    await submit(public, settings, "salon", valid(settings, o["contact_id"]))
    await wait_for(lambda: len(email.sent) == 1)
    assert not email.sent[0].to.startswith("mgr-")


async def test_an_appointment_request_becomes_a_pending_appointment_in_the_business_time_zone(
    client, public, settings, db, email
):
    o = await live_site(client)
    service = (
        await req(
            client,
            "POST",
            business_url(o["id"], "/services"),
            o["token"],
            {"name": "תספורת", "durationMin": 45},
        )
    ).json()["service"]
    rev = (await req(client, "GET", site_url(o["id"]), o["token"])).json()["site"]["revision"]
    await req(
        client, "POST", site_url(o["id"], "/publish"), o["token"], {"revision": rev}
    )  # so the form offers the service
    page = await get(public, settings, "salon")
    assert (
        f'<option value="{service["id"]}">תספורת</option>' in page.text
        and 'name="date" type="date"' in page.text
    )
    email.clear()

    day = (datetime.now(UTC) + timedelta(days=10)).strftime("%Y-%m-%d")
    res = await submit(
        public,
        settings,
        "salon",
        valid(settings, o["contact_id"], serviceId=service["id"], date=day, time="09:30"),
    )
    assert res.status_code == 200
    appt = (await db.execute(select(models.Appointment))).scalar_one()
    assert (
        appt.status == models.AppointmentStatus.REQUESTED
        and appt.source == "website"
        and appt.staff_id is None
    )
    assert appt.ends_at - appt.starts_at == timedelta(minutes=45)
    assert appt.starts_at.strftime("%H:%M") in (
        "06:30",
        "07:30",
    )  # 09:30 in Israel, depending on daylight saving
    await wait_for(lambda: len(email.sent) == 1)
    assert "בקשה לתור" in email.sent[0].text

    past = await submit(
        public,
        settings,
        "salon",
        valid(settings, o["contact_id"], phone="052-0000000", date="2020-01-01", time="09:00"),
    )
    assert past.status_code == 400 and "מועד עתידי" in past.text
    assert (await db.execute(select(func.count()).select_from(models.Appointment))).scalar_one() == 1
    task = (await db.execute(select(models.Task))).scalar_one()  # so the request is noticed (D-152)
    assert (
        task.title.startswith("בקשה חדשה לתור: דנה כהן · ") and task.notes == "מחכה לאישור שלכם בעמוד התורים."
    )


async def test_a_double_submit_creates_one_lead_and_a_returning_phone_reuses_the_contact(
    client, public, settings, db
):
    o = await live_site(client)
    fields = valid(settings, o["contact_id"])
    await submit(public, settings, "salon", fields)
    await submit(public, settings, "salon", fields)
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 1
    await submit(public, settings, "salon", valid(settings, o["contact_id"], name="דנה", message="שוב אני"))
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 2
    assert (await db.execute(select(func.count()).select_from(models.Contact))).scalar_one() == 1


async def test_bots_get_the_thank_you_page_and_nothing_is_stored(client, public, settings, db):
    o = await live_site(client)
    honeypot = await submit(
        public, settings, "salon", valid(settings, o["contact_id"], website="http://spam")
    )
    fast = await submit(
        public, settings, "salon", valid(settings, o["contact_id"], _t=token(settings, "salon", 500))
    )
    for res in (honeypot, fast):
        assert res.status_code == 200 and "תודה!" in res.text
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 0


async def test_missing_expired_and_foreign_tokens_get_a_refresh_page(client, public, settings, db):
    o = await live_site(client)
    for t in ("__LF_FORM_TOKEN__", token(settings, "salon", 25 * 3600_000), token(settings, "other-site")):
        res = await submit(public, settings, "salon", valid(settings, o["contact_id"], _t=t))
        assert res.status_code == 400 and "רעננו את הדף" in res.text
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 0


async def test_validation_errors_are_hebrew_and_in_the_site_look(client, public, settings):
    o = await live_site(client)
    res = await submit(public, settings, "salon", valid(settings, o["contact_id"], phone="123", consent=""))
    assert res.status_code == 400 and "noindex" in res.text
    assert "יש לאשר את יצירת הקשר כדי לשלוח" in res.text and "מספר הטלפון אינו תקין" in res.text


async def test_an_english_site_is_english_page_form_errors_and_thank_you(client, public, settings, db, email):
    o = await live_site(client, "salon", language="en")
    page = await get(public, settings, "salon")
    assert '<html lang="en" dir="ltr">' in page.text and "Book an appointment" in page.text
    assert "Full name" in page.text and "שם מלא" not in page.text

    bad = await submit(public, settings, "salon", valid(settings, o["contact_id"], phone="123", consent=""))
    assert bad.status_code == 400 and "Please agree to be contacted so we can send this" in bad.text
    assert "The phone number is not valid" in bad.text and "Back to the site" in bad.text

    # An English business: the team's email is in English too.
    await req(client, "PATCH", business_url(o["id"]), o["token"], {"language": "en"})
    ok = await submit(public, settings, "salon", valid(settings, o["contact_id"]))
    await wait_for(lambda: any(m.subject.startswith("New website enquiry — ") for m in email.sent))
    assert "Thank you!" in ok.text and "received your details" in ok.text


async def test_404_for_unpublished_sites_unknown_hosts_disabled_forms_and_unknown_sections(
    client, public, settings, db
):
    def disable(sections):
        for s in sections:
            if s["type"] == "contact":
                s["form"] = {**s["form"], "enabled": False}

    o = await live_site(client, "salon", disable)
    assert (await submit(public, settings, "salon", valid(settings, o["contact_id"]))).status_code == 404
    assert (
        await submit(public, settings, "nobody", valid(settings, o["contact_id"], "nobody"))
    ).status_code == 404
    live = await live_site(client, "salon2")
    assert (
        await submit(public, settings, "salon2", valid(settings, "not-a-section", "salon2"))
    ).status_code == 404
    await req(client, "POST", site_url(live["id"], "/unpublish"), live["token"])
    assert (
        await submit(public, settings, "salon2", valid(settings, live["contact_id"], "salon2"))
    ).status_code == 404
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 0


async def test_only_form_encoded_posts_are_accepted(client, public, settings):
    await live_site(client)
    res = await public.post(
        LEAD_FORM_PATH,
        headers={"host": site_host(settings, "salon"), "content-type": "application/json"},
        content="{}",
    )
    assert res.status_code == 400 and "הבקשה אינה תקינה" in res.text


async def test_the_visitors_personal_details_never_reach_the_logs(client, public, settings, caplog):
    o = await live_site(client)
    caplog.set_level(logging.DEBUG)
    await submit(public, settings, "salon", valid(settings, o["contact_id"]))
    text = caplog.text
    assert "lead created from website" in text
    for pii in ("דנה", "7654321", "dana@example.com", "יום חמישי"):
        assert pii not in text


async def test_submissions_are_rate_limited_per_visitor_and_site(client, tmp_path):
    strict = make_settings(LEAD_FORM_RATE_LIMIT_MAX=2)
    app = create_app(strict, email=MemoryEmailSender(), storage=LocalDiskStorage(str(tmp_path)))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as api:
            o = await live_site(api)
            st = app.state
            pub = create_public_app(strict, st.sessionmaker, st.email, st.site_cache, st.storage)
            async with AsyncClient(transport=ASGITransport(app=pub), base_url="http://pub") as c:
                codes = [
                    (await submit(c, strict, "salon", valid(strict, o["contact_id"]))).status_code
                    for _ in range(3)
                ]
                assert codes == [200, 200, 429]
                third = await submit(c, strict, "salon", valid(strict, o["contact_id"]))
                assert "יותר מדי ניסיונות" in third.text
    finally:
        await app.state.engine.dispose()


# --------------------------------------------------------------------------- free hosting: path mode


APP_URL = "https://leadflow-test.onrender.com"


@pytest.fixture
def path_mode(tmp_path):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>SimpleCatch</title>")
    (web / "assets" / "app-abc123.js").write_text("console.log(1)")
    return make_settings(PUBLIC_SITE_MODE="path", APP_URL=APP_URL, WEB_DIST_DIR=str(web))


async def _path_pair(settings, tmp_path):
    app = create_app(settings, email=MemoryEmailSender(), storage=LocalDiskStorage(str(tmp_path / "m")))
    st = app.state
    pub = create_public_app(settings, st.sessionmaker, st.email, st.site_cache, st.storage)
    api = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    pc = AsyncClient(transport=ASGITransport(app=pub), base_url="http://pub")
    return app, api, pc


async def test_path_mode_gives_the_site_a_path_address_and_serves_it_with_links_under_the_path(
    path_mode, tmp_path
):
    app, api, pub = await _path_pair(path_mode, tmp_path)
    try:
        async with api, pub:
            o = await live_site(api, "salon")
            site = (await req(api, "GET", site_url(o["id"]), o["token"])).json()["site"]
            assert (
                site["publicUrl"] == f"{APP_URL}/s/salon"
                and site["publicPrefix"] == "leadflow-test.onrender.com/s/"
            )

            page = await pub.get("/s/salon/")
            assert page.status_code == 200
            assert f'action="/s/salon{LEAD_FORM_PATH}"' in page.text and 'href="/s/salon/"' in page.text
            assert not re.search(r'\shref="/(?!s/salon/|/)', page.text)
            body = page.text.replace('<script defer src="/s/salon/__sc.js"></script>', "")
            assert (
                'src="/s/' not in body
            )  # images stay on the app's /media: only links, the form and our script move
            assert '<script defer src="/s/salon/__sc.js"></script>' in page.text
            script = await pub.get("/s/salon/__sc.js")
            assert script.status_code == 200 and "application/javascript" in script.headers["content-type"]
            assert (await pub.get("/s/salon")).status_code == 200
            assert (await pub.get("/s/nobody/")).status_code == 404
            assert (await pub.get("/s/salon/nope")).status_code == 404
            assert f"<loc>{APP_URL}/s/salon/</loc>" in (await pub.get("/s/salon/sitemap.xml")).text
    finally:
        await app.state.engine.dispose()


async def test_path_mode_takes_a_lead_from_the_form_under_the_path(path_mode, tmp_path):
    app, api, pub = await _path_pair(path_mode, tmp_path)
    try:
        async with api, pub:
            o = await live_site(api, "salon")
            fields = {
                "_t": token(path_mode, "salon"),
                "_s": o["contact_id"],
                "website": "",
                "name": "דנה כהן",
                "phone": "052-7654321",
                "consent": "on",
            }
            res = await pub.post(f"/s/salon{LEAD_FORM_PATH}", headers=FORM, content=urlencode(fields))
            assert res.status_code == 200 and "תודה!" in res.text and 'href="/s/salon/"' in res.text
            async with app.state.sessionmaker() as db:
                lead = (await db.execute(select(models.Lead))).scalar_one()
            assert lead.source_url == f"{APP_URL}/s/salon/"
            other = await pub.post(
                f"/s/salon{LEAD_FORM_PATH}",
                headers=FORM,
                content=urlencode({**fields, "_t": token(path_mode, "other")}),
            )
            assert other.status_code == 400
    finally:
        await app.state.engine.dispose()


async def test_the_api_serves_the_built_web_app(path_mode, tmp_path):
    app, api, pub = await _path_pair(path_mode, tmp_path)
    try:
        async with api, pub:
            shell = await api.get("/b/123/leads")
            assert (
                shell.status_code == 200
                and "text/html" in shell.headers["content-type"]
                and "<title>SimpleCatch</title>" in shell.text
            )
            asset = await api.get("/assets/app-abc123.js")
            assert (
                "text/javascript" in asset.headers["content-type"]
                and "immutable" in asset.headers["cache-control"]
            )
            assert (await api.get("/assets/gone.js")).status_code == 404
            missing = await api.get("/api/v1/nothing-here")
            assert missing.status_code == 404 and missing.json()["error"]["code"] == "NOT_FOUND"
            escape = await api.get("/..%2f..%2fpackage.json")
            assert "<title>SimpleCatch</title>" in escape.text
            assert (
                await api.post("/b/123/leads", headers={"X-Requested-With": "SimpleCatch"})
            ).status_code == 404
    finally:
        await app.state.engine.dispose()


async def test_the_combined_server_routes_sites_and_the_api_on_one_port(tmp_path):
    from app.server import create_server

    settings = make_settings()
    server = create_server(settings)
    async with AsyncClient(transport=ASGITransport(app=server), base_url="http://x") as c:
        assert (await c.get("/health")).json() == {"status": "ok"}
        site = await c.get("/", headers={"host": "nobody.lvh.me:4100"})
        assert site.status_code == 404 and "האתר לא נמצא" in site.text
        api_missing = await c.get("/api/v1/nothing", headers={"host": "localhost:4000"})
        assert api_missing.json()["error"]["code"] == "NOT_FOUND"
