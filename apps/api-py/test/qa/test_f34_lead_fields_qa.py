"""F34 custom lead fields: independent QA, adversarial API tests.

Complements tests/test_lead_fields.py (the backend's own suite). Tests named after a QA-F34-xx
defect (QA section of docs/features/F34.md) are its regression tests; they were `xfail` until fixed.

Run from apps/api-py: `uv run pytest test/qa -q`.
"""

import asyncio
import logging
import uuid

import pytest
from sqlalchemy import select

from app.db import models
from app.shared.lead_fields import M as m
from tests.conftest import HEADERS, add_member, business_url, cookie, new_user, owner_with_business, req

HEB_LIMIT = "אפשר עד 20 שדות פעילים. העבירו שדה לארכיון כדי להוסיף חדש"


def fields_url(bid, tail=""):
    return business_url(bid, f"/lead-fields{tail}")


def leads_url(bid, tail=""):
    return business_url(bid, f"/leads{tail}")


async def add_field(client, bid, token, body):
    res = await req(client, "POST", fields_url(bid), token, body)
    assert res.status_code == 201, res.text
    return res.json()["field"]


async def new_lead(client, bid, token, body):
    res = await req(client, "POST", leads_url(bid), token, {"name": "דנה", "phone": "050-1234567", **body})
    return res


async def status_of(coro) -> int:
    """The HTTP status; an exception the app didn't handle is what a real server sends as 500
    (httpx's ASGI transport re-raises it instead)."""
    try:
        return (await coro).status_code
    except Exception:  # noqa: BLE001
        return 500


def clean(res):
    """Every error is the shared shape and leaks nothing internal."""
    text = res.text
    for bad in ("Traceback", "sqlalchemy", "asyncpg", "psycopg", "SELECT ", "INSERT ", "UPDATE "):
        assert bad not in text, (bad, text)
    body = res.json()
    assert set(body) == {"error"} and {"code", "message", "requestId"} <= set(body["error"])
    return body["error"]


async def team(client, db):
    o = await owner_with_business(client, "qa-owner")
    bid = o["business"]["id"]
    mgr_token, mgr_id = await new_user(client, "qa-mgr")
    emp_token, emp_id = await new_user(client, "qa-emp")
    await add_member(db, bid, mgr_id, "MANAGER")
    await add_member(db, bid, emp_id, "EMPLOYEE")
    return {
        "id": bid,
        "owner": o["token"],
        "owner_id": o["user_id"],
        "manager": mgr_token,
        "employee": emp_token,
        "employee_id": emp_id,
    }


# =========================================================================== AC7 tenant isolation


async def test_ac7_a_member_of_b_can_not_touch_a_fields_by_url_or_by_id(client, db):
    a = await owner_with_business(client, "qa-a")
    b = await owner_with_business(client, "qa-b")
    aid, bid = a["business"]["id"], b["business"]["id"]
    fa = await add_field(client, aid, a["token"], {"label": "סוד של A", "type": "text"})
    fb = await add_field(client, bid, b["token"], {"label": "של B", "type": "text"})

    # A's URL with B's session: every route is 404 (not 403), nothing leaks.
    for method, url, body in [
        ("GET", fields_url(aid), None),
        ("POST", fields_url(aid), {"label": "x", "type": "text"}),
        ("PATCH", fields_url(aid, f"/{fa['id']}"), {"label": "pwned"}),
        ("PATCH", fields_url(aid, f"/{fa['id']}"), {"archived": True}),
        ("PUT", fields_url(aid, "/order"), {"ids": [fa["id"]]}),
    ]:
        res = await req(client, method, url, b["token"], body)
        assert res.status_code == 404, (method, url, res.text)
        assert clean(res)["code"] == "NOT_FOUND"
        assert "סוד של A" not in res.text

    # A's field id on B's own URL: 404 on PATCH, stale on reorder.
    res = await req(client, "PATCH", fields_url(bid, f"/{fa['id']}"), b["token"], {"label": "pwned"})
    assert res.status_code == 404
    res = await req(client, "PUT", fields_url(bid, "/order"), b["token"], {"ids": [fa["id"]]})
    assert res.status_code == 409 and clean(res)["code"] == "CONFLICT"
    res = await req(client, "PUT", fields_url(bid, "/order"), b["token"], {"ids": [fb["id"], fa["id"]]})
    assert res.status_code == 409

    # A's field is untouched and never listed for B.
    a_fields = (await req(client, "GET", fields_url(aid), a["token"])).json()["fields"]
    assert [(f["label"], f["archivedAt"]) for f in a_fields] == [("סוד של A", None)]
    b_fields = (await req(client, "GET", fields_url(bid), b["token"])).json()["fields"]
    assert [f["id"] for f in b_fields] == [fb["id"]]

    # A's field id in customFields on B's lead (create and patch): refused per field.
    res = await new_lead(client, bid, b["token"], {"customFields": {fa["id"]: "x"}})
    assert res.status_code == 400
    assert clean(res)["fields"] == {f"customFields.{fa['id']}": m["valueUnknownField"]}
    lead = (await new_lead(client, bid, b["token"], {})).json()["lead"]
    res = await req(
        client, "PATCH", leads_url(bid, f"/{lead['id']}"), b["token"], {"customFields": {fa["id"]: "x"}}
    )
    assert res.status_code == 400
    assert clean(res)["fields"] == {f"customFields.{fa['id']}": m["valueUnknownField"]}
    # Filtering B's leads (list and export) by A's field id: 400.
    for path in ("", "/export.csv"):
        res = await client.get(
            leads_url(bid, path), params={f"cf[{fa['id']}]": "x"}, headers=cookie(b["token"])
        )
        assert res.status_code == 400
        assert clean(res)["fields"] == {f"cf[{fa['id']}]": m["filterInvalid"]}
    # Nothing was written to A's or B's leads.
    rows = (await db.execute(select(models.Lead.custom_fields))).scalars().all()
    assert rows == [{}]


async def test_ac7_unauthenticated_requests_are_refused(client):
    a = await owner_with_business(client, "qa-anon")
    aid = a["business"]["id"]
    fa = await add_field(client, aid, a["token"], {"label": "שדה", "type": "text"})
    for method, url, body in [
        ("GET", fields_url(aid), None),
        ("POST", fields_url(aid), {"label": "x", "type": "text"}),
        ("PATCH", fields_url(aid, f"/{fa['id']}"), {"label": "y"}),
        ("PUT", fields_url(aid, "/order"), {"ids": [fa["id"]]}),
    ]:
        res = await req(client, method, url, None, body)
        assert res.status_code == 401, (method, url, res.status_code)


async def test_ac7_the_walker_lists_the_four_new_routes(app):
    paths = app.openapi()["paths"]
    lf = "/api/v1/businesses/{business_id}/lead-fields"
    assert set(paths[lf]) >= {"get", "post"}
    assert "put" in paths[f"{lf}/order"]
    assert "patch" in paths[f"{lf}/{{field_id}}"]


# =========================================================================== AC1 permissions


async def test_ac1_employee_is_refused_server_side_and_changes_nothing(client, db):
    t = await team(client, db)
    f = await add_field(client, t["id"], t["owner"], {"label": "דגם", "type": "text"})
    g = await add_field(client, t["id"], t["owner"], {"label": "צבע", "type": "text"})
    emp = t["employee"]
    for method, url, body in [
        ("POST", fields_url(t["id"]), {"label": "x", "type": "text"}),
        ("PATCH", fields_url(t["id"], f"/{f['id']}"), {"label": "שונה"}),
        ("PATCH", fields_url(t["id"], f"/{f['id']}"), {"archived": True}),
        ("PATCH", fields_url(t["id"], f"/{f['id']}"), {"required": True}),
        ("PUT", fields_url(t["id"], "/order"), {"ids": [g["id"], f["id"]]}),
    ]:
        res = await req(client, method, url, emp, body)
        assert res.status_code == 403, (method, body, res.status_code)
        assert clean(res)["code"] == "FORBIDDEN"
    # The employee still reads them (needed to fill values).
    res = await req(client, "GET", fields_url(t["id"]), emp)
    assert res.status_code == 200
    got = res.json()["fields"]
    assert [(x["label"], x["required"], x["archivedAt"]) for x in got] == [
        ("דגם", False, None),
        ("צבע", False, None),
    ]


async def test_ac1_manager_adds_renames_reorders_archives_and_restores(client, db):
    t = await team(client, db)
    mgr = t["manager"]
    f = await add_field(client, t["id"], mgr, {"label": "דגם", "type": "text"})
    g = await add_field(client, t["id"], mgr, {"label": "צבע", "type": "text"})
    res = await req(client, "PATCH", fields_url(t["id"], f"/{f['id']}"), mgr, {"label": "דגם רכב"})
    assert res.status_code == 200 and res.json()["field"]["label"] == "דגם רכב"
    res = await req(client, "PUT", fields_url(t["id"], "/order"), mgr, {"ids": [g["id"], f["id"]]})
    assert res.status_code == 200 and [x["id"] for x in res.json()["fields"]] == [g["id"], f["id"]]
    res = await req(client, "PATCH", fields_url(t["id"], f"/{g['id']}"), mgr, {"archived": True})
    assert res.status_code == 200 and res.json()["field"]["archivedAt"]
    res = await req(client, "PATCH", fields_url(t["id"], f"/{g['id']}"), mgr, {"archived": False})
    assert res.status_code == 200 and res.json()["field"]["archivedAt"] is None
    # Restored goes last.
    got = (await req(client, "GET", fields_url(t["id"]), mgr)).json()["fields"]
    assert [x["id"] for x in got] == [f["id"], g["id"]]


# =========================================================================== AC2 limits


async def test_ac2_twenty_active_then_21st_and_restore_over_20_are_refused(client):
    o = await owner_with_business(client, "qa-limit")
    bid, tok = o["business"]["id"], o["token"]
    made = [await add_field(client, bid, tok, {"label": f"שדה {i}", "type": "text"}) for i in range(20)]
    res = await req(client, "POST", fields_url(bid), tok, {"label": "עשרים ואחד", "type": "text"})
    assert res.status_code == 409
    e = clean(res)
    assert e["code"] == "CONFLICT" and e["message"] == HEB_LIMIT
    # Archive one, add another (20 active again), then restoring the archived one is over the limit.
    await req(client, "PATCH", fields_url(bid, f"/{made[0]['id']}"), tok, {"archived": True})
    await add_field(client, bid, tok, {"label": "חדש", "type": "text"})
    res = await req(client, "PATCH", fields_url(bid, f"/{made[0]['id']}"), tok, {"archived": False})
    assert res.status_code == 409 and clean(res)["message"] == HEB_LIMIT
    got = (await req(client, "GET", fields_url(bid), tok)).json()["fields"]
    assert sum(1 for x in got if x["archivedAt"] is None) == 20


async def test_ac2_duplicate_labels_case_and_whitespace_insensitive(client):
    o = await owner_with_business(client, "qa-dup")
    bid, tok = o["business"]["id"], o["token"]
    await add_field(client, bid, tok, {"label": "VIP Client", "type": "boolean"})
    for label in ("vip client", "  VIP CLIENT  ", "Vip Client"):
        res = await req(client, "POST", fields_url(bid), tok, {"label": label, "type": "text"})
        assert res.status_code == 409, label
        assert clean(res)["fields"] == {"label": m["labelTaken"]}
    # Rename into a taken label is refused too.
    other = await add_field(client, bid, tok, {"label": "אחר", "type": "text"})
    res = await req(client, "PATCH", fields_url(bid, f"/{other['id']}"), tok, {"label": "vip CLIENT"})
    assert res.status_code == 409 and clean(res)["fields"] == {"label": m["labelTaken"]}


async def test_ac2_restoring_into_a_taken_label_is_refused(client):
    o = await owner_with_business(client, "qa-dup2")
    bid, tok = o["business"]["id"], o["token"]
    old = await add_field(client, bid, tok, {"label": "דגם", "type": "text"})
    await req(client, "PATCH", fields_url(bid, f"/{old['id']}"), tok, {"archived": True})
    await add_field(client, bid, tok, {"label": "דגם", "type": "text"})  # label free again
    res = await req(client, "PATCH", fields_url(bid, f"/{old['id']}"), tok, {"archived": False})
    assert res.status_code == 409 and clean(res)["fields"] == {"label": m["labelTaken"]}


async def test_ac2_concurrent_duplicate_creates_yield_exactly_one_field(client):
    o = await owner_with_business(client, "qa-race")
    bid, tok = o["business"]["id"], o["token"]
    results = await asyncio.gather(
        *[
            req(
                client,
                "POST",
                fields_url(bid),
                tok,
                {"label": ("Model", "model", " MODEL ", "MoDeL")[i % 4], "type": "text"},
            )
            for i in range(8)
        ]
    )
    codes = sorted(r.status_code for r in results)
    assert codes == [201] + [409] * 7, codes
    got = (await req(client, "GET", fields_url(bid), tok)).json()["fields"]
    assert len(got) == 1


async def test_ac2_concurrent_creates_never_pass_20(client):
    o = await owner_with_business(client, "qa-race20")
    bid, tok = o["business"]["id"], o["token"]
    for i in range(18):
        await add_field(client, bid, tok, {"label": f"שדה {i}", "type": "text"})
    results = await asyncio.gather(
        *[
            req(client, "POST", fields_url(bid), tok, {"label": f"מקביל {i}", "type": "text"})
            for i in range(6)
        ]
    )
    assert sorted(r.status_code for r in results) == [201, 201, 409, 409, 409, 409]
    got = (await req(client, "GET", fields_url(bid), tok)).json()["fields"]
    assert len(got) == 20


@pytest.mark.parametrize(
    "body,key,message",
    [
        ({"label": "", "type": "text"}, "label", m["labelRequired"]),
        ({"label": "   ", "type": "text"}, "label", m["labelRequired"]),
        ({"label": "א" * 41, "type": "text"}, "label", m["labelTooLong"]),
        ({"label": "😀" * 21, "type": "text"}, "label", m["labelTooLong"]),  # 42 UTF-16 units
        ({"label": "x", "type": "multi"}, "type", m["typeInvalid"]),
        ({"label": "x", "type": "select"}, "options", m["optionsCount"]),
        ({"label": "x", "type": "select", "options": [{"label": "א"}]}, "options", m["optionsCount"]),
        (
            {"label": "x", "type": "select", "options": [{"label": f"{i}"} for i in range(31)]},
            "options",
            m["optionsCount"],
        ),
        (
            {"label": "x", "type": "select", "options": [{"label": "Yes"}, {"label": "yes"}]},
            "options.1.label",
            m["optionDuplicate"],
        ),
        ({"label": "x", "type": "boolean", "required": True}, "required", m["booleanNotRequired"]),
        ({"label": "x", "type": "text", "min": 1}, "min", m["rangeNotAllowed"]),
        ({"label": "x", "type": "number", "min": 5, "max": 1}, "min", m["rangeInvalid"]),
        ({"label": "x", "type": "number", "min": 1e13}, "min", m["numberInvalid"]),
    ],
)
async def test_ac2_bad_definitions_are_refused_in_hebrew(client, body, key, message):
    o = await owner_with_business(client, "qa-bad")
    res = await req(client, "POST", fields_url(o["business"]["id"]), o["token"], body)
    assert res.status_code == 400, res.text
    assert clean(res)["fields"].get(key) == message, res.json()


async def test_ac2_select_with_an_empty_options_list_is_refused(client):
    o = await owner_with_business(client, "qa-sel0")
    res = await req(
        client,
        "POST",
        fields_url(o["business"]["id"]),
        o["token"],
        {"label": "סוג", "type": "select", "options": []},
    )
    assert res.status_code == 400, res.text
    assert clean(res)["fields"] == {"options": m["optionsCount"]}


async def test_ac2_an_oversized_integer_bound_is_a_400_not_a_500(client):
    o = await owner_with_business(client, "qa-bigint")
    body = {"label": "n", "type": "number", "max": 10**400}
    code = await status_of(req(client, "POST", fields_url(o["business"]["id"]), o["token"], body))
    assert code == 400, code


async def test_ac2_type_change_is_refused(client):
    o = await owner_with_business(client, "qa-type")
    bid, tok = o["business"]["id"], o["token"]
    f = await add_field(client, bid, tok, {"label": "n", "type": "number"})
    for t in ("text", "number", None):
        res = await req(client, "PATCH", fields_url(bid, f"/{f['id']}"), tok, {"type": t, "label": "z"})
        assert res.status_code == 400
        assert clean(res)["fields"]["type"] == m["typeLocked"]
    got = (await req(client, "GET", fields_url(bid), tok)).json()["fields"]
    assert got[0]["type"] == "number" and got[0]["label"] == "n"
    # Required on a checkbox via PATCH: refused.
    bx = await add_field(client, bid, tok, {"label": "b", "type": "boolean"})
    res = await req(client, "PATCH", fields_url(bid, f"/{bx['id']}"), tok, {"required": True})
    assert res.status_code == 400 and clean(res)["fields"] == {"required": m["booleanNotRequired"]}


async def test_ac2_option_ids_of_another_field_are_refused(client):
    o = await owner_with_business(client, "qa-optid")
    bid, tok = o["business"]["id"], o["token"]
    two = [{"label": "א"}, {"label": "ב"}]
    s1 = await add_field(client, bid, tok, {"label": "s1", "type": "select", "options": two})
    s2 = await add_field(client, bid, tok, {"label": "s2", "type": "select", "options": two})
    res = await req(
        client,
        "PATCH",
        fields_url(bid, f"/{s1['id']}"),
        tok,
        {"options": [{"id": s2["options"][0]["id"], "label": "א"}, {"label": "ג"}]},
    )
    assert res.status_code == 400 and clean(res)["fields"] == {"options": m["optionUnknown"]}


async def test_ac2_reorder_must_be_exactly_the_active_ids(client):
    o = await owner_with_business(client, "qa-order")
    bid, tok = o["business"]["id"], o["token"]
    a = await add_field(client, bid, tok, {"label": "a", "type": "text"})
    b = await add_field(client, bid, tok, {"label": "b", "type": "text"})
    c = await add_field(client, bid, tok, {"label": "c", "type": "text"})
    await req(client, "PATCH", fields_url(bid, f"/{c['id']}"), tok, {"archived": True})
    for ids, code in [
        ([a["id"]], 409),
        ([a["id"], b["id"], c["id"]], 409),  # includes an archived one
        ([a["id"], a["id"]], 400),
        (["not-a-uuid", b["id"]], 400),
        ("x", 400),
    ]:
        res = await req(client, "PUT", fields_url(bid, "/order"), tok, {"ids": ids})
        assert res.status_code == code, (ids, res.text)
        clean(res)
    res = await req(client, "PUT", fields_url(bid, "/order"), tok, {"ids": [b["id"], a["id"]]})
    assert res.status_code == 200
    assert [(x["label"], x["position"]) for x in res.json()["fields"] if not x["archivedAt"]] == [
        ("b", 0),
        ("a", 1),
    ]


# =========================================================================== AC3 values


async def _all_types(client, bid, tok):
    return {
        "text": await add_field(client, bid, tok, {"label": "טקסט", "type": "text"}),
        "number": await add_field(
            client, bid, tok, {"label": "מספר", "type": "number", "min": -5, "max": 2.5}
        ),
        "date": await add_field(client, bid, tok, {"label": "תאריך", "type": "date"}),
        "select": await add_field(
            client,
            bid,
            tok,
            {"label": "בחירה", "type": "select", "options": [{"label": "א"}, {"label": "ב"}]},
        ),
        "boolean": await add_field(client, bid, tok, {"label": "סימון", "type": "boolean"}),
    }


async def test_ac3_values_are_normalised_and_bounds_inclusive(client):
    o = await owner_with_business(client, "qa-vals")
    bid, tok = o["business"]["id"], o["token"]
    f = await _all_types(client, bid, tok)
    res = await new_lead(
        client,
        bid,
        tok,
        {
            "customFields": {
                f["text"]["id"]: "  שורה 1\r\n\n  שורה 2\tסוף  ",
                f["number"]["id"]: "2.5",
                f["date"]["id"]: "2028-02-29",
                f["select"]["id"]: f["select"]["options"][1]["id"],
                f["boolean"]["id"]: False,
            }
        },
    )
    assert res.status_code == 201, res.text
    cf = res.json()["lead"]["customFields"]
    assert cf == {
        f["text"]["id"]: "שורה 1 שורה 2\tסוף",
        f["number"]["id"]: 2.5,
        f["date"]["id"]: "2028-02-29",
        f["select"]["id"]: f["select"]["options"][1]["id"],
    }  # unticked checkbox = no value (D-204)
    lead_id = res.json()["lead"]["id"]
    for value, ok in [(-5, True), (-5.01, False), (2.51, False), (0, True), ("1e3", False), (True, False)]:
        r = await req(
            client, "PATCH", leads_url(bid, f"/{lead_id}"), tok, {"customFields": {f["number"]["id"]: value}}
        )
        assert (r.status_code == 200) is ok, (value, r.text)
        if not ok:
            assert f"customFields.{f['number']['id']}" in clean(r)["fields"]
    # Whole numbers come back as integers, never `true`.
    r = await req(client, "GET", leads_url(bid, f"/{lead_id}"), tok)
    assert r.json()["lead"]["customFields"][f["number"]["id"]] == 0
    # 500 chars ok, 501 refused; invalid dates refused.
    for value, ok in [("א" * 500, True), ("א" * 501, False), ("2027-02-29", False), ("27-01-01", False)]:
        key = f["text"]["id"] if value.startswith("א") else f["date"]["id"]
        r = await req(client, "PATCH", leads_url(bid, f"/{lead_id}"), tok, {"customFields": {key: value}})
        assert (r.status_code == 200) is ok, (value[:10], r.text)


async def test_ac3_errors_never_echo_the_value(client):
    o = await owner_with_business(client, "qa-echo")
    bid, tok = o["business"]["id"], o["token"]
    f = await _all_types(client, bid, tok)
    marker = "SECRET-PLATE-" + "9" * 500
    res = await new_lead(
        client, bid, tok, {"customFields": {f["text"]["id"]: marker, f["select"]["id"]: marker[:30]}}
    )
    assert res.status_code == 400
    assert "SECRET-PLATE" not in res.text
    assert clean(res)["fields"] == {
        f"customFields.{f['text']['id']}": m["valueTextTooLong"],
        f"customFields.{f['select']['id']}": m["valueOption"],
    }


@pytest.mark.parametrize("bad", [{"nested": 1}, [1, 2], None])
async def test_ac3_non_scalar_values_and_shapes_are_refused(client, bad):
    o = await owner_with_business(client, "qa-shape")
    bid, tok = o["business"]["id"], o["token"]
    f = await add_field(client, bid, tok, {"label": "t", "type": "text"})
    if bad is None:
        body = {"customFields": None}
    else:
        body = {"customFields": {f["id"]: bad}}
    res = await new_lead(client, bid, tok, body)
    assert res.status_code == 400
    assert "customFields" in clean(res)["fields"]


async def test_ac3_too_many_keys_is_refused(client):
    o = await owner_with_business(client, "qa-keys")
    bid, tok = o["business"]["id"], o["token"]
    res = await new_lead(client, bid, tok, {"customFields": {str(uuid.uuid4()): "x" for _ in range(101)}})
    assert res.status_code == 400 and clean(res)["fields"] == {"customFields": m["tooManyValues"]}


def raw_post(client, url, tok, raw: str):
    """A JSON body written by hand, so it can carry a lone surrogate escape."""
    return client.post(
        url, content=raw.encode(), headers={**HEADERS, **cookie(tok), "content-type": "application/json"}
    )


async def test_qa_f34_03_nul_and_lone_surrogates_in_values_are_400_in_hebrew(client):
    o = await owner_with_business(client, "qa-nul")
    bid, tok = o["business"]["id"], o["token"]
    f = await add_field(client, bid, tok, {"label": "t", "type": "text"})
    key = f"customFields.{f['id']}"
    res = await new_lead(client, bid, tok, {"customFields": {f["id"]: "a\u0000b"}})
    assert res.status_code == 400 and clean(res)["fields"] == {key: m["invalidCharacters"]}
    raw = '{"name":"דנה","phone":"050-1234567","customFields":{"' + f["id"] + '":"a\\ud800b"}}'
    res = await raw_post(client, leads_url(bid), tok, raw)
    assert res.status_code == 400 and clean(res)["fields"] == {key: m["invalidCharacters"]}
    # On the lead card (PATCH) too.
    lead = (await new_lead(client, bid, tok, {})).json()["lead"]
    res = await req(
        client, "PATCH", leads_url(bid, f"/{lead['id']}"), tok, {"customFields": {f["id"]: "x\u0000"}}
    )
    assert res.status_code == 400 and clean(res)["fields"] == {key: m["invalidCharacters"]}
    # A text filter with NUL is a 400, not a 500.
    code = await status_of(
        client.get(leads_url(bid), params={f"cf[{f['id']}]": "a\u0000"}, headers=cookie(tok))
    )
    assert code == 400, code


async def test_ac3_an_oversized_integer_value_is_a_400_not_a_500(client):
    o = await owner_with_business(client, "qa-bigval")
    bid, tok = o["business"]["id"], o["token"]
    f = await add_field(client, bid, tok, {"label": "n", "type": "number"})
    code = await status_of(new_lead(client, bid, tok, {"customFields": {f["id"]: 10**400}}))
    assert code == 400, code


async def test_qa_f34_03_nul_and_lone_surrogates_in_labels_are_400_in_hebrew(client):
    o = await owner_with_business(client, "qa-nul-label")
    bid, tok = o["business"]["id"], o["token"]
    res = await req(client, "POST", fields_url(bid), tok, {"label": "a\u0000b", "type": "text"})
    assert res.status_code == 400 and clean(res)["fields"] == {"label": m["invalidCharacters"]}
    res = await raw_post(client, fields_url(bid), tok, '{"label":"a\\udc00","type":"text"}')
    assert res.status_code == 400 and clean(res)["fields"] == {"label": m["invalidCharacters"]}
    body = {"label": "s", "type": "select", "options": [{"label": "א\u0000"}, {"label": "ב"}]}
    res = await req(client, "POST", fields_url(bid), tok, body)
    assert res.status_code == 400 and clean(res)["fields"] == {"options.0.label": m["invalidCharacters"]}
    f = await add_field(client, bid, tok, {"label": "ok", "type": "text"})
    res = await req(client, "PATCH", fields_url(bid, f"/{f['id']}"), tok, {"label": "x\u0000"})
    assert res.status_code == 400 and clean(res)["fields"] == {"label": m["invalidCharacters"]}
    got = (await req(client, "GET", fields_url(bid), tok)).json()["fields"]
    assert [x["label"] for x in got] == ["ok"]


async def test_qa_f34_01_empty_options_ok_for_non_select_types(client):
    """Shared accepts `options: []` for non-select types; the API agrees and stores none."""
    o = await owner_with_business(client, "qa-opt-empty")
    bid, tok = o["business"]["id"], o["token"]
    for t in ("text", "number", "date", "boolean"):
        res = await req(client, "POST", fields_url(bid), tok, {"label": t, "type": t, "options": []})
        assert res.status_code == 201, (t, res.text)
        assert res.json()["field"]["options"] == []


# =========================================================================== D-205 required


async def test_d205_required_on_create_edit_and_quick_add(client, db):
    t = await team(client, db)
    bid, tok = t["id"], t["owner"]
    req_text = await add_field(client, bid, tok, {"label": "דגם", "type": "text", "required": True})
    num = await add_field(client, bid, tok, {"label": "n", "type": "number", "max": 10})
    # An old lead (before the field became required) stays editable without it.
    old = (await new_lead(client, bid, tok, {"skipRequiredCustomFields": True})).json()["lead"]
    res = await req(client, "PATCH", leads_url(bid, f"/{old['id']}"), tok, {"message": "עדכון"})
    assert res.status_code == 200
    res = await req(client, "PATCH", leads_url(bid, f"/{old['id']}"), tok, {"customFields": {num["id"]: 3}})
    assert res.status_code == 200
    # Full create: required, whitespace counts as empty.
    for cf in ({}, {req_text["id"]: "   "}, {req_text["id"]: None}, {req_text["id"]: "\n"}):
        res = await new_lead(client, bid, tok, {"customFields": cf})
        assert res.status_code == 400
        assert clean(res)["fields"] == {f"customFields.{req_text['id']}": m["valueRequired"]}
    lead = (await new_lead(client, bid, tok, {"customFields": {req_text["id"]: "מאזדה"}})).json()["lead"]
    # Lead card can't clear it, in any spelling, for any role.
    for who in (tok, t["manager"]):
        for empty in (None, "", "  "):
            body = {"customFields": {req_text["id"]: empty}}
            res = await req(client, "PATCH", leads_url(bid, f"/{lead['id']}"), who, body)
            assert res.status_code == 400, (empty, res.text)
            assert clean(res)["fields"] == {f"customFields.{req_text['id']}": m["valueRequired"]}
    # Quick add: required skipped; an empty value is fine; an invalid value still refused.
    body = {"skipRequiredCustomFields": True, "customFields": {req_text["id"]: ""}}
    res = await new_lead(client, bid, tok, body)
    assert res.status_code == 201 and res.json()["lead"]["customFields"] == {}
    body = {"skipRequiredCustomFields": True, "customFields": {num["id"]: 11}}
    res = await new_lead(client, bid, tok, body)
    assert res.status_code == 400 and f"customFields.{num['id']}" in clean(res)["fields"]
    # Employees can use the flag too (their own lead).
    res = await new_lead(client, bid, t["employee"], {"skipRequiredCustomFields": True})
    assert res.status_code == 201


# =========================================================================== AC4 rename / archive


async def test_ac4_rename_archive_restore_keep_values_and_archived_values_are_read_only(client):
    o = await owner_with_business(client, "qa-arch")
    bid, tok = o["business"]["id"], o["token"]
    sel = await add_field(
        client, bid, tok, {"label": "סוג", "type": "select", "options": [{"label": "א"}, {"label": "ב"}]}
    )
    txt = await add_field(client, bid, tok, {"label": "רכב", "type": "text"})
    a, b = (x["id"] for x in sel["options"])
    body = {"customFields": {sel["id"]: a, txt["id"]: "מאזדה"}}
    lead = (await new_lead(client, bid, tok, body)).json()["lead"]
    url = leads_url(bid, f"/{lead['id']}")
    sel_url = fields_url(bid, f"/{sel['id']}")
    # Rename field and option: value unchanged, by id.
    await req(client, "PATCH", sel_url, tok, {"label": "סוג טיפול"})
    res = await req(
        client, "PATCH", sel_url, tok, {"options": [{"id": a, "label": "פנים"}, {"id": b, "label": "ב"}]}
    )
    assert [x["label"] for x in res.json()["field"]["options"]] == ["פנים", "ב"]
    assert (await req(client, "GET", url, tok)).json()["lead"]["customFields"][sel["id"]] == a
    # Archive option a: the value stays, can be sent back unchanged, can't be newly chosen.
    await req(client, "PATCH", sel_url, tok, {"options": [{"id": b, "label": "ב"}, {"label": "ג"}]})
    assert (await req(client, "GET", url, tok)).json()["lead"]["customFields"][sel["id"]] == a
    assert (await req(client, "PATCH", url, tok, {"customFields": {sel["id"]: a}})).status_code == 200
    other = (await new_lead(client, bid, tok, {"phone": "050-7777777"})).json()["lead"]
    r = await req(client, "PATCH", leads_url(bid, f"/{other['id']}"), tok, {"customFields": {sel["id"]: a}})
    assert r.status_code == 400 and clean(r)["fields"] == {f"customFields.{sel['id']}": m["valueOption"]}
    # Archive the text field: the value still shows; changing or clearing it is refused.
    await req(client, "PATCH", fields_url(bid, f"/{txt['id']}"), tok, {"archived": True})
    assert (await req(client, "GET", url, tok)).json()["lead"]["customFields"][txt["id"]] == "מאזדה"
    archived_err = {f"customFields.{txt['id']}": m["valueArchivedField"]}
    for v in ("טויוטה", None):
        r = await req(client, "PATCH", url, tok, {"customFields": {txt["id"]: v}})
        assert r.status_code == 400 and clean(r)["fields"] == archived_err
    assert (await req(client, "PATCH", url, tok, {"customFields": {txt["id"]: "מאזדה"}})).status_code == 200
    # Archived: refused on New lead and in filters.
    r = await new_lead(client, bid, tok, {"phone": "050-8888888", "customFields": {txt["id"]: "x"}})
    assert r.status_code == 400 and clean(r)["fields"] == archived_err
    r = await client.get(leads_url(bid), params={f"cf[{txt['id']}]": "מאזדה"}, headers=cookie(tok))
    assert r.status_code == 400
    # Restore: value still there and filterable.
    await req(client, "PATCH", fields_url(bid, f"/{txt['id']}"), tok, {"archived": False})
    r = await client.get(leads_url(bid), params={f"cf[{txt['id']}]": "מאז"}, headers=cookie(tok))
    assert r.status_code == 200 and [x["id"] for x in r.json()["leads"]] == [lead["id"]]


# =========================================================================== AC6 filters


async def test_ac6_employee_filter_never_widens_visibility_and_21_filters_are_refused(client, db):
    t = await team(client, db)
    bid, tok, emp = t["id"], t["owner"], t["employee"]
    txt = await add_field(client, bid, tok, {"label": "רכב", "type": "text"})
    await new_lead(client, bid, tok, {"phone": "050-1000001", "customFields": {txt["id"]: "מאזדה של הבעלים"}})
    await new_lead(client, bid, emp, {"phone": "050-1000002", "customFields": {txt["id"]: "מאזדה של העובד"}})
    cf = {f"cf[{txt['id']}]": "מאזדה"}
    r = await client.get(leads_url(bid), params=cf, headers=cookie(emp))
    assert r.status_code == 200
    assert [x["customFields"][txt["id"]] for x in r.json()["leads"]] == ["מאזדה של העובד"]
    # Employees can't export at all.
    r = await client.get(leads_url(bid, "/export.csv"), params=cf, headers=cookie(emp))
    assert r.status_code == 403
    # 21 distinct cf filters → 400 (at most 20).
    params = {f"cf[{uuid.uuid4()}]": "x" for _ in range(21)}
    r = await client.get(leads_url(bid), params=params, headers=cookie(tok))
    assert r.status_code == 400 and clean(r)["code"] == "VALIDATION_ERROR"
    # SQL-looking filter text is just text.
    r = await client.get(leads_url(bid), params={f"cf[{txt['id']}]": "' OR 1=1 --"}, headers=cookie(tok))
    assert r.status_code == 200 and r.json()["leads"] == []


# =========================================================================== AC8 history / export


async def test_ac8_history_only_on_real_changes_and_export_active_columns_only(client, db):
    t = await team(client, db)
    bid, tok = t["id"], t["owner"]
    txt = await add_field(client, bid, tok, {"label": '=HYPERLINK("x")', "type": "text"})
    gone = await add_field(client, bid, tok, {"label": "ישן", "type": "text"})
    body = {"customFields": {txt["id"]: "@SUM(1)", gone["id"]: "ערך ישן"}}
    lead = (await new_lead(client, bid, tok, body)).json()["lead"]
    url = leads_url(bid, f"/{lead['id']}")
    await req(client, "PATCH", url, tok, {"customFields": {txt["id"]: "@SUM(1)"}})  # no change
    await req(client, "PATCH", url, tok, {"customFields": {txt["id"]: "חדש"}})
    q = select(models.Activity).where(
        models.Activity.lead_id == uuid.UUID(lead["id"]), models.Activity.type == "lead.updated"
    )
    acts = (await db.execute(q)).scalars().all()
    assert len(acts) == 1
    assert acts[0].data == {
        "fields": ["customFields"],
        "customFields": [{"fieldId": txt["id"], "from": "@SUM(1)", "to": "חדש"}],
    }
    await req(client, "PATCH", fields_url(bid, f"/{gone['id']}"), tok, {"archived": True})
    r = await client.get(leads_url(bid, "/export.csv"), headers=cookie(tok))
    assert r.status_code == 200
    head = r.content.decode("utf-8-sig").split("\r\n")[0]
    assert "ישן" not in head
    assert head.endswith('"\'=HYPERLINK(""x"")"'), head  # CSV injection escaped in the header too
    # Manager has no leads.export (OWNER only in the matrix).
    assert (await client.get(leads_url(bid, "/export.csv"), headers=cookie(t["manager"]))).status_code == 403


# =========================================================================== privacy


async def test_privacy_values_never_logged_even_on_errors(client, caplog):
    o = await owner_with_business(client, "qa-log")
    bid, tok = o["business"]["id"], o["token"]
    f = await add_field(client, bid, tok, {"label": "t", "type": "text"})
    secret = "TZ-039999999"
    with caplog.at_level(logging.DEBUG):
        await new_lead(client, bid, tok, {"customFields": {f["id"]: secret}})
        await new_lead(client, bid, tok, {"customFields": {f["id"]: secret + "x" * 600}})  # validation error
        await status_of(new_lead(client, bid, tok, {"customFields": {f["id"]: secret + "\u0000"}}))
        await client.get(leads_url(bid), params={f"cf[{f['id']}]": secret}, headers=cookie(tok))
    server = [
        r.getMessage() + (logging.Formatter().formatException(r.exc_info) if r.exc_info else "")
        for r in caplog.records
        if not r.name.startswith(("httpx", "httpcore"))
    ]
    leaked = [line[:200] for line in server if secret in line]
    assert not leaked, leaked


# =========================================================================== AC5 external sources


async def test_ac5_a_website_form_lead_ignores_required_fields_and_forged_custom_keys(
    client, public, settings, db
):
    """The public site form: a required field never blocks it, and a visitor can't write custom
    values by adding `customFields[...]` / a field id to the form post."""
    from tests.test_public_site import live_site, submit, valid

    o = await live_site(client)
    f = await add_field(client, o["id"], o["token"], {"label": "דגם", "type": "text", "required": True})
    forged = {f["id"]: "FORGED", f"customFields[{f['id']}]": "FORGED", "customFields": "FORGED"}
    res = await submit(public, settings, "salon", valid(settings, o["contact_id"], **forged))
    assert res.status_code == 200 and "תודה!" in res.text
    lead = (await db.execute(select(models.Lead))).scalar_one()
    assert lead.source == models.LeadSource.WEBSITE_FORM and lead.custom_fields == {}
