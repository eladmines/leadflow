"""F34 custom lead fields (D-203, D-204): definitions, values on leads, filters, history, export,
privacy, and the port of packages/shared/src/leadFields.ts (same rules, same Hebrew messages)."""

import json
import logging
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.log_privacy import DropQueryString
from app.db import models
from app.modules.embed.routes import LEAD_PATH
from app.modules.lead_fields.service import LeadFieldService
from app.shared import lead_fields as lf
from app.shared.lead_fields import (
    LeadFieldOptionRule,
    LeadFieldRule,
    apply_custom_fields_patch,
    diff_custom_fields,
    is_valid_iso_date,
    js_number_str,
    parse_lead_field_filter_params,
    validate_custom_fields,
    value_number_max,
    value_number_min,
)
from app.shared.lead_fields import M as m
from tests.conftest import business_url, cookie, owner_with_business, req
from tests.test_embed import base as embed_body
from tests.test_embed import key_of
from tests.test_embed import post as embed_post
from tests.test_leads import _team, create, leads_url

HEBREW = re.compile(r"[֐-׿]")
SHARED = Path(__file__).resolve().parents[3] / "packages" / "shared" / "src" / "leadFields.ts"


def fields_url(bid, tail=""):
    return business_url(bid, f"/lead-fields{tail}")


async def add_field(client, bid, token, body):
    res = await req(client, "POST", fields_url(bid), token, body)
    assert res.status_code == 201, res.text
    return res.json()["field"]


async def patch_field(client, bid, token, fid, body):
    return await req(client, "PATCH", fields_url(bid, f"/{fid}"), token, body)


async def list_fields(client, bid, token):
    res = await req(client, "GET", fields_url(bid), token)
    assert res.status_code == 200, res.text
    return res.json()["fields"]


async def all_types(client, t):
    """One field of each type in the team's business; returns {type: field}."""
    bid, token = t["id"], t["owner"]["token"]
    return {
        "text": await add_field(client, bid, token, {"label": "דגם רכב", "type": "text"}),
        "number": await add_field(
            client, bid, token, {"label": "אורחים", "type": "number", "min": 0, "max": 500}
        ),
        "date": await add_field(client, bid, token, {"label": "תאריך האירוע", "type": "date"}),
        "select": await add_field(
            client,
            bid,
            token,
            {"label": "סוג טיפול", "type": "select", "options": [{"label": "פנים"}, {"label": "גוף"}]},
        ),
        "boolean": await add_field(client, bid, token, {"label": "VIP", "type": "boolean"}),
    }


def err(res):
    body = res.json()["error"]
    assert "Traceback" not in res.text and "sqlalchemy" not in res.text.lower()
    return body


# =========================================================================== port of the shared module

IDS = {
    "text": "11111111-1111-4111-8111-111111111111",
    "number": "22222222-2222-4222-8222-222222222222",
    "date": "33333333-3333-4333-8333-333333333333",
    "select": "44444444-4444-4444-8444-444444444444",
    "boolean": "55555555-5555-4555-8555-555555555555",
    "archived": "66666666-6666-4666-8666-666666666666",
    "foreign": "77777777-7777-4777-8777-777777777777",
}
RULES = [
    LeadFieldRule(id=IDS["text"], type="text", required=True),
    LeadFieldRule(id=IDS["number"], type="number", min=0, max=500),
    LeadFieldRule(id=IDS["date"], type="date"),
    LeadFieldRule(
        id=IDS["select"],
        type="select",
        options=[
            LeadFieldOptionRule("opt-a"),
            LeadFieldOptionRule("opt-b"),
            LeadFieldOptionRule("opt-old", archived=True),
        ],
    ),
    LeadFieldRule(id=IDS["boolean"], type="boolean"),
    LeadFieldRule(id=IDS["archived"], type="text", required=True, archived=True),
]
APP = {"mode": "create", "from_app": True}
EXTERNAL = {"mode": "create", "from_app": False}


def _shared_messages() -> dict[str, str]:
    """The plain (non-function) messages of `leadFieldMessages`, with `${CONST}` filled in."""
    src = SHARED.read_text(encoding="utf-8")
    block = src[src.index("export const leadFieldMessages = {") : src.index("} as const;")]
    out: dict[str, str] = {}
    for key, _q, body in re.findall(r"^\s*(\w+): (['`])(.*?)\2,$", block, re.M):
        out[key] = re.sub(r"\$\{(\w+)\}", lambda g: str(getattr(lf, g.group(1))), body)
    return out


def test_hebrew_messages_match_the_shared_package_byte_for_byte():
    shared = _shared_messages()
    assert len(shared) >= 30
    assert shared == {k: v for k, v in m.items()}
    src = SHARED.read_text(encoding="utf-8")
    assert "valueNumberMin: (min: number) => `המספר צריך להיות לפחות ${fmt(min)}`" in src
    assert "valueNumberMax: (max: number) => `המספר צריך להיות לכל היותר ${fmt(max)}`" in src
    for name in (
        "MAX_ACTIVE_LEAD_FIELDS = 20", "LEAD_FIELD_LABEL_MAX = 40", "LEAD_FIELD_OPTIONS_MIN = 2",
        "LEAD_FIELD_OPTIONS_MAX = 30", "LEAD_FIELD_OPTIONS_TOTAL_MAX = 100", "LEAD_FIELD_OPTION_LABEL_MAX = 60",
        "LEAD_FIELD_OPTION_ID_MAX = 40", "LEAD_FIELD_TEXT_MAX = 500", "MAX_CUSTOM_FIELD_KEYS = 100",
        "LEAD_FIELD_FILTER_VALUE_MAX = 100",
    ):  # fmt: skip
        const, value = name.split(" = ")
        assert f"export const {name};" in src and getattr(lf, const) == int(value)
    assert lf.LEAD_FIELD_NUMBER_ABS_MAX == 1_000_000_000_000


def test_numbers_in_messages_are_formatted_like_javascript():
    assert [js_number_str(x) for x in (1000, 2.5, 0, -3, 1000.0, 0.1, 1e-7, 1e21, 123456789012.5, 0.00001)] == [
        "1000", "2.5", "0", "-3", "1000", "0.1", "1e-7", "1e+21", "123456789012.5", "0.00001",
    ]  # fmt: skip
    assert value_number_min(0) == "המספר צריך להיות לפחות 0"
    assert value_number_max(2.5) == "המספר צריך להיות לכל היותר 2.5"


def test_normalises_every_type_and_drops_empty_values_on_create():
    r = validate_custom_fields(
        RULES,
        {
            IDS["text"]: "  שורה\nשנייה  ",
            IDS["number"]: "12.5",
            IDS["date"]: "2027-02-28",
            IDS["select"]: "opt-b",
            IDS["boolean"]: False,
        },
        **APP,
    )
    assert r.ok and r.values == {
        IDS["text"]: "שורה שנייה",
        IDS["number"]: 12.5,
        IDS["date"]: "2027-02-28",
        IDS["select"]: "opt-b",
    }
    r = validate_custom_fields(RULES, {IDS["text"]: "x", IDS["boolean"]: True, IDS["date"]: ""}, **APP)
    assert r.ok and r.values == {IDS["text"]: "x", IDS["boolean"]: True}
    # Whole numbers stay integers.
    r = validate_custom_fields(RULES, {IDS["text"]: "x", IDS["number"]: "40"}, **APP)
    assert r.values[IDS["number"]] == 40 and isinstance(r.values[IDS["number"]], int)


@pytest.mark.parametrize(
    ("key", "value", "message"),
    [
        (IDS["foreign"], "x", m["valueUnknownField"]),
        ("not-a-uuid", "x", m["valueUnknownField"]),
        (IDS["archived"], "x", m["valueArchivedField"]),
        (IDS["text"], 42, m["valueText"]),
        (IDS["text"], "א" * 501, m["valueTextTooLong"]),
        (IDS["text"], "😀" * 251, m["valueTextTooLong"]),  # 502 UTF-16 units, like JavaScript
        (IDS["number"], "abc", m["valueNumber"]),
        (IDS["number"], "١٢", m["valueNumber"]),  # Arabic-Indic digits aren't JavaScript's \d
        (IDS["number"], True, m["valueNumber"]),
        (IDS["number"], -1, value_number_min(0)),
        (IDS["number"], 501, value_number_max(500)),
        (IDS["number"], 1e13, m["valueNumber"]),
        (IDS["number"], float("nan"), m["valueNumber"]),
        (IDS["date"], "2027-02-30", m["valueDate"]),
        (IDS["date"], "27/02/2027", m["valueDate"]),
        (IDS["select"], "opt-zzz", m["valueOption"]),
        (IDS["select"], "opt-old", m["valueOption"]),
        (IDS["boolean"], "true", m["valueBoolean"]),
        (IDS["boolean"], 1, m["valueBoolean"]),
    ],
)
def test_refuses_bad_values_per_field(key, value, message):
    r = validate_custom_fields(RULES, {IDS["text"]: "ok", key: value}, **EXTERNAL)
    assert not r.ok and r.fields == {f"customFields.{key}": message}
    assert HEBREW.search(message)


def test_required_only_for_edits_in_the_app():
    assert validate_custom_fields(RULES, {}, **APP).fields == {
        f"customFields.{IDS['text']}": m["valueRequired"]
    }
    assert validate_custom_fields(RULES, {IDS["text"]: "   "}, **APP).fields == {
        f"customFields.{IDS['text']}": m["valueRequired"]
    }
    ok = validate_custom_fields(RULES, {}, **EXTERNAL)
    assert ok.ok and ok.values == {}
    assert validate_custom_fields(RULES, None, **EXTERNAL).values == {}


def test_update_returns_a_patch_and_required_can_not_be_cleared_in_the_app():
    existing = {IDS["text"]: "ישן", IDS["number"]: 3}
    upd = {"mode": "update", "from_app": True, "existing": existing}
    r = validate_custom_fields(RULES, {IDS["number"]: None, IDS["date"]: "2027-01-01"}, **upd)
    assert r.ok and r.values == {IDS["number"]: None, IDS["date"]: "2027-01-01"}
    r = validate_custom_fields(RULES, {IDS["text"]: ""}, **upd)
    assert r.fields == {f"customFields.{IDS['text']}": m["valueRequired"]}
    r = validate_custom_fields(RULES, {IDS["date"]: "2027-01-01"}, mode="update", from_app=True)
    assert r.ok and r.values == {IDS["date"]: "2027-01-01"}


def test_a_stored_value_sent_back_unchanged_passes_even_when_archived_since():
    existing = {IDS["archived"]: "ערך ישן", IDS["select"]: "opt-old"}
    upd = {"mode": "update", "from_app": True, "existing": existing}
    r = validate_custom_fields(RULES, dict(existing), **upd)
    assert r.ok and r.values == existing
    assert not validate_custom_fields(RULES, {IDS["archived"]: "שונה"}, **upd).ok
    assert not validate_custom_fields(RULES, {IDS["archived"]: None}, **upd).ok
    assert validate_custom_fields(RULES, {IDS["select"]: "opt-a"}, **upd).values == {IDS["select"]: "opt-a"}
    # Strict equality: a stored `true` is not the number 1.
    r = validate_custom_fields(
        RULES, {IDS["boolean"]: 1}, mode="update", from_app=True, existing={IDS["boolean"]: True}
    )
    assert not r.ok


def test_refuses_a_non_object_and_too_many_keys():
    assert validate_custom_fields(RULES, [], **EXTERNAL).fields == {"customFields": m["valuesInvalid"]}
    many = {f"k{i}": "x" for i in range(101)}
    assert validate_custom_fields(RULES, many, **EXTERNAL).fields == {"customFields": m["tooManyValues"]}


def test_applies_a_patch_and_diffs_values_for_the_history():
    before = {IDS["text"]: "a", IDS["number"]: 3}
    after = apply_custom_fields_patch(before, {IDS["number"]: None, IDS["select"]: "opt-a"})
    assert after == {IDS["text"]: "a", IDS["select"]: "opt-a"}
    assert diff_custom_fields(before, after) == [
        {"fieldId": IDS["select"], "from": None, "to": "opt-a"},
        {"fieldId": IDS["number"], "from": 3, "to": None},
    ]
    assert diff_custom_fields(after, after) == []


def test_checks_calendar_dates():
    assert is_valid_iso_date("2028-02-29")
    assert not is_valid_iso_date("2027-02-29")
    assert not is_valid_iso_date("2027-13-01")
    assert not is_valid_iso_date("2027-02-01\n")  # `$` in Python would allow this
    assert not is_valid_iso_date("0050-01-01")  # JavaScript's Date.UTC maps 0-99 to 19xx


def test_parses_filter_params_and_ignores_other_or_empty_ones():
    parsed = parse_lead_field_filter_params(
        [
            (f"cf[{IDS['text']}]", "מרצדס"),
            (f"cf[{IDS['number']}][from]", "10"),
            (f"cf[{IDS['date']}][to]", "2027-01-31"),
            ("q", "x"),
            ("cf[nope]", "y"),
            (f"cf[{IDS['select']}]", " "),
        ]
    )
    assert parsed == {
        IDS["text"]: {"value": "מרצדס"},
        IDS["number"]: {"from": "10"},
        IDS["date"]: {"to": "2027-01-31"},
    }


# =========================================================================== definitions


async def test_owners_and_managers_manage_fields_employees_only_read_them(client, db):
    t = await _team(client, db)
    bid = t["id"]
    f = await add_field(client, bid, t["owner"]["token"], {"label": "דגם רכב", "type": "text"})
    assert f["type"] == "text" and f["position"] == 0 and f["required"] is False
    assert f["options"] == [] and f["min"] is None and f["archivedAt"] is None
    g = await add_field(client, bid, t["manager"]["token"], {"label": "מספר רישוי", "type": "text"})
    assert g["position"] == 1

    emp = t["employee"]["token"]
    assert [x["id"] for x in await list_fields(client, bid, emp)] == [f["id"], g["id"]]
    for method, url, body in [
        ("POST", fields_url(bid), {"label": "x", "type": "text"}),
        ("PATCH", fields_url(bid, f"/{f['id']}"), {"label": "y"}),
        ("PATCH", fields_url(bid, f"/{f['id']}"), {"archived": True}),
        ("PUT", fields_url(bid, "/order"), {"ids": [g["id"], f["id"]]}),
    ]:
        res = await req(client, method, url, emp, body)
        assert res.status_code == 403 and err(res)["code"] == "FORBIDDEN"
    assert (
        await patch_field(client, bid, t["manager"]["token"], f["id"], {"label": "דגם"})
    ).status_code == 200


async def test_creates_a_select_field_with_generated_option_ids_and_a_number_with_a_range(client, db):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    sel = await add_field(
        client,
        bid,
        token,
        {"label": "  סוג טיפול ", "type": "select", "options": [{"label": " פנים "}, {"label": "גוף"}]},
    )
    assert sel["label"] == "סוג טיפול" and [x["label"] for x in sel["options"]] == ["פנים", "גוף"]
    assert all(uuid.UUID(x["id"]) and x["archivedAt"] is None for x in sel["options"])
    num = await add_field(client, bid, token, {"label": "תקציב", "type": "number", "min": 1, "max": 2.5})
    assert num["min"] == 1 and num["max"] == 2.5
    assert sel["createdAt"].endswith("Z") and sel["updatedAt"].endswith("Z")
    # Other types drop range/options (`[]` is fine).
    txt = await add_field(client, bid, token, {"label": "הערה", "type": "text", "options": []})
    assert txt["options"] == [] and txt["min"] is None


@pytest.mark.parametrize(
    ("body", "field", "message"),
    [
        ({"label": "", "type": "text"}, "label", m["labelRequired"]),
        ({"type": "text"}, "label", m["labelRequired"]),
        ({"label": "א" * 41, "type": "text"}, "label", m["labelTooLong"]),
        ({"label": "x", "type": "color"}, "type", m["typeInvalid"]),
        ({"label": "x"}, "type", m["typeInvalid"]),
        ({"label": "x", "type": "select"}, "options", m["optionsCount"]),
        ({"label": "x", "type": "select", "options": [{"label": "a"}]}, "options", m["optionsCount"]),
        ({"label": "x", "type": "select", "options": [{"label": str(i)} for i in range(31)]}, "options", m["optionsCount"]),
        ({"label": "x", "type": "select", "options": [{"label": "a"}, {"label": "b" * 61}]}, "options.1.label", m["optionLabelTooLong"]),
        ({"label": "x", "type": "select", "options": [{"label": "a"}, {"label": " "}]}, "options.1.label", m["optionLabelRequired"]),
        ({"label": "x", "type": "select", "options": [{"label": "Yes"}, {"label": " yes"}]}, "options.1.label", m["optionDuplicate"]),
        ({"label": "x", "type": "text", "options": [{"label": "a"}, {"label": "b"}]}, "options", m["optionsNotAllowed"]),
        ({"label": "x", "type": "text", "min": 1}, "min", m["rangeNotAllowed"]),
        ({"label": "x", "type": "number", "min": 5, "max": 1}, "min", m["rangeInvalid"]),
        ({"label": "x", "type": "number", "min": "5"}, "min", m["numberInvalid"]),
        ({"label": "x", "type": "number", "max": 1e13}, "max", m["numberInvalid"]),
        ({"label": "x", "type": "boolean", "required": True}, "required", m["booleanNotRequired"]),
    ],
)  # fmt: skip
async def test_refuses_bad_definitions_with_hebrew_messages(client, body, field, message):
    o = await owner_with_business(client)
    res = await req(client, "POST", fields_url(o["business"]["id"]), o["token"], body)
    assert res.status_code == 400, res.text
    e = err(res)
    assert e["code"] == "VALIDATION_ERROR" and e["fields"][field] == message and HEBREW.search(message)


async def test_the_21st_active_field_and_a_duplicate_label_are_conflicts(client):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    first = await add_field(client, bid, token, {"label": "Car", "type": "text"})
    dup = await req(client, "POST", fields_url(bid), token, {"label": " car ", "type": "date"})
    assert dup.status_code == 409
    assert err(dup)["code"] == "CONFLICT" and err(dup)["fields"]["label"] == m["labelTaken"]

    more = [
        (await add_field(client, bid, token, {"label": f"שדה {i}", "type": "text"}))["id"] for i in range(19)
    ]
    over = await req(client, "POST", fields_url(bid), token, {"label": "עוד אחד", "type": "text"})
    assert over.status_code == 409 and err(over)["message"] == m["tooManyFields"]
    assert err(over)["fields"]["label"] == m["tooManyFields"]

    # Archiving frees a slot and the label; restoring re-checks both.
    assert (await patch_field(client, bid, token, first["id"], {"archived": True})).status_code == 200
    again = await add_field(client, bid, token, {"label": "CAR", "type": "text"})
    restore = await patch_field(client, bid, token, first["id"], {"archived": False})
    assert restore.status_code == 409 and err(restore)["message"] == m["tooManyFields"]
    await patch_field(client, bid, token, again["id"], {"archived": True})
    await patch_field(client, bid, token, more[-1], {"archived": True})  # room for one more
    await patch_field(client, bid, token, first["id"], {"label": "car"})  # archived: no clash yet
    third = await add_field(client, bid, token, {"label": "Car", "type": "text"})
    clash = await patch_field(client, bid, token, first["id"], {"archived": False})
    assert clash.status_code == 409 and err(clash)["fields"]["label"] == m["labelTaken"]
    await patch_field(client, bid, token, third["id"], {"archived": True})
    ok = await patch_field(client, bid, token, first["id"], {"archived": False})
    assert ok.status_code == 200 and ok.json()["field"]["archivedAt"] is None
    positions = [f["position"] for f in await list_fields(client, bid, token) if f["archivedAt"] is None]
    assert ok.json()["field"]["position"] == max(positions)  # restored last

    # Renaming onto another active label is refused too.
    rename = await patch_field(client, bid, token, first["id"], {"label": "שדה 0"})
    assert rename.status_code == 409 and err(rename)["fields"]["label"] == m["labelTaken"]


async def test_a_label_race_is_caught_by_the_unique_index(client, monkeypatch):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    await add_field(client, bid, token, {"label": "רכב", "type": "text"})
    # As if a parallel request inserted the same label after our check.
    monkeypatch.setattr(LeadFieldService, "_label_taken", staticmethod(lambda *a: False))
    res = await req(client, "POST", fields_url(bid), token, {"label": "רכב", "type": "text"})
    assert res.status_code == 409 and err(res)["fields"]["label"] == m["labelTaken"]
    assert "lead_field_definitions" not in res.text
    assert len(await list_fields(client, bid, token)) == 1


async def test_updates_refuse_a_type_change_and_type_specific_keys(client):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    txt = await add_field(client, bid, token, {"label": "דגם", "type": "text"})
    num = await add_field(client, bid, token, {"label": "אורחים", "type": "number", "min": 1, "max": 10})
    box = await add_field(client, bid, token, {"label": "VIP", "type": "boolean"})
    sel = await add_field(
        client, bid, token, {"label": "סוג", "type": "select", "options": [{"label": "א"}, {"label": "ב"}]}
    )
    cases = [
        (txt, {"label": "חדש", "type": "number"}, "type", m["typeLocked"]),
        (txt, {"type": None}, "type", m["typeLocked"]),
        (txt, {"options": [{"label": "a"}, {"label": "b"}]}, "options", m["optionsNotAllowed"]),
        (txt, {"min": 3}, "min", m["rangeNotAllowed"]),
        (box, {"required": True}, "required", m["booleanNotRequired"]),
        (num, {"min": 20}, "min", m["rangeInvalid"]),  # against the stored max
        (num, {"min": 5, "max": 2}, "min", m["rangeInvalid"]),
        (sel, {"options": [{"id": "nope", "label": "x"}, {"label": "y"}]}, "options", m["optionUnknown"]),
        (sel, {"options": [{"label": "x"}]}, "options", m["optionsCount"]),
        (sel, {"label": None}, "label", m["labelRequired"]),
        (sel, {"options": [{"label": "x"}, {"label": "X"}]}, "options.1.label", m["optionDuplicate"]),
    ]
    for f, body, field, message in cases:
        res = await patch_field(client, bid, token, f["id"], body)
        assert res.status_code == 400, (body, res.text)
        assert err(res)["fields"][field] == message, body
    # Nothing changed.
    assert [x["type"] for x in await list_fields(client, bid, token)] == [
        "text",
        "number",
        "boolean",
        "select",
    ]
    ok = await patch_field(client, bid, token, num["id"], {"min": None, "max": 1000, "required": True})
    assert ok.status_code == 200 and (ok.json()["field"]["min"], ok.json()["field"]["max"]) == (None, 1000)
    assert ok.json()["field"]["required"] is True


async def test_option_list_rename_add_archive_restore_and_the_100_total_limit(client):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    sel = await add_field(
        client, bid, token, {"label": "סוג", "type": "select", "options": [{"label": "א"}, {"label": "ב"}]}
    )
    a, b = sel["options"]
    res = await patch_field(
        client, bid, token, sel["id"], {"options": [{"label": "ג"}, {"id": a["id"], "label": "א׳"}]}
    )
    opts = res.json()["field"]["options"]
    assert [(x["label"], x["archivedAt"] is None) for x in opts] == [("ג", True), ("א׳", True), ("ב", False)]
    assert opts[1]["id"] == a["id"] and opts[2]["id"] == b["id"]
    # Restore b by listing it again.
    res = await patch_field(
        client,
        bid,
        token,
        sel["id"],
        {"options": [{"id": b["id"], "label": "ב"}, {"id": a["id"], "label": "א"}]},
    )
    opts = res.json()["field"]["options"]
    assert [x["label"] for x in opts if x["archivedAt"] is None] == ["ב", "א"]
    assert len(opts) == 3  # ג archived, never deleted

    for _ in range(3):
        await patch_field(client, bid, token, sel["id"], {"options": [{"label": f"n{i}"} for i in range(30)]})
    over = await patch_field(
        client, bid, token, sel["id"], {"options": [{"label": f"m{i}"} for i in range(30)]}
    )
    assert over.status_code == 400 and err(over)["fields"]["options"] == m["optionsTotal"]


async def test_reorder_rewrites_positions_and_refuses_stale_or_duplicate_lists(client):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    a = await add_field(client, bid, token, {"label": "א", "type": "text"})
    b = await add_field(client, bid, token, {"label": "ב", "type": "text"})
    c = await add_field(client, bid, token, {"label": "ג", "type": "text"})
    await patch_field(client, bid, token, b["id"], {"archived": True})
    url = fields_url(bid, "/order")

    res = await req(client, "PUT", url, token, {"ids": [c["id"], a["id"]]})
    assert res.status_code == 200
    got = res.json()["fields"]
    assert [(f["id"], f["position"]) for f in got[:2]] == [(c["id"], 0), (a["id"], 1)]
    assert got[2]["id"] == b["id"] and got[2]["archivedAt"]  # archived last

    stale = await req(client, "PUT", url, token, {"ids": [c["id"]]})
    assert stale.status_code == 409 and err(stale)["message"] == m["orderStale"]
    with_archived = await req(client, "PUT", url, token, {"ids": [c["id"], a["id"], b["id"]]})
    assert with_archived.status_code == 409
    dup = await req(client, "PUT", url, token, {"ids": [c["id"], c["id"]]})
    assert dup.status_code == 400 and err(dup)["fields"]["ids"] == m["orderDuplicate"]
    bad = await req(client, "PUT", url, token, {"ids": ["nope"]})
    assert bad.status_code == 400 and err(bad)["fields"]["ids"] == m["orderStale"]


async def test_another_businesss_field_is_not_found_and_never_listed(client):
    a = await owner_with_business(client, "a")
    b = await owner_with_business(client, "b")
    fa = await add_field(client, a["business"]["id"], a["token"], {"label": "רכב", "type": "text"})
    bid_b, tok_b = b["business"]["id"], b["token"]
    assert await list_fields(client, bid_b, tok_b) == []
    for fid in (fa["id"], str(uuid.uuid4()), "not-a-uuid"):
        res = await patch_field(client, bid_b, tok_b, fid, {"label": "שלי"})
        assert res.status_code == 404 and err(res)["code"] == "NOT_FOUND"
    # A's field can't be put in B's order either.
    res = await req(client, "PUT", fields_url(bid_b, "/order"), tok_b, {"ids": [fa["id"]]})
    assert res.status_code == 409
    # Outsiders get 404 on A's routes.
    for method, url, body in [
        ("GET", fields_url(a["business"]["id"]), None),
        ("POST", fields_url(a["business"]["id"]), {"label": "x", "type": "text"}),
        ("PATCH", fields_url(a["business"]["id"], f"/{fa['id']}"), {"label": "x"}),
        ("PUT", fields_url(a["business"]["id"], "/order"), {"ids": [fa["id"]]}),
    ]:
        assert (await req(client, method, url, tok_b, body)).status_code == 404
    assert (await list_fields(client, a["business"]["id"], a["token"]))[0]["label"] == "רכב"


# =========================================================================== values on leads


async def test_creating_and_editing_a_lead_saves_values_of_every_type(client, db):
    t = await _team(client, db)
    f = await all_types(client, t)
    bid, token = t["id"], t["owner"]["token"]
    opt = f["select"]["options"][1]["id"]
    res = await create(
        client,
        bid,
        token,
        {
            "name": "דנה",
            "phone": "050-1234567",
            "customFields": {
                f["text"]["id"]: " מאזדה\n3 ",
                f["number"]["id"]: 120,
                f["date"]["id"]: "2027-06-01",
                f["select"]["id"]: opt,
                f["boolean"]["id"]: True,
            },
        },
    )
    assert res.status_code == 201, res.text
    lead = res.json()["lead"]
    assert lead["customFields"] == {
        f["text"]["id"]: "מאזדה 3",
        f["number"]["id"]: 120,
        f["date"]["id"]: "2027-06-01",
        f["select"]["id"]: opt,
        f["boolean"]["id"]: True,
    }
    assert '"' + f["number"]["id"] + '":120' in res.text.replace(" ", "")  # an integer, not 120.0
    detail = (await req(client, "GET", leads_url(bid, f"/{lead['id']}"), token)).json()
    assert [a["type"] for a in detail["activities"]] == ["lead.created"]  # no extra activity
    assert detail["lead"]["customFields"] == lead["customFields"]

    # A lead without values reads {}.
    other = (await create(client, bid, token, {"name": "רון", "phone": "050-7654321"})).json()["lead"]
    assert other["customFields"] == {}

    # Patch: change one, remove two (null and ""), untick; absent keys stay.
    res = await req(
        client,
        "PATCH",
        leads_url(bid, f"/{lead['id']}"),
        token,
        {
            "customFields": {
                f["number"]["id"]: "2.5",
                f["text"]["id"]: None,
                f["date"]["id"]: "",
                f["boolean"]["id"]: False,
            }
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["lead"]["customFields"] == {f["number"]["id"]: 2.5, f["select"]["id"]: opt}
    row = (
        await db.execute(select(models.Lead.custom_fields).where(models.Lead.id == uuid.UUID(lead["id"])))
    ).scalar_one()
    assert row == {f["number"]["id"]: 2.5, f["select"]["id"]: opt}  # nothing stored as null


async def test_wrong_values_are_refused_per_field_with_hebrew_messages(client, db):
    t = await _team(client, db)
    f = await all_types(client, t)
    other = await owner_with_business(client, "other")
    foreign = await add_field(
        client, other["business"]["id"], other["token"], {"label": "זר", "type": "text"}
    )
    res = await create(
        client,
        t["id"],
        t["owner"]["token"],
        {
            "name": "דנה",
            "phone": "050-1234567",
            "customFields": {
                f["text"]["id"]: 5,
                f["number"]["id"]: 501,
                f["date"]["id"]: "2027-02-30",
                f["select"]["id"]: "nope",
                f["boolean"]["id"]: "yes",
                foreign["id"]: "x",
                "not-a-field": "x",
            },
        },
    )
    assert res.status_code == 400
    assert err(res)["fields"] == {
        f"customFields.{f['text']['id']}": m["valueText"],
        f"customFields.{f['number']['id']}": value_number_max(500),
        f"customFields.{f['date']['id']}": m["valueDate"],
        f"customFields.{f['select']['id']}": m["valueOption"],
        f"customFields.{f['boolean']['id']}": m["valueBoolean"],
        f"customFields.{foreign['id']}": m["valueUnknownField"],
        "customFields.not-a-field": m["valueUnknownField"],
    }
    lead = (
        await create(client, t["id"], t["owner"]["token"], {"name": "דנה", "phone": "050-1234567"})
    ).json()["lead"]
    url = leads_url(t["id"], f"/{lead['id']}")
    # A foreign field id in a patch is refused, and nothing is written.
    res = await req(client, "PATCH", url, t["owner"]["token"], {"customFields": {foreign["id"]: "x"}})
    assert res.status_code == 400 and err(res)["fields"] == {
        f"customFields.{foreign['id']}": m["valueUnknownField"]
    }
    for bad in ([], "x", None, {"a": {"nested": 1}}, {"a": [1]}):
        res = await req(client, "PATCH", url, t["owner"]["token"], {"customFields": bad})
        assert res.status_code == 400 and err(res)["fields"]["customFields"] == m["valuesInvalid"], bad
    many = {str(uuid.uuid4()): "x" for _ in range(101)}
    res = await req(client, "PATCH", url, t["owner"]["token"], {"customFields": many})
    assert err(res)["fields"]["customFields"] == m["tooManyValues"]
    res = await create(
        client, t["id"], t["owner"]["token"], {"name": "דנה", "phone": "0501234567", "customFields": None}
    )
    assert res.status_code == 400 and err(res)["fields"]["customFields"] == m["valuesInvalid"]


async def test_required_fields_block_saving_in_the_app_only(client, db):
    t = await _team(client, db)
    bid, token = t["id"], t["owner"]["token"]
    old = (await create(client, bid, token, {"name": "ותיק", "phone": "050-1111111"})).json()["lead"]
    req_field = await add_field(client, bid, token, {"label": "דגם", "type": "text", "required": True})
    key = f"customFields.{req_field['id']}"

    missing = await create(client, bid, token, {"name": "דנה", "phone": "050-1234567"})
    assert missing.status_code == 400 and err(missing)["fields"] == {key: m["valueRequired"]}
    ok = await create(
        client, bid, token, {"name": "דנה", "phone": "050-1234567", "customFields": {req_field["id"]: "x"}}
    )
    assert ok.status_code == 201
    # An old lead without the value stays editable; it just can't be cleared.
    url = leads_url(bid, f"/{old['id']}")
    assert (await req(client, "PATCH", url, token, {"tags": ["VIP"]})).status_code == 200
    clear = await req(
        client,
        "PATCH",
        leads_url(bid, f"/{ok.json()['lead']['id']}"),
        token,
        {"customFields": {req_field["id"]: ""}},
    )
    assert clear.status_code == 400 and err(clear)["fields"] == {key: m["valueRequired"]}
    # An archived required field is never demanded.
    await patch_field(client, bid, token, req_field["id"], {"archived": True})
    assert (await create(client, bid, token, {"name": "רון", "phone": "050-2222222"})).status_code == 201


async def test_rename_and_archive_keep_values(client, db):
    t = await _team(client, db)
    bid, token = t["id"], t["owner"]["token"]
    sel = await add_field(
        client,
        bid,
        token,
        {"label": "סוג", "type": "select", "options": [{"label": "פנים"}, {"label": "גוף"}]},
    )
    txt = await add_field(client, bid, token, {"label": "דגם", "type": "text"})
    a, b = sel["options"]
    lead = (
        await create(
            client, bid, token,
            {"name": "דנה", "phone": "050-1234567", "customFields": {sel["id"]: a["id"], txt["id"]: "מאזדה"}},
        )
    ).json()["lead"]  # fmt: skip
    url = leads_url(bid, f"/{lead['id']}")

    # Rename the field and the option; archive option a (left out of the list).
    await patch_field(
        client,
        bid,
        token,
        sel["id"],
        {"label": "טיפול", "options": [{"id": b["id"], "label": "גב"}, {"label": "ידיים"}]},
    )
    got = (await req(client, "GET", url, token)).json()["lead"]
    assert got["customFields"][sel["id"]] == a["id"]
    # Sent back unchanged: accepted. Choosing the archived option on another lead: refused.
    same = await req(client, "PATCH", url, token, {"customFields": {sel["id"]: a["id"], txt["id"]: "מאזדה"}})
    assert same.status_code == 200
    detail = (await req(client, "GET", url, token)).json()
    assert [x["type"] for x in detail["activities"]] == ["lead.created"]  # no change, no history
    other = (await create(client, bid, token, {"name": "רון", "phone": "050-7654321"})).json()["lead"]
    res = await req(
        client, "PATCH", leads_url(bid, f"/{other['id']}"), token, {"customFields": {sel["id"]: a["id"]}}
    )
    assert res.status_code == 400 and err(res)["fields"] == {f"customFields.{sel['id']}": m["valueOption"]}

    # Archive the text field: GET still lists it, the value stays, it can't be changed or cleared.
    await patch_field(client, bid, token, txt["id"], {"archived": True})
    listed = {f["id"]: f for f in await list_fields(client, bid, token)}
    assert listed[txt["id"]]["archivedAt"] is not None
    got = (await req(client, "GET", url, token)).json()["lead"]
    assert got["customFields"][txt["id"]] == "מאזדה"
    for value in ("טויוטה", None):
        res = await req(client, "PATCH", url, token, {"customFields": {txt["id"]: value}})
        assert res.status_code == 400 and err(res)["fields"] == {
            f"customFields.{txt['id']}": m["valueArchivedField"]
        }
    # Restored: editable again, and it goes last.
    res = await patch_field(client, bid, token, txt["id"], {"archived": False})
    assert res.json()["field"]["position"] == sel["position"] + 1
    assert (
        await req(client, "PATCH", url, token, {"customFields": {txt["id"]: "טויוטה"}})
    ).status_code == 200


async def test_field_changes_are_written_to_the_lead_updated_history(client, db):
    t = await _team(client, db)
    f = await all_types(client, t)
    bid, token = t["id"], t["owner"]["token"]
    opt = f["select"]["options"][0]["id"]
    lead = (
        await create(
            client,
            bid,
            token,
            {"name": "דנה", "phone": "050-1234567", "customFields": {f["select"]["id"]: opt}},
        )
    ).json()["lead"]
    url = leads_url(bid, f"/{lead['id']}")
    res = await req(
        client, "PATCH", url, token,
        {"tags": ["VIP"], "customFields": {f["select"]["id"]: None, f["number"]["id"]: 7}},
    )  # fmt: skip
    assert res.status_code == 200
    updated = [
        a for a in (await req(client, "GET", url, token)).json()["activities"] if a["type"] == "lead.updated"
    ]
    assert len(updated) == 1
    data = updated[0]["data"]
    assert data["fields"] == ["tags", "customFields"]
    assert sorted(data["customFields"], key=lambda c: c["fieldId"]) == sorted(
        [
            {"fieldId": f["number"]["id"], "from": None, "to": 7},
            {"fieldId": f["select"]["id"], "from": opt, "to": None},
        ],
        key=lambda c: c["fieldId"],
    )
    assert updated[0]["actor"]["id"] == t["owner"]["user_id"]
    before = res.json()["lead"]["updatedAt"]
    # The same values again: no history, no bump.
    res = await req(client, "PATCH", url, token, {"customFields": {f["number"]["id"]: 7}})
    assert res.json()["lead"]["updatedAt"] == before


async def test_employees_fill_values_only_on_their_own_leads(client, db):
    t = await _team(client, db)
    txt = await add_field(client, t["id"], t["owner"]["token"], {"label": "דגם", "type": "text"})
    emp = t["employee"]
    mine = (await create(client, t["id"], emp["token"], {"name": "שלי", "phone": "050-1111111"})).json()[
        "lead"
    ]
    theirs = (
        await create(client, t["id"], t["owner"]["token"], {"name": "לא שלי", "phone": "050-2222222"})
    ).json()["lead"]
    ok = await req(
        client,
        "PATCH",
        leads_url(t["id"], f"/{mine['id']}"),
        emp["token"],
        {"customFields": {txt["id"]: "x"}},
    )
    assert ok.status_code == 200 and ok.json()["lead"]["customFields"] == {txt["id"]: "x"}
    no = await req(
        client,
        "PATCH",
        leads_url(t["id"], f"/{theirs['id']}"),
        emp["token"],
        {"customFields": {txt["id"]: "x"}},
    )
    assert no.status_code == 404


# =========================================================================== external sources


async def test_website_embed_and_import_leads_are_created_as_before_without_custom_values(client, db):
    o = await owner_with_business(client)
    bid, token = o["business"]["id"], o["token"]
    await add_field(client, bid, token, {"label": "דגם", "type": "text", "required": True})
    key = (await key_of(client, o))["key"]
    assert (await embed_post(client, LEAD_PATH, embed_body(key))).json() == {"ok": True}
    res = await req(
        client, "POST", business_url(bid, "/customers/import"), token,
        {"rows": [{"name": "רון לוי", "phone": "050-7654321", "value": "1000"}]},
    )  # fmt: skip
    assert res.status_code == 200 and res.json()["imported"] == 1
    leads = (await req(client, "GET", leads_url(bid), token)).json()["leads"]
    assert sorted(lead["source"] for lead in leads) == ["manual", "website_form"]
    assert all(lead["customFields"] == {} for lead in leads)
    rows = (await db.execute(select(models.Lead.custom_fields))).scalars().all()
    assert rows == [{}, {}]


# =========================================================================== list filters


async def _filter_fixture(client, db):
    t = await _team(client, db)
    f = await all_types(client, t)
    bid, token = t["id"], t["owner"]["token"]
    a, b = (o["id"] for o in f["select"]["options"])
    emp = t["employee"]

    async def lead(name, phone, values, owner=None):
        body = {"name": name, "phone": phone, "customFields": values}
        if owner:
            body["ownerId"] = owner
        res = await create(client, bid, token, body)
        assert res.status_code == 201, res.text
        return res.json()["lead"]["id"]

    ids = {
        "one": await lead("אחד", "050-1000001", {f["text"]["id"]: "Mazda 100%", f["number"]["id"]: 10, f["date"]["id"]: "2027-01-10", f["select"]["id"]: a, f["boolean"]["id"]: True}),
        "two": await lead("שניים", "050-1000002", {f["text"]["id"]: "toyota", f["number"]["id"]: 250.5, f["date"]["id"]: "2027-03-01", f["select"]["id"]: b}, owner=emp["user_id"]),
        "three": await lead("שלושה", "050-1000003", {f["number"]["id"]: 500}, owner=emp["user_id"]),
    }  # fmt: skip
    return t, f, ids, (a, b)


async def _filtered(client, t, token, params):
    res = await client.get(leads_url(t["id"]), params=params, headers=cookie(token))
    assert res.status_code == 200, res.text
    return {lead["contact"]["name"] for lead in res.json()["leads"]}


async def test_the_list_filters_by_each_type(client, db):
    t, f, _, (a, b) = await _filter_fixture(client, db)
    tok = t["owner"]["token"]
    cf = lambda key, part=None: f"cf[{f[key]['id']}]" + (f"[{part}]" if part else "")  # noqa: E731
    assert await _filtered(client, t, tok, {cf("text"): "MAZ"}) == {"אחד"}
    assert await _filtered(client, t, tok, {cf("text"): "100%"}) == {"אחד"}
    assert await _filtered(client, t, tok, {cf("text"): "0%"}) == {"אחד"}
    assert await _filtered(client, t, tok, {cf("text"): "_"}) == set()  # LIKE wildcards are text
    assert await _filtered(client, t, tok, {cf("select"): b}) == {"שניים"}
    assert await _filtered(client, t, tok, {cf("boolean"): "true"}) == {"אחד"}
    assert await _filtered(client, t, tok, {cf("boolean"): "false"}) == {"שניים", "שלושה"}
    assert await _filtered(client, t, tok, {cf("number", "from"): "10", cf("number", "to"): "250.5"}) == {
        "אחד",
        "שניים",
    }
    assert await _filtered(client, t, tok, {cf("number", "from"): "251"}) == {"שלושה"}
    assert await _filtered(client, t, tok, {cf("number", "to"): "-1"}) == set()
    assert await _filtered(
        client, t, tok, {cf("date", "from"): "2027-01-10", cf("date", "to"): "2027-02-28"}
    ) == {"אחד"}
    assert await _filtered(client, t, tok, {cf("date", "to"): "2027-03-01"}) == {"אחד", "שניים"}
    # AND with each other and with the other filters; empty values are ignored.
    assert await _filtered(client, t, tok, {cf("number", "from"): "1", cf("select"): a}) == {"אחד"}
    assert await _filtered(client, t, tok, {cf("text"): "", "q": "שלושה"}) == {"שלושה"}
    # An archived option can still be filtered on.
    await patch_field(
        client, t["id"], tok, f["select"]["id"], {"options": [{"id": b, "label": "ב"}, {"label": "ג"}]}
    )
    assert await _filtered(client, t, tok, {cf("select"): a}) == {"אחד"}


async def test_employees_still_see_only_their_own_leads_when_filtering(client, db):
    t, f, _, _ = await _filter_fixture(client, db)
    emp = t["employee"]["token"]
    assert await _filtered(client, t, emp, {f"cf[{f['number']['id']}][from]": "0"}) == {"שניים", "שלושה"}
    assert await _filtered(client, t, emp, {f"cf[{f['boolean']['id']}]": "true"}) == set()


async def test_bad_filters_are_400_with_the_field_key(client, db):
    t, f, _, _ = await _filter_fixture(client, db)
    tok = t["owner"]["token"]
    other = await owner_with_business(client, "other")
    foreign = await add_field(
        client, other["business"]["id"], other["token"], {"label": "זר", "type": "text"}
    )
    archived = await add_field(client, t["id"], tok, {"label": "ישן", "type": "text"})
    await patch_field(client, t["id"], tok, archived["id"], {"archived": True})
    unknown = str(uuid.uuid4())
    cases = [
        (f"cf[{foreign['id']}]", "x", foreign["id"]),
        (f"cf[{unknown}]", "x", unknown),
        (f"cf[{archived['id']}]", "x", archived["id"]),
        (f"cf[{f['number']['id']}]", "5", f["number"]["id"]),
        (f"cf[{f['number']['id']}][from]", "abc", f["number"]["id"]),
        (f"cf[{f['date']['id']}][to]", "2027-02-30", f["date"]["id"]),
        (f"cf[{f['date']['id']}]", "2027-02-01", f["date"]["id"]),
        (f"cf[{f['text']['id']}][from]", "a", f["text"]["id"]),
        (f"cf[{f['text']['id']}]", "x" * 101, f["text"]["id"]),
        (f"cf[{f['select']['id']}]", "nope", f["select"]["id"]),
        (f"cf[{f['boolean']['id']}]", "yes", f["boolean"]["id"]),
    ]
    for key, value, fid in cases:
        for path in ("", "/export.csv"):
            res = await client.get(leads_url(t["id"], path), params={key: value}, headers=cookie(tok))
            assert res.status_code == 400, (key, value, path)
            assert err(res)["fields"] == {f"cf[{fid}]": m["filterInvalid"]}, (key, value)
    res = await client.get(leads_url(t["id"]), params={"cf[abc]": "x"}, headers=cookie(tok))
    assert res.status_code == 400 and err(res)["fields"] == {"cf[abc]": m["filterInvalid"]}


# =========================================================================== export


async def test_export_has_one_column_per_active_field_and_applies_the_filters(client, db):
    t, f, _, (a, _) = await _filter_fixture(client, db)
    tok = t["owner"]["token"]
    gone = await add_field(client, t["id"], tok, {"label": "בארכיון", "type": "text"})
    await patch_field(client, t["id"], tok, gone["id"], {"archived": True})
    # Rename option a, then archive it: the export still shows its (new) label.
    await patch_field(
        client, t["id"], tok, f["select"]["id"], {"options": [{"id": a, "label": "=פנים"}, {"label": "x"}]}
    )
    await patch_field(client, t["id"], tok, f["select"]["id"], {"options": [{"label": "y"}, {"label": "x2"}]})
    res = await client.get(leads_url(t["id"], "/export.csv"), headers=cookie(tok))
    assert res.status_code == 200
    lines = res.content.decode("utf-8-sig").split("\r\n")
    header = lines[0].split(",")
    assert (
        header[-5:] == ["דגם רכב", "אורחים", "תאריך האירוע", "סוג טיפול", "VIP"] and "בארכיון" not in header
    )
    by_name = {line.split(",")[0]: line.split(",") for line in lines[1:] if line}
    assert by_name["אחד"][-5:] == ["Mazda 100%", "10", "2027-01-10", '"\'=פנים"', "כן"]
    assert by_name["שניים"][-4:-2] == ["250.5", "2027-03-01"] and by_name["שניים"][-1] == ""
    assert by_name["שלושה"][-5:] == ["", "500", "", "", ""]
    filtered = await client.get(
        leads_url(t["id"], "/export.csv"), params={f"cf[{f['boolean']['id']}]": "true"}, headers=cookie(tok)
    )
    assert len([x for x in filtered.content.decode("utf-8-sig").split("\r\n")[1:] if x]) == 1


# =========================================================================== tenancy and privacy


def test_the_engine_never_logs_bound_parameters(app):
    assert app.state.engine.sync_engine.hide_parameters is True


def test_the_access_log_keeps_the_path_but_not_the_query_string():
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:5", "GET", "/api/v1/businesses/x/leads?cf%5Babc%5D=12-345-67&q=dana", "1.1", 200), None,
    )  # fmt: skip
    assert DropQueryString().filter(rec)
    assert rec.getMessage() == '1.2.3.4:5 - "GET /api/v1/businesses/x/leads HTTP/1.1" 200'


def test_spans_never_carry_the_query_string():
    from opentelemetry.sdk.trace import TracerProvider

    from app.core.tracing import drop_query_string

    span = (
        TracerProvider()
        .get_tracer("t")
        .start_span(
            "GET",
            attributes={
                "http.target": "/api/v1/businesses/x/leads?cf%5Babc%5D=12-345-67",
                "http.url": "http://test/api/v1/businesses/x/leads?cf%5Babc%5D=12-345-67",
                "url.query": "cf%5Babc%5D=12-345-67",
            },
        )
    )
    drop_query_string(span, {"query_string": b"cf%5Babc%5D=12-345-67"})
    assert "12-345-67" not in repr(dict(span.attributes))
    assert span.attributes["http.target"] == "/api/v1/businesses/x/leads"
    span.end()


async def test_custom_values_never_reach_the_logs(client, db, caplog):
    t = await _team(client, db)
    txt = await add_field(client, t["id"], t["owner"]["token"], {"label": "רכב", "type": "text"})
    secret = "PLATE-12-345-67"
    with caplog.at_level(logging.DEBUG):
        res = await create(
            client,
            t["id"],
            t["owner"]["token"],
            {"name": "דנה", "phone": "050-1234567", "customFields": {txt["id"]: secret}},
        )
        assert res.status_code == 201
        await client.get(
            leads_url(t["id"]), params={f"cf[{txt['id']}]": secret}, headers=cookie(t["owner"]["token"])
        )
    # The test client's own request log (httpx) is not the server's.
    server = [r.getMessage() for r in caplog.records if not r.name.startswith(("httpx", "httpcore"))]
    assert not any(secret in line for line in server)


async def test_quick_add_paths_skip_required_fields_but_still_check_every_value_sent(client, db):
    """D-205: `skipRequiredCustomFields: true` (POST /leads only) waives required fields only."""
    t = await _team(client, db)
    bid, token = t["id"], t["owner"]["token"]
    required = await add_field(client, bid, token, {"label": "דגם", "type": "text", "required": True})
    sel = await add_field(
        client, bid, token, {"label": "סוג", "type": "select", "options": [{"label": "א"}, {"label": "ב"}]}
    )
    other = await owner_with_business(client, "other")
    foreign = await add_field(
        client, other["business"]["id"], other["token"], {"label": "זר", "type": "text"}
    )
    body = {"name": "דנה", "phone": "050-1234567"}

    # false (and absent) = the full New lead dialog: required fields are demanded.
    for flag in ({}, {"skipRequiredCustomFields": False}):
        res = await create(client, bid, token, {**body, **flag})
        assert res.status_code == 400 and err(res)["fields"] == {
            f"customFields.{required['id']}": m["valueRequired"]
        }

    # true: created without the required value; the flag is never stored or echoed.
    res = await create(client, bid, token, {**body, "skipRequiredCustomFields": True})
    assert res.status_code == 201 and res.json()["lead"]["customFields"] == {}
    assert "skipRequiredCustomFields" not in res.text
    ok = await create(
        client,
        bid,
        token,
        {**body, "skipRequiredCustomFields": True, "customFields": {sel["id"]: sel["options"][0]["id"]}},
    )
    assert ok.status_code == 201 and ok.json()["lead"]["customFields"] == {sel["id"]: sel["options"][0]["id"]}

    # true: every value sent is still validated.
    res = await create(
        client,
        bid,
        token,
        {
            **body,
            "skipRequiredCustomFields": True,
            "customFields": {sel["id"]: "nope", foreign["id"]: "x", required["id"]: 5},
        },
    )
    assert res.status_code == 400
    assert err(res)["fields"] == {
        f"customFields.{sel['id']}": m["valueOption"],
        f"customFields.{foreign['id']}": m["valueUnknownField"],
        f"customFields.{required['id']}": m["valueText"],
    }
    await patch_field(
        client,
        bid,
        token,
        sel["id"],
        {"options": [{"id": sel["options"][1]["id"], "label": "ב"}, {"label": "ג"}]},
    )
    res = await create(
        client,
        bid,
        token,
        {**body, "skipRequiredCustomFields": True, "customFields": {sel["id"]: sel["options"][0]["id"]}},
    )
    assert res.status_code == 400 and err(res)["fields"] == {f"customFields.{sel['id']}": m["valueOption"]}

    # Not a boolean → 400.
    for bad in ("true", 1, None):
        res = await create(client, bid, token, {**body, "skipRequiredCustomFields": bad})
        assert res.status_code == 400 and err(res)["code"] == "VALIDATION_ERROR"
        assert "skipRequiredCustomFields" in err(res)["fields"], bad


async def test_skip_required_is_not_a_lead_update_key(client, db):
    """PATCH ignores it: a required field still can't be cleared in the app."""
    t = await _team(client, db)
    bid, token = t["id"], t["owner"]["token"]
    required = await add_field(client, bid, token, {"label": "דגם", "type": "text", "required": True})
    lead = (
        await create(
            client, bid, token, {"name": "דנה", "phone": "050-1234567", "customFields": {required["id"]: "x"}}
        )
    ).json()["lead"]
    res = await req(
        client,
        "PATCH",
        leads_url(bid, f"/{lead['id']}"),
        token,
        {"skipRequiredCustomFields": True, "customFields": {required["id"]: None}},
    )
    assert res.status_code == 400 and err(res)["fields"] == {
        f"customFields.{required['id']}": m["valueRequired"]
    }


# =========================================================================== QA regressions


async def _raw(client, method, url, token, body):
    """JSON with every non-ASCII character escaped, so it can carry a NUL or a lone surrogate
    (`"\\ud800"`), which httpx's own encoder can't send."""
    from tests.conftest import HEADERS

    headers = {**HEADERS, **cookie(token), "content-type": "application/json"}
    return await client.request(method, url, content=json.dumps(body).encode(), headers=headers)


async def test_qa_f34_01_a_select_field_needs_options_even_when_an_empty_list_is_sent(client):
    o = await owner_with_business(client)
    for options in ([], None):
        body = {"label": "סוג", "type": "select", **({"options": options} if options is not None else {})}
        res = await req(client, "POST", fields_url(o["business"]["id"]), o["token"], body)
        assert res.status_code == 400 and err(res)["fields"] == {"options": m["optionsCount"]}
    assert await list_fields(client, o["business"]["id"], o["token"]) == []


async def test_qa_f34_02_huge_integers_are_400_not_500(client, db):
    t = await _team(client, db)
    bid, token = t["id"], t["owner"]["token"]
    huge = 10**400
    for key in ("min", "max"):
        res = await req(client, "POST", fields_url(bid), token, {"label": "n", "type": "number", key: huge})
        assert res.status_code == 400 and err(res)["fields"][key] == m["numberInvalid"]
    num = await add_field(client, bid, token, {"label": "n", "type": "number"})
    res = await patch_field(client, bid, token, num["id"], {"max": -huge})
    assert res.status_code == 400 and err(res)["fields"]["max"] == m["numberInvalid"]
    key = f"customFields.{num['id']}"
    res = await create(
        client, bid, token, {"name": "דנה", "phone": "050-1234567", "customFields": {num["id"]: huge}}
    )
    assert res.status_code == 400 and err(res)["fields"] == {key: m["valueNumber"]}
    lead = (await create(client, bid, token, {"name": "דנה", "phone": "050-1234567"})).json()["lead"]
    res = await req(
        client, "PATCH", leads_url(bid, f"/{lead['id']}"), token, {"customFields": {num["id"]: huge}}
    )
    assert res.status_code == 400 and err(res)["fields"] == {key: m["valueNumber"]}
    # 10^12 itself is still fine, as an int and as a float.
    for edge in (10**12, 1e12, -(10**12)):
        res = await req(
            client, "PATCH", leads_url(bid, f"/{lead['id']}"), token, {"customFields": {num["id"]: edge}}
        )
        assert res.status_code == 200, res.text


@pytest.mark.parametrize("bad", ["\x00", "\ud800", "\udfff"], ids=["nul", "high-surrogate", "low-surrogate"])
async def test_qa_f34_03_nul_and_lone_surrogates_are_refused_on_the_field(client, db, bad):
    t = await _team(client, db)
    bid, token = t["id"], t["owner"]["token"]
    txt = await add_field(client, bid, token, {"label": "דגם", "type": "text"})
    sel = await add_field(
        client, bid, token, {"label": "סוג", "type": "select", "options": [{"label": "א"}, {"label": "ב"}]}
    )
    two = [{"label": f"x{bad}"}, {"label": "y"}]

    res = await _raw(client, "POST", fields_url(bid), token, {"label": f"a{bad}b", "type": "text"})
    assert res.status_code == 400 and err(res)["fields"] == {"label": m["invalidCharacters"]}
    res = await _raw(client, "PATCH", fields_url(bid, f"/{txt['id']}"), token, {"label": f"a{bad}b"})
    assert res.status_code == 400 and err(res)["fields"] == {"label": m["invalidCharacters"]}
    res = await _raw(client, "POST", fields_url(bid), token, {"label": "s", "type": "select", "options": two})
    assert res.status_code == 400 and err(res)["fields"] == {"options.0.label": m["invalidCharacters"]}
    res = await _raw(client, "PATCH", fields_url(bid, f"/{sel['id']}"), token, {"options": two})
    assert res.status_code == 400 and err(res)["fields"] == {"options.0.label": m["invalidCharacters"]}

    key = f"customFields.{txt['id']}"
    body = {"name": "דנה", "phone": "050-1234567", "customFields": {txt["id"]: f"a{bad}b"}}
    res = await _raw(client, "POST", leads_url(bid), token, body)
    assert res.status_code == 400 and err(res)["fields"] == {key: m["invalidCharacters"]}
    lead = (await create(client, bid, token, {"name": "רון", "phone": "050-7654321"})).json()["lead"]
    url = leads_url(bid, f"/{lead['id']}")
    res = await _raw(client, "PATCH", url, token, {"customFields": {txt["id"]: f"a{bad}b"}})
    assert res.status_code == 400 and err(res)["fields"] == {key: m["invalidCharacters"]}
    # An unknown key carrying the character is echoed safely (replaced by U+FFFD).
    res = await _raw(client, "PATCH", url, token, {"customFields": {f"k{bad}": "x"}})
    assert res.status_code == 400 and err(res)["fields"] == {"customFields.k\ufffd": m["valueUnknownField"]}
    assert (await req(client, "GET", url, token)).json()["lead"]["customFields"] == {}


async def test_qa_f34_03_a_nul_in_a_text_filter_is_a_400(client, db):
    t = await _team(client, db)
    txt = await add_field(client, t["id"], t["owner"]["token"], {"label": "דגם", "type": "text"})
    res = await client.get(
        leads_url(t["id"]), params={f"cf[{txt['id']}]": "a\x00b"}, headers=cookie(t["owner"]["token"])
    )
    assert res.status_code == 400 and err(res)["fields"] == {f"cf[{txt['id']}]": m["invalidCharacters"]}


def test_huge_and_odd_numbers_in_the_port():
    from app.shared.lead_fields import has_unstorable_chars, is_finite_within

    assert not is_finite_within(10**400, lf.LEAD_FIELD_NUMBER_ABS_MAX)
    assert is_finite_within(10**12, lf.LEAD_FIELD_NUMBER_ABS_MAX)
    assert not is_finite_within(float("inf"), lf.LEAD_FIELD_NUMBER_ABS_MAX)
    assert (
        has_unstorable_chars("a\x00")
        and has_unstorable_chars("\ud800")
        and not has_unstorable_chars("😀 שלום")
    )
    for bad in ("\x00", " a\x00 ", "x\ud800", "\udc00y"):
        r = validate_custom_fields(RULES, {IDS["text"]: bad}, **EXTERNAL)
        assert r.fields == {f"customFields.{IDS['text']}": m["invalidCharacters"]}, repr(bad)
    # Whitespace only is still "no value" (the shared order: trim, empty, then characters).
    assert validate_custom_fields(RULES, {IDS["text"]: "  "}, **EXTERNAL).fields == {}
    r = validate_custom_fields(RULES, {IDS["text"]: "ok", IDS["number"]: 10**400}, **EXTERNAL)
    assert r.fields == {f"customFields.{IDS['number']}": m["valueNumber"]}
