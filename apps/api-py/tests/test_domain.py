"""Domain expiry reminders (F33), ported from the Node domain tests (service and registry readers)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update

from app.db import models
from app.deps import TenantContext
from app.integrations.domain import (
    DomainLookup,
    IsocWhoisLookup,
    MemoryDomainExpiry,
    RdapLookup,
    create_domain_expiry,
    expiry_from_isoc_whois,
    expiry_from_rdap,
)
from app.modules.domain.service import DomainExpiryService, days_until, reminder_due
from app.shared.domain import registrable_domain
from tests.conftest import add_member, business_url, make_settings, new_user, owner_with_business, req

DAY = timedelta(days=1)
NOW = datetime(2026, 11, 23, 12, 0, tzinfo=UTC)


def in_days(n):
    return NOW + n * DAY


def ok(expires):
    return DomainLookup("ok", expires)


@pytest.fixture
def provider(app) -> MemoryDomainExpiry:
    return app.state.domain_expiry


@pytest.fixture
def service(app, db, provider, email):
    st = app.state
    return DomainExpiryService(db, provider, email, st.settings, st.sessionmaker)


async def with_site(client, db, url="https://www.shiran.co.il/"):
    o = await owner_with_business(client, "dom")
    await db.execute(
        update(models.Business).where(models.Business.id == o["business"]["id"]).values(website_url=url)
    )
    await db.commit()
    return o


async def row(db, bid):
    db.expire_all()
    b = (await db.execute(select(models.Business).where(models.Business.id == bid))).scalar_one()
    return b


def mails(email):
    return [m for m in email.sent if "shiran.co.il" in m.subject]


async def bell(db, bid):
    rows = await db.execute(
        select(models.Notification).where(
            models.Notification.business_id == bid, models.Notification.type == "domain.expiring"
        )
    )
    return rows.scalars().all()


# --------------------------------------------------------------------------- reading the registries


def test_domains_are_reduced_to_their_registrable_part():
    assert registrable_domain("https://www.shiran.co.il/about") == "shiran.co.il"
    assert (
        registrable_domain("shiran.com") == "shiran.com"
        and registrable_domain("a.b.example.org") == "example.org"
    )
    assert registrable_domain("blog.bbc.co.uk") == "bbc.co.uk"
    for bad in (None, "", "localhost", "http://127.0.0.1", "co.il", "not a domain", "http://"):
        assert registrable_domain(bad) is None


def test_the_expiry_is_read_from_rdap_and_isoc_answers():
    assert expiry_from_rdap(
        {
            "events": [
                {"eventAction": "registration", "eventDate": "1995-08-14T04:00:00Z"},
                {"eventAction": "expiration", "eventDate": "2027-08-13T04:00:00Z"},
            ]
        }
    ) == datetime(2027, 8, 13, 4, tzinfo=UTC)
    for bad in (
        {"events": []},
        {"events": [{"eventAction": "expiration", "eventDate": "soon"}]},
        None,
        "nope",
    ):
        assert expiry_from_rdap(bad) is None
    assert expiry_from_isoc_whois("domain:  walla.co.il\nvalidity:     17-01-2027\nstatus: x") == datetime(
        2027, 1, 17, tzinfo=UTC
    )
    assert (
        expiry_from_isoc_whois("no such domain") is None
        and expiry_from_isoc_whois("validity:     31-02-2027") is None
    )


BOOTSTRAP = {
    "services": [
        [["com", "net"], ["https://rdap.example-registry.test/com/v1/"]],
        [["dev"], ["http://insecure.test/", "https://rdap.dev.test/"]],
    ]
}


def rdap_client(answer):
    urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        if "dns.json" in str(request.url):
            return httpx.Response(200, json=BOOTSTRAP)
        result = answer()
        if isinstance(result, Exception):
            raise result
        return result

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), urls


async def test_rdap_asks_the_registry_the_bootstrap_names_and_reads_the_date():
    client, urls = rdap_client(
        lambda: httpx.Response(
            200, json={"events": [{"eventAction": "expiration", "eventDate": "2027-08-13T04:00:00Z"}]}
        )
    )
    rdap = RdapLookup(client)
    assert await rdap.lookup("example.com") == DomainLookup("ok", datetime(2027, 8, 13, 4, tzinfo=UTC))
    assert urls[-1] == "https://rdap.example-registry.test/com/v1/domain/example.com"
    await rdap.lookup("x.dev")  # prefers https
    assert urls[-1] == "https://rdap.dev.test/domain/x.dev"
    assert len([u for u in urls if "dns.json" in u]) == 1  # the bootstrap is fetched once
    assert await rdap.supports("a.com") and not await rdap.supports("a.xyz")


async def test_rdap_says_unsupported_for_unserved_endings_and_failed_for_any_trouble():
    client, _ = rdap_client(lambda: httpx.Response(404, json={}))
    rdap = RdapLookup(client)
    assert (await rdap.lookup("shiran.xyz")).status == "unsupported"
    assert (await rdap.lookup("missing.com")).status == "failed"
    down, _ = rdap_client(lambda: httpx.ConnectError("network down"))
    assert (await RdapLookup(down).lookup("example.com")).status == "failed"
    odd, _ = rdap_client(lambda: httpx.Response(200, json={"events": []}))
    assert (await RdapLookup(odd).lookup("example.com")).status == "failed"


ISOC = "% header\nquery:        walla.co.il\ndomain:       walla.co.il\nassigned:     17-01-2019\nvalidity:     17-01-2027\nDNSSEC:       unsigned\n"


async def _serve(handler):
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


async def test_the_isoc_whois_lookup_sends_the_domain_and_reads_the_validity_over_a_real_socket():
    asked = []

    async def handler(reader, writer):
        asked.append((await reader.readline()).decode().strip())
        writer.write(ISOC.encode())
        await writer.drain()
        writer.close()

    server, port = await _serve(handler)
    try:
        result = await IsocWhoisLookup("127.0.0.1", port, 2).lookup("walla.co.il")
    finally:
        server.close()
    assert result == DomainLookup("ok", datetime(2027, 1, 17, tzinfo=UTC)) and asked == ["walla.co.il"]


async def test_the_isoc_lookup_fails_without_a_date_when_the_server_stalls_or_nothing_listens():
    async def empty(reader, writer):
        await reader.readline()
        writer.write(b"% No entries found\n")
        await writer.drain()
        writer.close()

    server, port = await _serve(empty)
    try:
        assert (await IsocWhoisLookup("127.0.0.1", port, 2).lookup("nope.co.il")).status == "failed"
    finally:
        server.close()

    open_writers = []

    async def stall(reader, writer):
        open_writers.append(writer)  # never answers
        await asyncio.Event().wait()

    server, port = await _serve(stall)
    try:
        assert (await IsocWhoisLookup("127.0.0.1", port, 0.3).lookup("slow.co.il")).status == "failed"
    finally:
        for w in open_writers:
            w.close()
        server.close()
    assert (await IsocWhoisLookup("127.0.0.1", 1, 0.3).lookup("closed.co.il")).status == "failed"


def test_the_off_mode_never_touches_the_network():
    assert isinstance(create_domain_expiry(make_settings(DOMAIN_LOOKUP="off")), MemoryDomainExpiry)


# --------------------------------------------------------------------------- reminders


def test_picks_the_tightest_reminder_that_is_due():
    assert [reminder_due(d) for d in (200, 61, 60, 59, 30, 29, 8, 7, 6, 1, 0, -3)] == [
        None,
        None,
        60,
        60,
        30,
        30,
        30,
        7,
        7,
        7,
        0,
        0,
    ]
    assert days_until(NOW + timedelta(days=6.2), NOW) == 7


async def test_reads_the_date_and_reminds_once_per_threshold_with_the_bell_and_an_email(
    client, db, service, provider, email
):
    o = await with_site(client, db)
    bid = uuid.UUID(o["business"]["id"])
    provider.set("shiran.co.il", ok(in_days(200)))
    await service.check(bid, NOW)
    assert provider.asked == ["shiran.co.il"]
    b = await row(db, bid)
    assert b.domain_check == "ok" and b.domain_reminded_days is None and await bell(db, bid) == []

    # 25 days left: the 30-day reminder, once, however often it is looked at.
    provider.set("shiran.co.il", ok(in_days(25)))
    await service.check(bid, NOW)
    await service.check(bid, NOW + timedelta(hours=20))
    assert len(await bell(db, bid)) == 1 and len(mails(email)) == 1 and "25" in mails(email)[0].subject
    assert (await row(db, bid)).domain_reminded_days == 30
    assert "ימים" in mails(email)[0].subject

    # A week before, then the day itself, then after it passed: each once.
    await service.check(bid, in_days(19))
    assert len(await bell(db, bid)) == 2
    await service.check(bid, in_days(25))
    await service.check(bid, in_days(27))
    assert len(await bell(db, bid)) == 3 and len(mails(email)) == 3
    assert [m.subject.split(" פג בעוד ")[1] for m in mails(email)] == ["25 ימים", "6 ימים", "0 ימים"]
    assert (await bell(db, bid))[0].data["domain"] == "shiran.co.il"


async def test_the_email_writes_the_expiry_date_in_the_business_language(
    client, db, service, provider, email
):
    o = await with_site(client, db)
    bid = uuid.UUID(o["business"]["id"])
    provider.set("shiran.co.il", ok(datetime(2027, 1, 17, tzinfo=UTC)))
    await service.check(bid, datetime(2027, 1, 10, tzinfo=UTC))
    assert "17 בינואר 2027" in mails(email)[0].text
    await db.execute(
        update(models.Business)
        .where(models.Business.id == bid)
        .values(language="en", domain_reminded_days=None)
    )
    await db.commit()
    email.clear()
    await service.check(bid, datetime(2027, 1, 10, tzinfo=UTC))
    assert "17 January 2027" in mails(email)[0].text and mails(email)[0].subject.startswith("Your domain")


async def test_a_renewal_starts_the_reminders_over(client, db, service, provider):
    o = await with_site(client, db)
    bid = uuid.UUID(o["business"]["id"])
    provider.set("shiran.co.il", ok(in_days(5)))
    await service.check(bid, NOW)
    assert (await row(db, bid)).domain_reminded_days == 7
    provider.set("shiran.co.il", ok(in_days(5 + 365)))
    await service.check(bid, in_days(1))
    b = await row(db, bid)
    assert b.domain_check == "ok" and b.domain_reminded_days is None
    await service.check(bid, in_days(340))
    assert len(await bell(db, bid)) == 2  # 7 days before the first expiry, 60 before the new one


async def test_an_unsupported_ending_is_said_so_and_a_silent_registry_keeps_the_old_date(
    client, db, service, provider
):
    o = await with_site(client, db, "https://example.xyz")
    await service.check(uuid.UUID(o["business"]["id"]), NOW)
    b = await row(db, o["business"]["id"])
    assert b.domain_check == "unsupported" and b.domain_expires_at is None

    p = await with_site(client, db)
    pid = uuid.UUID(p["business"]["id"])
    provider.set("shiran.co.il", ok(in_days(100)))
    await service.check(pid, NOW)
    provider.set("shiran.co.il", DomainLookup("failed"))
    await service.check(pid, in_days(1))
    r = await row(db, pid)
    assert r.domain_check == "ok" and r.domain_expires_at == in_days(100)
    # With no date yet, a failure is a failure.
    q = await with_site(client, db)
    qid = uuid.UUID(q["business"]["id"])
    provider.set("shiran.co.il", DomainLookup("failed"))
    await service.check(qid, NOW)
    r = await row(db, qid)
    assert r.domain_check == "failed" and r.domain_expires_at is None


async def test_the_daily_job_asks_only_about_domains_not_asked_lately_and_only_with_a_website(
    client, db, service, provider
):
    a, b = await with_site(client, db), await with_site(client, db)
    await with_site(client, db, None)
    provider.set("shiran.co.il", ok(in_days(300)))
    assert await service.check_due(NOW) == 2
    assert await service.check_due(NOW + timedelta(hours=1)) == 0
    assert await service.check_due(NOW + timedelta(hours=21)) == 2
    assert (await row(db, a["business"]["id"])).domain_check == "ok" and (
        await row(db, b["business"]["id"])
    ).domain_check == "ok"


async def test_changing_the_website_address_forgets_the_old_domain(client, db, service, provider):
    o = await with_site(client, db)
    bid = uuid.UUID(o["business"]["id"])
    provider.set("shiran.co.il", ok(in_days(5)))
    await service.check(bid, NOW)
    res = await req(
        client, "PATCH", business_url(o["business"]["id"]), o["token"], {"websiteUrl": "https://another.com"}
    )
    assert res.status_code == 200
    b = await row(db, bid)
    assert (b.domain_check, b.domain_expires_at, b.domain_checked_at, b.domain_reminded_days) == (
        None,
        None,
        None,
        None,
    )


async def test_opening_the_screen_starts_the_lookup_by_itself_and_the_date_appears(client, db, provider):
    o = await with_site(client, db)
    url = business_url(o["business"]["id"], "/domain")
    provider.set("shiran.co.il", ok(datetime.now(UTC) + 40 * DAY))

    async def get():
        return (await req(client, "GET", url, o["token"])).json()

    first = await get()
    assert first["domain"] == "shiran.co.il"
    assert first["checking"] if first["check"] is None else first["check"] == "ok"
    later = first
    for _ in range(80):
        if later["check"] is not None:
            break
        await asyncio.sleep(0.025)
        later = await get()
    assert later["check"] == "ok" and later["checking"] is False and later["daysLeft"] > 30
    await get()
    assert provider.asked == ["shiran.co.il"]


async def test_opening_again_later_asks_only_when_the_answer_is_a_day_old_or_failed_a_while_ago(
    client, db, app, provider, email
):
    o = await with_site(client, db)
    bid = uuid.UUID(o["business"]["id"])
    ctx = TenantContext(business_id=bid, user_id=uuid.UUID(o["user_id"]), role="OWNER")
    st = app.state
    svc = DomainExpiryService(db, provider, email, st.settings, st.sessionmaker)

    async def settle():
        await asyncio.sleep(0.25)

    provider.set("shiran.co.il", DomainLookup("failed"))
    await svc.status_and_refresh(ctx, NOW)
    await settle()
    assert (await row(db, bid)).domain_check == "failed" and len(provider.asked) == 1
    await svc.status_and_refresh(ctx, NOW + timedelta(minutes=5))  # too soon to try a failure again
    await settle()
    assert len(provider.asked) == 1
    provider.set("shiran.co.il", ok(in_days(300)))
    await svc.status_and_refresh(ctx, NOW + timedelta(minutes=15))
    await settle()
    assert len(provider.asked) == 2
    await svc.status_and_refresh(ctx, NOW + timedelta(hours=3))
    await settle()
    assert len(provider.asked) == 2
    await svc.status_and_refresh(ctx, NOW + timedelta(hours=25))
    await settle()
    assert len(provider.asked) == 3


async def test_a_business_without_a_website_asks_nothing(client, db, provider):
    o = await with_site(client, db, None)
    res = await req(client, "GET", business_url(o["business"]["id"], "/domain"), o["token"])
    assert res.json() == {
        "domain": None,
        "check": None,
        "expiresAt": None,
        "checkedAt": None,
        "daysLeft": None,
        "checking": False,
    }
    assert provider.asked == []


async def test_anyone_in_the_business_sees_it_only_the_owner_looks_it_up_now_outsiders_get_nothing(
    client, db, provider
):
    o = await with_site(client, db)
    bid = o["business"]["id"]
    emp_token, emp_id = await new_user(client, "emp")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    stranger, _ = await new_user(client, "str")
    provider.set("shiran.co.il", ok(datetime.now(UTC) + 40 * DAY))
    url = business_url(bid, "/domain")

    before = await req(client, "GET", url, emp_token)
    assert before.status_code == 200 and before.json()["domain"] == "shiran.co.il"
    assert (await req(client, "POST", url, emp_token)).status_code == 403
    assert (await req(client, "GET", url, stranger)).status_code == 404

    now = await req(client, "POST", url, o["token"])
    assert now.status_code == 200 and now.json()["domain"] == "shiran.co.il" and now.json()["check"] == "ok"
    assert now.json()["daysLeft"] > 30
    await req(client, "POST", url, o["token"])  # pressing it again straight away doesn't ask again
    assert len(provider.asked) <= 2
    assert (await req(client, "GET", url, emp_token)).json()["check"] == "ok"
