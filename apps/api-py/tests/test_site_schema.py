"""The site draft contract (ported from packages/shared/src/site.test.ts)."""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.errors import AppError
from app.shared.business import normalize_phone
from app.shared.site import (
    DEFAULT_CONTACT_FORM,
    RESERVED_SUBDOMAINS,
    TEMPLATE_KEYS,
    ContactSection,
    CustomColors,
    SaveDraftRequest,
    Section,
    SetSubdomainRequest,
    check_draft,
    contrast_with_white,
    darken_for_contrast,
    dump,
    mix_hex,
    resolve_palette,
    template_for_industry,
)
from app.shared.site_templates import build_template_draft

BUSINESS = {
    "name": "מספרת שירן",
    "industry": "beauty",
    "phone": "+972501234567",
    "address": "הרצל 10, חיפה",
    "serviceAreas": ["חיפה", "יקנעם"],
    "openingHours": None,
}
SECTION = TypeAdapter(Section)


def save_request(**over):
    draft = build_template_draft("beauty", BUSINESS)
    return {"revision": 0, **draft, **over}


@pytest.mark.parametrize("key", TEMPLATE_KEYS)
@pytest.mark.parametrize("lang", ["he", "en"])
def test_every_template_draft_is_valid_against_the_save_schema(key, lang):
    draft = build_template_draft(key, BUSINESS, lang)
    parsed = SaveDraftRequest.model_validate({"revision": 0, **draft})
    check_draft(parsed.sections, parsed.pages)
    assert parsed.sections[0].type == "hero" and parsed.sections[0].title == BUSINESS["name"]
    # A validated draft dumps back to what the template made, defaults and all.
    assert dump(parsed)["sections"] == draft["sections"]
    assert dump(parsed)["theme"] == draft["theme"]


def test_absent_optional_keys_stay_absent_and_defaults_stay_present():
    parsed = SaveDraftRequest.model_validate(save_request())
    section = dump(parsed)["sections"][0]
    assert "navLabel" not in section and "style" not in section and "secondaryLabel" not in section
    assert section["imageAssetId"] is None
    assert dump(parsed)["theme"]["logoAssetId"] is None and "custom" not in dump(parsed)["theme"]
    # An explicit null stays a null.
    theme = {**build_template_draft("beauty", BUSINESS)["theme"], "custom": None}
    assert dump(SaveDraftRequest.model_validate(save_request(theme=theme)))["theme"]["custom"] is None


def test_contact_sections_without_a_form_get_the_default_form():
    section = SECTION.validate_python(
        {
            "id": "c",
            "type": "contact",
            "visible": True,
            "title": "t",
            "subtitle": "",
            "showPhone": True,
            "showAddress": True,
            "showHours": True,
        }
    )
    assert isinstance(section, ContactSection) and dump(section)["form"] == DEFAULT_CONTACT_FORM


def test_text_is_trimmed_and_limits_have_hebrew_messages():
    section = SECTION.validate_python(
        {
            "id": "h",
            "type": "hero",
            "visible": True,
            "title": "  שלום  ",
            "subtitle": "",
            "buttonLabel": "",
            "buttonAction": "call",
        }
    )
    assert section.title == "שלום"
    with pytest.raises(ValidationError) as err:
        SECTION.validate_python(
            {
                "id": "h",
                "type": "hero",
                "visible": True,
                "title": "x" * 121,
                "subtitle": "",
                "buttonLabel": "",
                "buttonAction": "call",
            }
        )
    assert "הכותרת יכולה להכיל עד 120 תווים" in str(err.value)
    with pytest.raises(ValidationError):
        SECTION.validate_python({"id": "bad id!", "type": "faq", "visible": True, "title": "", "items": []})
    with pytest.raises(ValidationError):
        SECTION.validate_python({"id": "z", "type": "nope", "visible": True})
    with pytest.raises(ValidationError) as many:
        SECTION.validate_python(
            {
                "id": "s",
                "type": "services",
                "visible": True,
                "title": "",
                "items": [{"name": "x", "description": ""}] * 21,
            }
        )
    assert "אפשר להוסיף עד 20 פריטים" in str(many.value)


def test_duplicate_section_ids_and_page_slugs_are_refused():
    draft = save_request()
    draft["sections"] = [*draft["sections"], draft["sections"][0]]
    parsed = SaveDraftRequest.model_validate(draft)
    with pytest.raises(AppError) as err:
        check_draft(parsed.sections, parsed.pages)
    assert err.value.fields == {"sections": "מזהי מקטעים כפולים"}

    page = {
        "id": "p1",
        "slug": "about",
        "title": "אודות",
        "inMenu": True,
        "seo": {"title": "", "description": ""},
        "sections": [],
    }
    parsed = SaveDraftRequest.model_validate(save_request(pages=[page, {**page, "id": "p2"}]))
    with pytest.raises(AppError) as err:
        check_draft(parsed.sections, parsed.pages)
    assert err.value.fields == {"pages.1.slug": "כבר יש עמוד בכתובת הזו"}


@pytest.mark.parametrize("slug", ["media", "api", "Bad Slug", "-x", "x-", "a" * 41, ""])
def test_page_slugs_are_validated(slug):
    page = {
        "id": "p",
        "slug": slug,
        "title": "אודות",
        "inMenu": True,
        "seo": {"title": "", "description": ""},
        "sections": [],
    }
    with pytest.raises(ValidationError):
        SaveDraftRequest.model_validate(save_request(pages=[page]))


def test_page_slugs_are_lowercased_and_there_is_a_limit_of_ten_pages():
    page = {
        "id": "p",
        "slug": " About-Us ",
        "title": "אודות",
        "inMenu": True,
        "seo": {"title": "", "description": ""},
        "sections": [],
    }
    assert SaveDraftRequest.model_validate(save_request(pages=[page])).pages[0].slug == "about-us"
    with pytest.raises(ValidationError) as err:
        SaveDraftRequest.model_validate(
            save_request(pages=[{**page, "id": f"p{i}", "slug": f"s{i}"} for i in range(11)])
        )
    assert "אפשר עד 10 עמודים נוספים" in str(err.value)


def test_a_stale_or_negative_revision_is_refused():
    with pytest.raises(ValidationError):
        SaveDraftRequest.model_validate(save_request(revision=-1))


@pytest.mark.parametrize(
    ("raw", "expected"), [("  Shiran-Salon ", "shiran-salon"), ("abc", "abc"), ("a1-b2", "a1-b2")]
)
def test_subdomains_are_normalised(raw, expected):
    assert SetSubdomainRequest(subdomain=raw).subdomain == expected


@pytest.mark.parametrize(
    "raw", ["", "ab", "-abc", "abc-", "a_b_c", "שלום", "a" * 41, *sorted(RESERVED_SUBDOMAINS)[:5]]
)
def test_bad_or_reserved_subdomains_are_refused(raw):
    with pytest.raises(ValidationError):
        SetSubdomainRequest(subdomain=raw)


def test_custom_colours_need_a_readable_main_colour_and_light_ones_can_be_darkened():
    assert CustomColors(primary="#123456", accent="#ff8800").primary == "#123456"
    with pytest.raises(ValidationError) as err:
        CustomColors(primary="#ffee88", accent="#ff8800")
    assert "בהיר מדי" in str(err.value)
    with pytest.raises(ValidationError):
        CustomColors(primary="red", accent="#ff8800")
    assert contrast_with_white("#ffee88") < 4.5 <= contrast_with_white(darken_for_contrast("#ffee88"))
    assert mix_hex("#000000", "#ffffff", 0.5) == "#808080"


def test_the_palette_resolves_to_custom_colours_when_set():
    assert resolve_palette({"palette": "navy"})["primary"] == "#1d3b63"
    custom = resolve_palette({"palette": "navy", "custom": {"primary": "#123456", "accent": "#ff8800"}})
    assert custom["accent"] == "#ff8800" and custom["soft"] == mix_hex("#123456", "#ffffff", 0.92)


def test_templates_are_suggested_from_the_industry():
    assert template_for_industry("barber") == "beauty"
    assert template_for_industry("garage") == "garage"
    assert template_for_industry("restaurant") == "food"
    assert template_for_industry("psychology") == "clinic"
    assert template_for_industry("electrician") == "trades" and template_for_industry("unknown") == "trades"


def test_the_phone_normaliser_feeds_the_renderer_number_format():
    assert normalize_phone("050-1234567") == "+972501234567"
