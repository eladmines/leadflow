"""Media (F05), ported from apps/api/src/modules/media/media.test.ts."""

import io
import os
import re
import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import func, select

from app.db import models
from app.integrations.email import MemoryEmailSender
from app.integrations.storage import DatabaseStorage, LocalDiskStorage
from app.main import create_app
from tests.conftest import (
    HEADERS,
    add_member,
    business_url,
    cookie,
    make_settings,
    new_user,
    owner_with_business,
    req,
)


def jpeg(width=3000, height=2000, exif=True):
    """A real JPEG, with EXIF metadata that must not survive."""
    img = Image.new("RGB", (width, height), "#cc8866")
    out = io.BytesIO()
    kwargs = {}
    if exif:
        e = Image.Exif()
        e[0x8298] = "secret-owner"  # Copyright
        e[0x013B] = "home-gps"  # Artist
        kwargs["exif"] = e
    img.save(out, format="JPEG", **kwargs)
    return out.getvalue()


def noisy(width=400, height=300):
    """Random pixels: doesn't compress, so it reliably exceeds a tiny quota."""
    img = Image.frombytes("RGB", (width, height), os.urandom(width * height * 3))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=95)
    return out.getvalue()


def assets(bid, tail=""):
    return business_url(bid, f"/assets{tail}")


async def upload(client, bid, token, data, name="photo.jpg", content_type="image/jpeg"):
    return await client.post(
        assets(bid), headers={**HEADERS, **cookie(token)}, files={"file": (name, data, content_type)}
    )


async def test_re_encodes_to_webp_within_1920px_strips_metadata_and_serves_immutably(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    res = await upload(client, bid, o["token"], jpeg())
    assert res.status_code == 201
    asset = res.json()["asset"]
    assert (asset["width"], asset["height"], asset["originalName"]) == (1920, 1280, "photo.jpg")
    assert re.match(rf"^/media/{bid}/[0-9a-f-]{{36}}\.webp$", asset["url"])

    file = await client.get(asset["url"])
    assert file.status_code == 200 and file.headers["content-type"] == "image/webp"
    assert "immutable" in file.headers["cache-control"]
    assert file.headers["x-content-type-options"] == "nosniff"
    assert file.headers["content-security-policy"] == "default-src 'none'"
    out = Image.open(io.BytesIO(file.content))
    assert out.format == "WEBP" and out.size == (1920, 1280)
    assert not out.info.get("exif")
    assert b"secret-owner" not in file.content and b"home-gps" not in file.content

    listing = (await req(client, "GET", assets(bid), o["token"])).json()
    assert len(listing["assets"]) == 1 and listing["usedBytes"] == asset["sizeBytes"]
    assert listing["quotaBytes"] == 200 * 1024 * 1024


async def test_small_images_are_not_enlarged_and_png_with_alpha_works(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    out = io.BytesIO()
    Image.new("RGBA", (50, 40), (255, 0, 0, 100)).save(out, format="PNG")
    res = await upload(client, bid, o["token"], out.getvalue(), "logo.png", "image/png")
    assert res.status_code == 201 and (res.json()["asset"]["width"], res.json()["asset"]["height"]) == (
        50,
        40,
    )


@pytest.mark.parametrize(
    ("data", "name", "ctype", "message"),
    [
        (b"definitely not an image", "evil.jpg", "image/jpeg", "לא הצלחנו לקרוא"),
        (
            b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
            "x.svg",
            "image/svg+xml",
            "JPG, PNG או WebP",
        ),
        (
            b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
            "y.jpg",
            "image/jpeg",
            "JPG, PNG או WebP",
        ),
    ],
    ids=["text renamed jpg", "svg", "svg with xml header"],
)
async def test_rejects_unreadable_and_scriptable_files(client, db, data, name, ctype, message):
    o = await owner_with_business(client)
    res = await upload(client, o["business"]["id"], o["token"], data, name, ctype)
    assert res.status_code == 400 and message in res.json()["error"]["message"]
    assert (await db.execute(select(func.count()).select_from(models.Asset))).scalar_one() == 0


async def test_rejects_gifs_and_files_over_8mb(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    gif = io.BytesIO()
    Image.new("RGB", (10, 10), "#000").save(gif, format="GIF")
    assert (await upload(client, bid, o["token"], gif.getvalue(), "a.gif", "image/gif")).status_code == 400
    big = await upload(client, bid, o["token"], b"\x01" * (9 * 1024 * 1024), "big.jpg")
    assert big.status_code == 400 and "גדול מדי" in big.json()["error"]["message"]


async def test_a_request_without_a_file_is_refused(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    plain = await client.post(assets(bid), headers={**HEADERS, **cookie(o["token"])}, json={})
    assert plain.status_code == 400 and "לא נבחר קובץ" in plain.json()["error"]["message"]
    no_file = await client.post(assets(bid), headers={**HEADERS, **cookie(o["token"])}, data={"x": "y"})
    assert no_file.status_code == 400 and "לא נבחר קובץ" in no_file.json()["error"]["message"]


async def test_the_per_business_quota_is_enforced(db):
    tiny_settings = make_settings(MEDIA_QUOTA_BYTES=1000)
    app = create_app(tiny_settings, email=MemoryEmailSender(), storage=LocalDiskStorage("/tmp/sc-test-media"))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            o = await owner_with_business(c)
            res = await upload(c, o["business"]["id"], o["token"], noisy())
            assert res.status_code == 409 and "מקום האחסון" in res.json()["error"]["message"]
    finally:
        await app.state.engine.dispose()


async def test_deleting_an_image_in_use_is_refused_an_unused_one_is_deleted_with_its_file(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    used = (await upload(client, bid, o["token"], jpeg(400, 300))).json()["asset"]
    unused = (await upload(client, bid, o["token"], jpeg(400, 300))).json()["asset"]
    now = datetime.now(UTC)
    db.add(
        models.Site(
            id=uuid.uuid4(),
            business_id=uuid.UUID(bid),
            template_key="beauty",
            theme={"logoAssetId": used["id"]},
            seo={},
            sections=[],
            pages=[],
            revision=0,
            status=models.SiteStatus.DRAFT,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()

    blocked = await req(client, "DELETE", assets(bid, f"/{used['id']}"), o["token"])
    assert blocked.status_code == 409 and "בשימוש באתר" in blocked.json()["error"]["message"]
    assert (await req(client, "DELETE", assets(bid, f"/{unused['id']}"), o["token"])).status_code == 204
    assert (await client.get(unused["url"])).status_code == 404
    assert (await client.get(used["url"])).status_code == 200
    assert (await req(client, "DELETE", assets(bid, f"/{uuid.uuid4()}"), o["token"])).status_code == 404


async def test_employees_can_view_the_library_but_not_upload_and_odd_paths_are_404(client, db):
    o = await owner_with_business(client)
    bid = o["business"]["id"]
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    assert (await upload(client, bid, emp_token, jpeg(100, 100))).status_code == 403
    assert (await req(client, "GET", assets(bid), emp_token)).status_code == 200
    for url in (
        "/media/../../etc/passwd",
        "/media/%2e%2e/%2e%2e/etc/passwd",
        "/media/abc.webp",
        "/media/stock/..%2f..%2fx",
    ):
        assert (await client.get(url)).status_code == 404


async def test_another_business_cannot_see_or_delete_our_images(client, db):
    a = await owner_with_business(client, "a")
    b = await owner_with_business(client, "b")
    mine = (await upload(client, a["business"]["id"], a["token"], jpeg(100, 100))).json()["asset"]
    assert (await req(client, "GET", assets(b["business"]["id"]), b["token"])).json()["assets"] == []
    res = await req(client, "DELETE", assets(b["business"]["id"], f"/{mine['id']}"), b["token"])
    assert res.status_code == 404
    assert (await req(client, "GET", assets(a["business"]["id"]), b["token"])).status_code == 404


async def test_the_database_storage_driver_round_trips(app, db):
    storage = DatabaseStorage(app.state.sessionmaker)
    key = f"{uuid.uuid4()}/{uuid.uuid4()}.webp"
    assert await storage.get(key) is None
    await storage.put(key, b"one", "image/webp")
    await storage.put(key, b"two", "image/webp")  # upsert
    assert await storage.get(key) == b"two"
    await storage.delete(key)
    assert await storage.get(key) is None


async def test_the_local_disk_storage_refuses_keys_outside_its_folder(tmp_path):
    storage = LocalDiskStorage(str(tmp_path))
    with pytest.raises(ValueError, match="invalid storage key"):
        await storage.get("../../etc/passwd")
    await storage.put("a/b.webp", b"x")
    assert await storage.get("a/b.webp") == b"x"
    assert await storage.get("a/missing.webp") is None


async def test_stock_photos_are_served_only_by_their_fixed_names(client):
    assert (await client.get("/media/stock/beauty-hero.webp")).status_code == 200
    assert (await client.get("/media/stock/beauty-hero.webp")).headers["content-type"] == "image/webp"
    assert (await client.get("/media/stock/evil.png")).status_code == 404
    assert (await client.get("/media/stock/nonexistent-hero.webp")).status_code == 404
