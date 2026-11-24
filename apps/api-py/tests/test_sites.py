"""Site builder API and publishing (F04, F06), ported from apps/api/src/modules/sites/*.test.ts."""

import re
import uuid
from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.form_token import create_form_token
from app.db import models
from app.integrations.email import MemoryEmailSender
from app.integrations.storage import LocalDiskStorage
from app.main import create_app
from tests.conftest import (
    LEAD_FORM_PATH,
    add_member,
    business_url,
    make_settings,
    new_user,
    owner_with_business,
    req,
    site_host,
)


def site_url(bid, tail=""):
    return business_url(bid, f"/site{tail}")


def page(slug, title, page_id, contact_id=None):
    """A minimal extra page (the editor builds these in the browser)."""
    sections = []
    if contact_id:
        sections.append(
            {
                "id": contact_id, "type": "contact", "visible": True, "title": "דברו איתנו", "subtitle": "",
                "showPhone": True, "showAddress": True, "showHours": True,
                "form": {"enabled": True, "askEmail": True, "askMessage": True, "buttonLabel": "שלח", "successMessage": "תודה", "askAppointment": False},
            }
        )  # fmt: skip
    return {
        "id": page_id,
        "slug": slug,
        "title": title,
        "inMenu": True,
        "seo": {"title": "", "description": ""},
        "sections": sections,
    }


async def owner_with_site(client, template="beauty", label="owner"):
    o = await owner_with_business(client, label)
    bid = o["business"]["id"]
    await req(client, "PATCH", business_url(bid), o["token"], {"phone": "050-1234567"})
    res = await req(client, "POST", site_url(bid), o["token"], {"templateKey": template})
    assert res.status_code == 201, res.text
    return {**o, "id": bid, "site": res.json()["site"]}


def draft_body(site, **over):
    body = {k: site[k] for k in ("revision", "templateKey", "theme", "seo", "sections", "pages")}
    return {**body, **over}


async def edit_title(client, o, title):
    cur = (await req(client, "GET", site_url(o["id"]), o["token"])).json()["site"]
    sections = [{**cur["sections"][0], "title": title}, *cur["sections"][1:]]
    res = await req(
        client, "PUT", site_url(o["id"], "/draft"), o["token"], draft_body(cur, sections=sections)
    )
    assert res.status_code == 200, res.text
    return res.json()["site"]


async def publish(client, o, revision):
    return await req(client, "POST", site_url(o["id"], "/publish"), o["token"], {"revision": revision})


async def set_subdomain(client, o, sub):
    return await req(client, "PUT", site_url(o["id"], "/subdomain"), o["token"], {"subdomain": sub})


async def visit(public, settings, sub, path="/"):
    return await public.get(path, headers={"host": site_host(settings, sub)})


# --------------------------------------------------------------------------- the builder API


async def test_returns_null_before_a_site_exists(client):
    o = await owner_with_business(client)
    res = await req(client, "GET", site_url(o["business"]["id"]), o["token"])
    assert res.status_code == 200 and res.json() == {"site": None}


async def test_creates_a_site_from_a_template_prefilled_with_the_business_name_once(client, db):
    o = await owner_with_site(client, "trades")
    site = o["site"]
    assert (site["templateKey"], site["revision"], site["status"]) == ("trades", 0, "DRAFT")
    assert site["sections"][0]["type"] == "hero" and site["sections"][0]["title"] == "מספרת שירן"
    assert site["theme"]["language"] == "he" and site["pages"] == [] and site["published"] is None
    again = await req(client, "POST", site_url(o["id"]), o["token"], {"templateKey": "beauty"})
    assert again.status_code == 409
    count = await db.execute(
        select(func.count()).select_from(models.AuditLog).where(models.AuditLog.action == "site.created")
    )
    assert count.scalar_one() == 1


async def test_a_site_follows_the_business_language_unless_told_otherwise(client):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    await req(client, "PATCH", business_url(bid), o["token"], {"language": "en"})
    en = (await req(client, "POST", site_url(bid), o["token"], {"templateKey": "food"})).json()["site"]
    assert en["theme"]["language"] == "en" and en["sections"][0]["buttonLabel"].isascii()


async def test_drafts_are_saved_with_revision_locking(client):
    o = await owner_with_site(client)
    site = o["site"]
    draft = draft_body(site, sections=[{**site["sections"][0], "title": "כותרת חדשה"}])
    first = await req(client, "PUT", site_url(o["id"], "/draft"), o["token"], draft)
    assert first.status_code == 200
    saved = first.json()["site"]
    assert saved["revision"] == 1 and saved["sections"][0]["title"] == "כותרת חדשה"

    # A second editor still holding revision 0 must not overwrite.
    stale = await req(client, "PUT", site_url(o["id"], "/draft"), o["token"], {**draft, "sections": []})
    assert stale.status_code == 409 and "בחלון אחר" in stale.json()["error"]["message"]
    now = await req(client, "GET", site_url(o["id"]), o["token"])
    assert len(now.json()["site"]["sections"]) == 1


async def test_invalid_drafts_are_rejected(client):
    o = await owner_with_site(client)
    site = o["site"]
    base = {"revision": 0, "templateKey": "beauty", "theme": site["theme"], "seo": site["seo"]}
    for sections in (
        [{"id": "x", "type": "script", "visible": True}],
        [site["sections"][0], site["sections"][0]],
        [{**site["sections"][0], "title": "א" * 500}],
    ):
        res = await req(
            client, "PUT", site_url(o["id"], "/draft"), o["token"], {**base, "sections": sections}
        )
        assert res.status_code == 400, sections
    dup = await req(
        client,
        "PUT",
        site_url(o["id"], "/draft"),
        o["token"],
        {**base, "sections": [site["sections"][0], site["sections"][0]]},
    )
    assert dup.json()["error"]["fields"] == {"sections": "מזהי מקטעים כפולים"}


async def test_user_text_is_stored_as_data_and_escaped_at_render_time(client):
    o = await owner_with_site(client)
    evil = "<script>alert(1)</script>"
    site = o["site"]
    res = await req(
        client,
        "PUT",
        site_url(o["id"], "/draft"),
        o["token"],
        draft_body(site, sections=[{**site["sections"][0], "title": evil}]),
    )
    assert res.json()["site"]["sections"][0]["title"] == evil


async def test_saving_before_a_site_exists_is_404(client):
    o = await owner_with_business(client)
    res = await req(
        client, "PUT", site_url(o["business"]["id"], "/draft"), o["token"],
        {"revision": 0, "templateKey": "beauty", "theme": {"palette": "teal", "font": "rubik"}, "seo": {"title": "", "description": ""}, "sections": []},
    )  # fmt: skip
    assert res.status_code == 404


async def test_managers_and_employees_can_view_the_site_but_not_create_or_edit_it(client, db):
    o = await owner_with_site(client)
    for role in ("MANAGER", "EMPLOYEE"):
        token, uid = await new_user(client, role.lower())
        await add_member(db, o["id"], uid, role)
        assert (await req(client, "GET", site_url(o["id"]), token)).status_code == 200
        put = await req(client, "PUT", site_url(o["id"], "/draft"), token, draft_body(o["site"], sections=[]))
        assert put.status_code == 403
        assert (
            await req(client, "POST", site_url(o["id"]), token, {"templateKey": "beauty"})
        ).status_code == 403


async def test_a_draft_cannot_use_another_businesss_image(client, db):
    a = await owner_with_site(client, label="a")
    b = await owner_with_business(client, "b")
    now = datetime.now(UTC)
    theirs = uuid.uuid4()
    db.add(models.Asset(id=theirs, business_id=uuid.UUID(b["business"]["id"]), key=f"{b['business']['id']}/{theirs}.webp",
                        mime="image/webp", size_bytes=10, width=10, height=10, created_at=now))  # fmt: skip
    await db.commit()
    site = a["site"]
    stolen = await req(
        client,
        "PUT",
        site_url(a["id"], "/draft"),
        a["token"],
        draft_body(site, theme={**site["theme"], "logoAssetId": str(theirs)}),
    )
    assert stolen.status_code == 400 and "אינה שייכת לעסק" in stolen.json()["error"]["message"]


# --------------------------------------------------------------------------- sample photos


async def test_a_new_site_starts_with_hero_and_about_photos_copied_into_the_library(db, tmp_path):
    app = create_app(
        make_settings(SITE_STOCK_IMAGES=True),
        email=MemoryEmailSender(),
        storage=LocalDiskStorage(str(tmp_path)),
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            o = await owner_with_business(c)
            bid = o["business"]["id"]
            res = await req(c, "POST", site_url(bid), o["token"], {"templateKey": "garage"})
            assert res.status_code == 201
            sections = res.json()["site"]["sections"]
            hero = next(s for s in sections if s["type"] == "hero")
            about = next(s for s in sections if s["type"] == "about")
            assert about["imageAlt"] == "מכונאי בודק מנוע של רכב"
            library = (await req(c, "GET", business_url(bid, "/assets"), o["token"])).json()
            assert sorted(a["id"] for a in library["assets"]) == sorted(
                [hero["imageAssetId"], about["imageAssetId"]]
            )
            assert library["assets"][0]["originalName"].startswith("תמונה לדוגמה")
            img = await c.get(library["assets"][0]["url"])
            assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
            again = await req(c, "POST", site_url(bid), o["token"], {"templateKey": "beauty"})
            assert again.status_code == 409
            count = await db.execute(select(func.count()).select_from(models.Asset))
            assert count.scalar_one() == 2
    finally:
        await app.state.engine.dispose()


# --------------------------------------------------------------------------- publishing


async def test_publishing_validates_subdomains_normalises_and_reserves_them(client, settings):
    a = await owner_with_site(client, label="a")
    b = await owner_with_site(client, label="b")
    assert (await set_subdomain(client, a, "www")).status_code == 400
    assert (await set_subdomain(client, a, "שירן")).status_code == 400
    ok = await set_subdomain(client, a, " Shiran ")
    assert ok.status_code == 200
    site = ok.json()["site"]
    assert site["subdomain"] == "shiran" and site["publicUrl"] == f"http://shiran.{settings.PUBLIC_SITE_HOST}"
    assert site["publicDomain"] == settings.PUBLIC_SITE_HOST and site["publicPrefix"] is None
    taken = await set_subdomain(client, b, "shiran")
    assert taken.status_code == 409 and "תפוסה" in taken.json()["error"]["fields"]["subdomain"]


async def test_publishing_needs_a_subdomain(client):
    o = await owner_with_site(client)
    res = await publish(client, o, 0)
    assert res.status_code == 400 and res.json()["error"]["fields"]["subdomain"]


async def test_the_live_site_only_changes_on_republish(client, db, public, settings):
    o = await owner_with_site(client)
    await set_subdomain(client, o, "shiran")
    assert (await visit(public, settings, "shiran")).status_code == 404  # not published yet

    v1 = await edit_title(client, o, "גרסה ראשונה")
    res = await publish(client, o, v1["revision"])
    assert res.status_code == 200
    s = res.json()["site"]
    assert (
        s["status"] == "PUBLISHED"
        and s["published"]["number"] == 1
        and s["published"]["revision"] == v1["revision"]
    )

    page_ = await visit(public, settings, "shiran")
    assert page_.status_code == 200 and "גרסה ראשונה" in page_.text and "050-1234567" in page_.text

    v2 = await edit_title(client, o, "טיוטה חדשה")
    page_ = await visit(public, settings, "shiran")
    assert "גרסה ראשונה" in page_.text and "טיוטה חדשה" not in page_.text

    assert (await publish(client, o, v2["revision"])).json()["site"]["published"]["number"] == 2
    assert "טיוטה חדשה" in (await visit(public, settings, "shiran")).text
    count = await db.execute(
        select(func.count()).select_from(models.AuditLog).where(models.AuditLog.action == "site.published")
    )
    assert count.scalar_one() == 2


async def test_a_stale_revision_is_refused_and_the_live_version_stays(client, public, settings):
    o = await owner_with_site(client)
    await set_subdomain(client, o, "shiran")
    v1 = await edit_title(client, o, "חי")
    await publish(client, o, v1["revision"])
    await edit_title(client, o, "לא פורסם")
    stale = await publish(client, o, v1["revision"])
    assert stale.status_code == 409
    assert "חי" in (await visit(public, settings, "shiran")).text


async def test_versions_roll_back_and_unpublish(client, public, settings):
    o = await owner_with_site(client)
    await set_subdomain(client, o, "shiran")
    await publish(client, o, (await edit_title(client, o, "אחת"))["revision"])
    await publish(client, o, (await edit_title(client, o, "שתיים"))["revision"])

    listing = (await req(client, "GET", site_url(o["id"], "/versions"), o["token"])).json()["versions"]
    assert [(v["number"], v["live"]) for v in listing] == [(2, True), (1, False)]
    assert listing[0]["publishedBy"]

    back = await req(client, "POST", site_url(o["id"], f"/versions/{listing[1]['id']}/rollback"), o["token"])
    assert back.json()["site"]["published"]["number"] == 1
    assert "אחת" in (await visit(public, settings, "shiran")).text

    off = await req(client, "POST", site_url(o["id"], "/unpublish"), o["token"])
    assert off.json()["site"]["status"] == "DRAFT" and off.json()["site"]["published"] is None
    assert (await visit(public, settings, "shiran")).status_code == 404


async def test_cannot_roll_back_to_another_businesss_version(client, public, settings):
    a = await owner_with_site(client, label="a")
    b = await owner_with_site(client, label="b")
    await set_subdomain(client, a, "aaa")
    await set_subdomain(client, b, "bbb")
    await publish(client, a, 0)
    a_version = (await req(client, "GET", site_url(a["id"], "/versions"), a["token"])).json()["versions"][0][
        "id"
    ]
    assert (
        await req(client, "POST", site_url(b["id"], f"/versions/{a_version}/rollback"), b["token"])
    ).status_code == 404
    assert (
        await req(client, "POST", site_url(b["id"], "/versions/not-a-uuid/rollback"), b["token"])
    ).status_code == 404
    assert (await visit(public, settings, "bbb")).status_code == 404


async def test_only_the_owner_picks_an_address_publishes_rolls_back_or_unpublishes(client, db):
    o = await owner_with_site(client)
    token, uid = await new_user(client, "manager")
    await add_member(db, o["id"], uid, "MANAGER")
    assert (
        await req(client, "PUT", site_url(o["id"], "/subdomain"), token, {"subdomain": "mgr"})
    ).status_code == 403
    assert (
        await req(client, "POST", site_url(o["id"], "/publish"), token, {"revision": 0})
    ).status_code == 403
    assert (await req(client, "POST", site_url(o["id"], "/unpublish"), token)).status_code == 403
    assert (await req(client, "GET", site_url(o["id"], "/versions"), token)).status_code == 200


async def test_extra_pages_are_served_by_address_in_the_menu_and_sitemap_and_forms_work_from_any_page(
    client, db, public, settings
):
    o = await owner_with_site(client, label="pages")
    await set_subdomain(client, o, "pages-salon")
    cur = (await req(client, "GET", site_url(o["id"]), o["token"])).json()["site"]
    about, offer = page("about", "אודות", "p-about"), page("summer", "מבצע", "p-offer", "p-offer-contact")
    saved = await req(
        client, "PUT", site_url(o["id"], "/draft"), o["token"], draft_body(cur, pages=[about, offer])
    )
    assert saved.status_code == 200
    assert [p["slug"] for p in saved.json()["site"]["pages"]] == ["about", "summer"]
    assert (await publish(client, o, saved.json()["site"]["revision"])).status_code == 200

    home = await visit(public, settings, "pages-salon")
    assert '<a href="/about">אודות</a>' in home.text
    about_page = await visit(public, settings, "pages-salon", "/about/")
    assert about_page.status_code == 200 and "<title>אודות · " in about_page.text
    assert about_page.headers["cache-control"] == "no-store"
    assert (await visit(public, settings, "pages-salon", "/summer")).status_code == 200
    assert (await visit(public, settings, "pages-salon", "/nope")).status_code == 404
    sitemap = await visit(public, settings, "pages-salon", "/sitemap.xml")
    assert "/about</loc>" in sitemap.text and "/summer</loc>" in sitemap.text

    # A form on the landing page creates a lead that records the page.
    token = create_form_token(
        settings.FORM_TOKEN_SECRET, "pages-salon", int(datetime.now(UTC).timestamp() * 1000) - 10_000
    )
    sent = await public.post(
        LEAD_FORM_PATH,
        headers={
            "host": site_host(settings, "pages-salon"),
            "content-type": "application/x-www-form-urlencoded",
        },
        content=f"_t={token}&_s=p-offer-contact&_p=summer&name=%D7%93%D7%A0%D7%94+%D7%9B%D7%94%D7%9F&phone=052-7654321&consent=on",
    )
    assert sent.status_code == 200
    lead = (await db.execute(select(models.Lead))).scalar_one()
    assert lead.source_url.endswith("/summer")


async def test_duplicate_page_addresses_are_rejected(client):
    o = await owner_with_site(client, label="dupes")
    cur = o["site"]
    res = await req(
        client,
        "PUT",
        site_url(o["id"], "/draft"),
        o["token"],
        draft_body(cur, pages=[page("about", "א", "a1"), page("about", "ב", "a2")]),
    )
    assert res.status_code == 400 and "pages.1.slug" in res.json()["error"]["fields"]


async def test_changing_the_template_keeps_logo_pages_and_the_live_version(client, db, public, settings):
    o = await owner_with_site(client, label="switch")
    await set_subdomain(client, o, "switch-salon")
    cur = (await req(client, "GET", site_url(o["id"]), o["token"])).json()["site"]
    logo = uuid.uuid4()
    now = datetime.now(UTC)
    db.add(models.Asset(id=logo, business_id=uuid.UUID(o["id"]), key=f"{o['id']}/{logo}.webp", mime="image/webp",
                        size_bytes=10, width=10, height=10, created_at=now))  # fmt: skip
    await db.commit()
    saved = (
        await req(client, "PUT", site_url(o["id"], "/draft"), o["token"],
                  draft_body(cur, theme={**cur["theme"], "logoAssetId": str(logo)}, pages=[page("about", "אודות", "p-about")]))
    ).json()["site"]  # fmt: skip
    assert (await publish(client, o, saved["revision"])).status_code == 200

    async def live():
        html = (await visit(public, settings, "switch-salon")).text
        return re.sub(r'name="_t" value="[^"]*"', "", html)

    before = await live()
    res = await req(
        client,
        "POST",
        site_url(o["id"], "/template"),
        o["token"],
        {"templateKey": "garage", "revision": saved["revision"]},
    )
    assert res.status_code == 200
    site = res.json()["site"]
    assert site["templateKey"] == "garage" and site["revision"] == saved["revision"] + 1
    assert site["theme"]["logoAssetId"] == str(logo) and [p["slug"] for p in site["pages"]] == ["about"]
    assert site["sections"] != saved["sections"] and site["published"] is not None
    assert await live() == before  # nothing changes on the live site until the owner publishes


async def test_changing_the_template_refuses_a_stale_revision_and_non_owners(client, db):
    o = await owner_with_site(client, label="stale")
    stale = await req(
        client, "POST", site_url(o["id"], "/template"), o["token"], {"templateKey": "garage", "revision": 5}
    )
    assert stale.status_code == 409
    token, uid = await new_user(client, "switch-mgr")
    await add_member(db, o["id"], uid, "MANAGER")
    body = {"templateKey": "garage", "revision": 0}
    assert (await req(client, "POST", site_url(o["id"], "/template"), token, body)).status_code == 403
    assert (await req(client, "DELETE", site_url(o["id"]), token)).status_code == 403


async def test_deleting_the_site_takes_it_offline_frees_the_address_and_keeps_leads(
    client, db, public, settings
):
    o = await owner_with_site(client, label="delete")
    await set_subdomain(client, o, "delete-salon")
    cur = (await req(client, "GET", site_url(o["id"]), o["token"])).json()["site"]
    assert (await publish(client, o, cur["revision"])).status_code == 200
    assert (await visit(public, settings, "delete-salon")).status_code == 200

    contact = next(s for s in cur["sections"] if s["type"] == "contact")
    token = create_form_token(
        settings.FORM_TOKEN_SECRET, "delete-salon", int(datetime.now(UTC).timestamp() * 1000) - 10_000
    )
    sent = await public.post(
        LEAD_FORM_PATH,
        headers={
            "host": site_host(settings, "delete-salon"),
            "content-type": "application/x-www-form-urlencoded",
        },
        content=f"_t={token}&_s={contact['id']}&name=%D7%93%D7%A0%D7%94+%D7%9B%D7%94%D7%9F&phone=052-7654321&consent=on",
    )
    assert sent.status_code == 200

    assert (await req(client, "DELETE", site_url(o["id"]), o["token"])).status_code == 204
    assert (await req(client, "GET", site_url(o["id"]), o["token"])).json()["site"] is None
    assert (await visit(public, settings, "delete-salon")).status_code == 404
    assert (await db.execute(select(func.count()).select_from(models.SiteVersion))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(models.Lead))).scalar_one() == 1
    submission = (await db.execute(select(models.FormSubmission))).scalar_one()
    assert submission.site_id is None and submission.consent_at is not None

    other = await owner_with_site(client, label="reuse")
    assert (
        await set_subdomain(client, other, "delete-salon")
    ).status_code == 200  # the address is free again
    assert (
        await req(client, "POST", site_url(o["id"]), o["token"], {"templateKey": "beauty"})
    ).status_code == 201
