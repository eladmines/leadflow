"""The site builders and renderer must produce exactly what the TypeScript originals do.

The fixture (tests/fixtures/site_cases.json.gz) is generated from the TypeScript by
tools/gen_site_fixtures.mjs: every template in both languages for several business profiles, plus
variations (styles, custom colours, labels, pages, gallery, forms). The stylesheet is compared once
per palette and font.
"""

import gzip
import json
import re
from pathlib import Path

import pytest

from app.shared.site_render import hours_summary, render_site_message_page, render_site_page
from app.shared.site_templates import build_template_draft, with_template_photos

CASES = json.loads(gzip.open(Path(__file__).parent / "fixtures" / "site_cases.json.gz").read())
STYLE = re.compile(r"<style>([\s\S]*?)</style>")
MEDIA_IDS = {"hero": "00000000-0000-4000-8000-0000000000a1", "about": "00000000-0000-4000-8000-0000000000a2"}


def css_key(css: str) -> str:
    m = re.search(r"--p:(#[0-9a-f]{6});--a:(#[0-9a-f]{6});--soft:(#[0-9a-f]{6})", css, re.I)
    assert m
    family = re.search(r"font-family:'([^']+)'", css)
    assert family
    return "|".join(m.groups()) + "|" + family.group(1)


def strip(html: str) -> str:
    m = STYLE.search(html)
    assert m, "no stylesheet in the page"
    assert m.group(1) == CASES["cssSamples"][css_key(m.group(1))], "the stylesheet differs"
    return STYLE.sub("<style>@CSS@</style>", html, count=1)


@pytest.mark.parametrize(
    "case",
    CASES["builds"],
    ids=lambda c: f"{c['lang']}/{c['key']}/{c['b']['name'][:6]}/{bool(c['b']['phone'])}",
)
def test_template_drafts_match_the_typescript_builders(case):
    draft = build_template_draft(case["key"], case["b"], case["lang"])
    assert draft == case["draft"]
    assert with_template_photos(draft, MEDIA_IDS) == case["withPhotos"]


@pytest.mark.parametrize("case", CASES["renders"], ids=lambda c: c["label"])
def test_rendered_pages_match_the_typescript_renderer(case):
    html = render_site_page(case["draft"], case["b"], case["media"], case["page"])
    assert strip(html) == case["html"]


@pytest.mark.parametrize(
    "case", CASES["messages"], ids=lambda c: f"{c['theme']['language']}/{c['page']['title']}"
)
def test_message_pages_match(case):
    assert strip(render_site_message_page(case["theme"], case["b"], case["page"])) == case["html"]


@pytest.mark.parametrize(
    "case", CASES["hoursCases"], ids=lambda c: f"{c['lang']}/{(c['lines'] or ['none'])[0]}"
)
def test_hours_summary_matches(case):
    assert hours_summary(case["hours"], case["lang"]) == case["lines"]
