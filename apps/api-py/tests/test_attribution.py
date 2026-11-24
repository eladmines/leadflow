"""The attribution classifier must agree with the TypeScript original (fixture generated from it)."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.shared.attribution import (
    attribution_from_meta_referral,
    attribution_name,
    classify_attribution,
    is_campaign_visit,
    parse_attribution,
)

NOW = datetime(2026, 11, 24, 10, 0, tzinfo=UTC)
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "attribution_cases.json").read_text())


@pytest.mark.parametrize(
    "case", FIXTURE["out"], ids=lambda c: json.dumps(c["input"], ensure_ascii=False)[:60]
)
def test_classify_matches_the_typescript_original(case):
    i = case["input"]
    got = classify_attribution(
        i["params"], i.get("referrer"), i.get("selfHost"), i.get("landingPath"), now=NOW
    )
    assert got == case["output"]
    assert attribution_name(got) == case["name"]
    assert is_campaign_visit(got) == case["campaign"]


@pytest.mark.parametrize("case", FIXTURE["refs"], ids=lambda c: json.dumps(c["input"])[:50])
def test_meta_referral_matches_the_typescript_original(case):
    assert attribution_from_meta_referral(case["input"], now=NOW) == case["output"]


def test_stored_json_that_does_not_fit_reads_as_unknown():
    assert parse_attribution(None) is None
    assert parse_attribution({"source": "nope", "seenAt": "2026-01-01T00:00:00.000Z"}) is None
    assert parse_attribution({"source": "direct"}) is None
    ok = parse_attribution(
        {"source": "direct", "seenAt": "2026-01-01T00:00:00.000Z", "campaign": 5, "clickIdType": "x"}
    )
    assert ok == {"source": "direct", "seenAt": "2026-01-01T00:00:00.000Z"}
