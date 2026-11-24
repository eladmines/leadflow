"""F25 channels: each business connects its own number / Page (port of channels.test.ts, without
the webhook routing checks, which arrive with the webhooks)."""

import base64
from urllib.parse import parse_qs, quote, urlsplit

import pytest
from sqlalchemy import func, select

from app.core.secret_box import open_secret, seal_secret, secret_key
from app.db import models
from app.integrations.meta import MemoryMetaApi, MetaPage
from tests.conftest import add_member, business_url, make_settings, new_user, owner_with_business, req

FB_CALLBACK = "/api/v1/integrations/facebook/callback"


@pytest.fixture
def settings():
    return make_settings(META_APP_ID="1056519927431185")


@pytest.fixture
def meta(app) -> MemoryMetaApi:
    app.state.meta_api = MemoryMetaApi()
    return app.state.meta_api


def ch(o, tail=""):
    return business_url(o["business"]["id"], f"/channels{tail}")


async def sign_in(client, o, meta, query="") -> tuple[str, str]:
    """Runs Facebook sign-in; returns (redirect location, the result param)."""
    start = (await req(client, "GET", ch(o, f"/facebook/start{query}"), o["token"])).json()
    state = parse_qs(urlsplit(start["url"]).query)["state"][0]
    back = await client.get(f"{FB_CALLBACK}?code=good-code&state={quote(state)}")
    assert back.status_code == 302
    loc = back.headers["location"]
    return loc, parse_qs(urlsplit(loc).query)


async def test_connects_whatsapp_sealed(client, db, meta):
    o = await owner_with_business(client, "ch-owner")
    before = (await req(client, "GET", ch(o), o["token"])).json()
    assert before["whatsapp"]["connected"] is False
    assert before["messenger"]["connected"] is False
    assert before["facebookLogin"] is True

    res = await req(
        client,
        "POST",
        ch(o, "/whatsapp"),
        o["token"],
        {"phoneNumberId": "555000111", "accessToken": "EAA-whatsapp-token-0123456789"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["whatsapp"] == {
        "channel": "whatsapp",
        "connected": True,
        "name": "+1 555-000-1111",
        "source": "business",
    }
    row = (await db.execute(select(models.ChannelConnection))).scalar_one()
    assert "EAA-whatsapp-token" not in row.token_encrypted
    assert "EAA-whatsapp-token" not in res.text


async def test_whatsapp_validation(client, meta):
    o = await owner_with_business(client, "ch-val")
    bad = await req(
        client, "POST", ch(o, "/whatsapp"), o["token"], {"phoneNumberId": "12", "accessToken": "x"}
    )
    assert bad.status_code == 400
    assert set(bad.json()["error"]["fields"]) == {"phoneNumberId", "accessToken"}


async def test_one_business_per_number_and_owner_only(client, db, meta):
    a = await owner_with_business(client, "ch-a")
    b = await owner_with_business(client, "ch-b")
    body = {"phoneNumberId": "555000111", "accessToken": "EAA-whatsapp-token-0123456789"}
    await req(client, "POST", ch(a, "/whatsapp"), a["token"], body)
    taken = await req(client, "POST", ch(b, "/whatsapp"), b["token"], body)
    assert taken.status_code == 409
    assert taken.json()["error"]["message"] == "המספר או הדף כבר מחוברים לעסק אחר."

    token, user_id = await new_user(client, "ch-mgr")
    await add_member(db, a["business"]["id"], user_id, "MANAGER")
    assert (await req(client, "GET", ch(a), token)).status_code == 200
    assert (await req(client, "POST", ch(a, "/whatsapp"), token, body)).status_code == 403
    assert (await req(client, "DELETE", ch(a, "/whatsapp"), token)).status_code == 403


async def test_facebook_page_through_sign_in(client, db, meta):
    o = await owner_with_business(client, "ch-fb")
    start = (await req(client, "GET", ch(o, "/facebook/start"), o["token"])).json()
    url = urlsplit(start["url"])
    assert url.hostname == "www.facebook.com"
    assert parse_qs(url.query)["client_id"] == ["1056519927431185"]

    loc, q = await sign_in(client, o, meta)
    assert urlsplit(loc).path == f"/b/{o['business']['id']}/settings"
    pending = q["facebook"][0]
    pages = (await req(client, "GET", ch(o, f"/facebook/pending/{pending}"), o["token"])).json()
    assert pages == {"pages": [{"id": "100200300", "name": "דף לבדיקה", "instagram": None}]}

    connected = await req(
        client, "POST", ch(o, "/facebook"), o["token"], {"pendingId": pending, "pageId": "100200300"}
    )
    assert connected.json()["messenger"]["connected"] is True
    assert connected.json()["messenger"]["name"] == "דף לבדיקה"
    assert "100200300" in meta.subscribed
    # The sign-in can't be reused.
    assert (await req(client, "GET", ch(o, f"/facebook/pending/{pending}"), o["token"])).status_code == 409

    off = await req(client, "DELETE", ch(o, "/messenger"), o["token"])
    assert off.json()["messenger"]["connected"] is False
    assert "100200300" not in meta.subscribed


async def test_forged_or_failed_sign_in(client, db, meta):
    o = await owner_with_business(client, "ch-forged")
    forged = await client.get(f"{FB_CALLBACK}?code=good-code&state=eyJiIjoieCJ9.bad")
    assert urlsplit(forged.headers["location"]).path == "/app"

    start = (await req(client, "GET", ch(o, "/facebook/start"), o["token"])).json()
    state = parse_qs(urlsplit(start["url"]).query)["state"][0]
    failed = await client.get(f"{FB_CALLBACK}?code=bad-code&state={quote(state)}")
    assert parse_qs(urlsplit(failed.headers["location"]).query)["facebook"] == ["error"]
    assert (await db.execute(select(func.count()).select_from(models.OauthPending))).scalar_one() == 0


async def test_instagram_from_connected_page(client, db, meta):
    o = await owner_with_business(client, "ch-ig")
    meta.instagram["100200300"] = {"id": "17841400001", "username": "shiran_hair"}
    early = await req(client, "POST", ch(o, "/instagram"), o["token"], {})
    assert early.status_code == 409

    _, q = await sign_in(client, o, meta)
    await req(
        client, "POST", ch(o, "/facebook"), o["token"], {"pendingId": q["facebook"][0], "pageId": "100200300"}
    )
    res = await req(client, "POST", ch(o, "/instagram"), o["token"], {})
    assert res.json()["instagram"] == {
        "channel": "instagram",
        "connected": True,
        "name": "@shiran_hair",
        "source": "business",
    }
    assert "page-token" not in res.text

    # Disconnecting Instagram keeps the Page's subscription while Facebook still uses it.
    off = await req(client, "DELETE", ch(o, "/instagram"), o["token"])
    assert off.json()["instagram"]["connected"] is False
    assert "100200300" in meta.subscribed


async def test_instagram_through_sign_in(client, db, meta):
    o = await owner_with_business(client, "ch-ig2")
    meta.pages_to_return = [
        MetaPage("100200300", "דף לבדיקה", "page-token"),
        MetaPage("100200301", "דף עם אינסטגרם", "page-token-2", {"id": "17841400002", "username": "with_ig"}),
    ]
    start = (await req(client, "GET", ch(o, "/facebook/start?for=instagram"), o["token"])).json()
    assert "instagram_manage_messages" in parse_qs(urlsplit(start["url"]).query)["scope"][0]
    _, q = await sign_in(client, o, meta, "?for=instagram")
    pending = q["instagram"][0]
    pages = (await req(client, "GET", ch(o, f"/facebook/pending/{pending}"), o["token"])).json()
    assert [p["instagram"] for p in pages["pages"]] == [None, "@with_ig"]

    none = await req(
        client, "POST", ch(o, "/instagram"), o["token"], {"pendingId": pending, "pageId": "100200300"}
    )
    assert none.status_code == 409
    assert "אינסטגרם עסקי" in none.json()["error"]["message"]

    ok = await req(
        client, "POST", ch(o, "/instagram"), o["token"], {"pendingId": pending, "pageId": "100200301"}
    )
    assert ok.json()["instagram"]["name"] == "@with_ig"
    assert "100200301" in meta.subscribed
    # Instagram alone: disconnecting it also stops the Page's messages.
    await req(client, "DELETE", ch(o, "/instagram"), o["token"])
    assert "100200301" not in meta.subscribed


def test_secret_box_opens_node_sealed_and_rejects_tampering(settings):
    key = secret_key(settings)
    # A box sealed by apps/api/src/core/secret-box.ts with the same key derivation.
    iv, plain = b"\x01" * 12, "EAA-token"
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    sealed = AESGCM(key).encrypt(iv, plain.encode(), None)
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    box = ".".join(["v1", b64(iv), b64(sealed[-16:]), b64(sealed[:-16])])
    assert open_secret(box, key) == plain
    assert open_secret(seal_secret(plain, key), key) == plain
    with pytest.raises(Exception):  # noqa: B017
        open_secret(box[:-2] + "AA", key)
