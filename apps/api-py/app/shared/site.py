"""F04 site builder contract (packages/shared/src/site.ts): limits, messages, palettes, fonts,
section/page/theme schemas, subdomain rules and the API shapes.

Drafts are plain JSON on the Site row. Validation (Pydantic) happens at the API boundary and when
stored JSON is read back; rendering works on the validated dicts.
"""

import re
from typing import Annotated, Any, ClassVar, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    model_serializer,
)

# ---------------------------------------------------------------------------- limits & messages

SITE_LIMITS = {
    "sections": 20,
    "pages": 10,
    "items": 20,
    "title": 120,
    "shortText": 300,
    "body": 2000,
    "price": 40,
}

SITE_MESSAGES = {
    "titleTooLong": f"הכותרת יכולה להכיל עד {SITE_LIMITS['title']} תווים",
    "textTooLong": f"הטקסט יכול להכיל עד {SITE_LIMITS['shortText']} תווים",
    "bodyTooLong": f"הטקסט יכול להכיל עד {SITE_LIMITS['body']} תווים",
    "priceTooLong": f"המחיר יכול להכיל עד {SITE_LIMITS['price']} תווים",
    "tooManyItems": f"אפשר להוסיף עד {SITE_LIMITS['items']} פריטים",
    "tooManySections": f"אפשר להוסיף עד {SITE_LIMITS['sections']} מקטעים",
    "required": "שדה חובה",
    "revisionConflict": "האתר נערך בינתיים בחלון אחר. טענו מחדש כדי לראות את הגרסה העדכנית.",
    "siteExists": "לעסק כבר יש אתר",
    "subdomainRequired": "יש לבחור כתובת לאתר",
    "subdomainInvalid": "אפשר להשתמש באותיות באנגלית, ספרות ומקף (3–40 תווים), בלי מקף בהתחלה או בסוף",
    "subdomainReserved": "הכתובת הזו שמורה למערכת. נסו כתובת אחרת",
    "subdomainTaken": "הכתובת הזו כבר תפוסה. נסו כתובת אחרת",
    "publishStale": "יש שינויים שעדיין נשמרים. נסו לפרסם שוב בעוד רגע",
    "pageTitleRequired": "יש לתת שם לעמוד",
    "pageSlugInvalid": "כתובת העמוד: אותיות באנגלית, ספרות ומקף (עד 40 תווים)",
    "pageSlugReserved": "הכתובת הזו שמורה למערכת. בחרו כתובת אחרת",
    "pageSlugTaken": "כבר יש עמוד בכתובת הזו",
    "tooManyPages": "אפשר עד 10 עמודים נוספים",
}
M = SITE_MESSAGES

# ---------------------------------------------------------------------------- subdomain (F06)

# Names that must never be a customer's subdomain (platform hosts and confusing words).
RESERVED_SUBDOMAINS = frozenset(
    "www app api admin administrator mail email smtp static assets cdn media files help support blog "
    "status docs dashboard login signin signup register account billing leadflow simplecatch test dev "
    "staging preview public root system security abuse postmaster".split()
)
_SUBDOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$")


def validate_subdomain(v: Any) -> str:
    """Lowercase letters, digits and hyphens; 3-40 chars; no leading/trailing hyphen."""
    if not isinstance(v, str):
        raise ValueError(M["subdomainRequired"])
    s = v.strip().lower()
    if not s:
        raise ValueError(M["subdomainRequired"])
    if not _SUBDOMAIN.match(s):
        raise ValueError(M["subdomainInvalid"])
    if s in RESERVED_SUBDOMAINS:
        raise ValueError(M["subdomainReserved"])
    return s


# ---------------------------------------------------------------------------- field helpers


def _text(limit: int, message: str, *, required: str | None = None):
    def check(v: Any) -> str:
        if not isinstance(v, str):
            raise ValueError(required or "Expected string")
        s = v.strip()
        if required and not s:
            raise ValueError(required)
        if len(s) > limit:
            raise ValueError(message)
        return s

    return BeforeValidator(check)


Title = Annotated[str, _text(SITE_LIMITS["title"], M["titleTooLong"])]
Short = Annotated[str, _text(SITE_LIMITS["shortText"], M["textTooLong"])]
Body = Annotated[str, _text(SITE_LIMITS["body"], M["bodyTooLong"])]
Price = Annotated[str, _text(SITE_LIMITS["price"], M["priceTooLong"])]
Label40 = Annotated[str, _text(40, M["textTooLong"])]
Label30 = Annotated[str, _text(30, M["textTooLong"])]
Label60 = Annotated[str, _text(60, M["textTooLong"])]
Author = Annotated[str, _text(80, M["textTooLong"])]
AltText = Annotated[str, _text(160, M["textTooLong"])]
_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _id(v: Any) -> str:
    if not isinstance(v, str) or not _ID.match(v):
        raise ValueError("Invalid")
    return v


Id = Annotated[str, BeforeValidator(_id)]


class SiteModel(BaseModel):
    """Optional keys that were absent are omitted again when dumped (Zod's `.optional()`), while
    defaults and explicit nulls are kept."""

    model_config = ConfigDict(extra="ignore")
    _omit_when_unset: ClassVar[frozenset[str]] = frozenset()

    @model_serializer(mode="wrap")
    def _serialize(self, handler: Any) -> dict[str, Any]:
        data = handler(self)
        for key in self._omit_when_unset:
            if data.get(key) is None and key not in self.model_fields_set:
                data.pop(key, None)
        return data


# ---------------------------------------------------------------------------- sections

SECTION_TYPES = ("hero", "about", "services", "gallery", "pricing", "testimonials", "faq", "contact", "cta")
HERO_ACTIONS = ("call", "contact")

DEFAULT_CONTACT_FORM: dict[str, Any] = {
    "enabled": True,
    "askEmail": True,
    "askMessage": True,
    "buttonLabel": "שליחה",
    "successMessage": "תודה! קיבלנו את הפרטים ונחזור אליכם בהקדם.",
    "askAppointment": False,
}


class SectionStyle(SiteModel):
    """Look of a section, chosen from the site palette (D-082). All optional = defaults."""

    _omit_when_unset = frozenset({"bg", "align", "spacing", "titleColor", "titleSize", "button"})
    bg: Literal["auto", "white", "soft", "brand", "dark"] | None = None
    align: Literal["start", "center"] | None = None
    spacing: Literal["compact", "normal", "airy"] | None = None
    titleColor: Literal["ink", "brand", "accent"] | None = None
    titleSize: Literal["normal", "large"] | None = None
    button: Literal["solid", "outline"] | None = None


class _Section(SiteModel):
    _omit_when_unset = frozenset({"navLabel", "style"})
    id: Id
    visible: bool
    navLabel: Label30 | None = None  # short name in the menu and above the title (D-075)
    style: SectionStyle | None = None


def _non_empty_label(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(M["required"])
    if len(v.strip()) > 40:
        raise ValueError(M["textTooLong"])
    return v.strip()


class ContactForm(SiteModel):
    """Lead form inside the contact section (F07)."""

    enabled: bool
    askEmail: bool
    askMessage: bool
    buttonLabel: Annotated[str, BeforeValidator(_non_empty_label)]
    successMessage: Short
    askAppointment: bool = False  # F17: let visitors request an appointment


def _uuid_or_none(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str) or not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", v
    ):
        raise ValueError("Invalid uuid")
    return v


def _uuid(v: Any) -> str:
    out = _uuid_or_none(v)
    if out is None:
        raise ValueError("Invalid uuid")
    return out


ImageRef = Annotated[str | None, BeforeValidator(_uuid_or_none)]
UuidStr = Annotated[str, BeforeValidator(_uuid)]


class HeroSection(_Section):
    _omit_when_unset = frozenset({"navLabel", "style", "secondaryLabel"})
    type: Literal["hero"]
    title: Title
    subtitle: Short
    buttonLabel: Label40
    buttonAction: Literal["call", "contact"]
    secondaryLabel: Label40 | None = None  # the second button; empty = automatic label (D-075)
    imageAssetId: ImageRef = None  # background image (decorative)


class AboutSection(_Section):
    type: Literal["about"]
    title: Title
    body: Body
    imageAssetId: ImageRef = None
    imageAlt: AltText = ""


class GalleryItem(SiteModel):
    assetId: UuidStr
    caption: AltText = ""


def _items_max(v: Any) -> Any:
    if isinstance(v, list) and len(v) > SITE_LIMITS["items"]:
        raise ValueError(M["tooManyItems"])
    return v


Items = BeforeValidator(_items_max)


class GallerySection(_Section):
    type: Literal["gallery"]
    title: Title
    items: Annotated[list[GalleryItem], Items]


class ServiceItem(SiteModel):
    name: Title
    description: Short


class ServicesSection(_Section):
    type: Literal["services"]
    title: Title
    items: Annotated[list[ServiceItem], Items]


class PriceItem(SiteModel):
    name: Title
    price: Price


class PricingSection(_Section):
    type: Literal["pricing"]
    title: Title
    note: Short
    items: Annotated[list[PriceItem], Items]


class TestimonialItem(SiteModel):
    quote: Short
    author: Author


class TestimonialsSection(_Section):
    type: Literal["testimonials"]
    title: Title
    items: Annotated[list[TestimonialItem], Items]


class FaqItem(SiteModel):
    question: Title
    answer: Short


class FaqSection(_Section):
    type: Literal["faq"]
    title: Title
    items: Annotated[list[FaqItem], Items]


class ContactSection(_Section):
    type: Literal["contact"]
    title: Title
    subtitle: Short
    showPhone: bool
    showAddress: bool
    showHours: bool
    form: ContactForm = Field(default_factory=lambda: ContactForm(**DEFAULT_CONTACT_FORM))


class CtaSection(_Section):
    type: Literal["cta"]
    title: Title
    subtitle: Short
    buttonLabel: Label40


Section = Annotated[
    HeroSection
    | AboutSection
    | GallerySection
    | ServicesSection
    | PricingSection
    | TestimonialsSection
    | FaqSection
    | ContactSection
    | CtaSection,
    Field(discriminator="type"),
]

# ---------------------------------------------------------------------------- pages (D-081)

RESERVED_PAGE_SLUGS = frozenset({"media", "sitemap", "robots", "index", "api", "q"})
_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _slug(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError(M["pageSlugInvalid"])
    s = v.strip().lower()
    if not _SLUG.match(s) or len(s) > 40:
        raise ValueError(M["pageSlugInvalid"])
    if s in RESERVED_PAGE_SLUGS:
        raise ValueError(M["pageSlugReserved"])
    return s


def _page_title(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(M["pageTitleRequired"])
    if len(v.strip()) > 30:
        raise ValueError(M["textTooLong"])
    return v.strip()


SEO_TITLE = Annotated[str, _text(70, "כותרת לגוגל יכולה להכיל עד 70 תווים")]
SEO_DESCRIPTION = Annotated[str, _text(160, "תיאור לגוגל יכול להכיל עד 160 תווים")]


class Seo(SiteModel):
    title: SEO_TITLE
    description: SEO_DESCRIPTION


def _sections_max(v: Any) -> Any:
    if isinstance(v, list) and len(v) > SITE_LIMITS["sections"]:
        raise ValueError(M["tooManySections"])
    return v


Sections = Annotated[list[Section], BeforeValidator(_sections_max)]


class SitePage(SiteModel):
    id: Id
    slug: Annotated[str, BeforeValidator(_slug)]
    title: Annotated[str, BeforeValidator(_page_title)]  # name in the site menu
    inMenu: bool
    seo: Seo
    sections: Sections


# ---------------------------------------------------------------------------- theme

PALETTES = {
    "teal": {"label": "טורקיז", "primary": "#1f6a66", "accent": "#ec6640", "soft": "#edf7f6"},
    "rose": {"label": "ורוד עתיק", "primary": "#9b2f52", "accent": "#d98a5f", "soft": "#fbf0f3"},
    "navy": {"label": "כחול עמוק", "primary": "#1d3b63", "accent": "#e8962f", "soft": "#eef3f9"},
    "forest": {"label": "ירוק יער", "primary": "#2f5d3a", "accent": "#c98a2b", "soft": "#f0f6f0"},
    "plum": {"label": "שזיף", "primary": "#5b2f73", "accent": "#e07a8b", "soft": "#f5f0f8"},
    "graphite": {"label": "גרפיט", "primary": "#2b3440", "accent": "#e0a526", "soft": "#f2f3f5"},
}
PaletteKey = Literal["teal", "rose", "navy", "forest", "plum", "graphite"]

FONTS = {
    "rubik": {"label": "רוביק — עגול וידידותי", "family": "Rubik"},
    "heebo": {"label": "חיבו — נקי ומודרני", "family": "Heebo"},
    "assistant": {"label": "אסיסטנט — קליל", "family": "Assistant"},
    "frank": {"label": "פרנק ריהל — קלאסי", "family": "Frank Ruhl Libre"},
}
FontKey = Literal["rubik", "heebo", "assistant", "frank"]

_HEX = re.compile(r"^#[0-9a-f]{6}$", re.I)


def _channels(hexcolor: str) -> list[int]:
    return [int(hexcolor[i : i + 2], 16) for i in (1, 3, 5)]


def _luminance(hexcolor: str) -> float:
    r, g, b = (
        (c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
        for c in (v / 255 for v in _channels(hexcolor))
    )
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_with_white(hexcolor: str) -> float:
    """WCAG contrast ratio of a colour against white (buttons carry white text)."""
    return 1.05 / (_luminance(hexcolor) + 0.05)


MIN_BRAND_CONTRAST = 4.5  # white button text on the main colour (WCAG AA, normal text)


def _round_half_up(x: float) -> int:
    import math

    return math.floor(x + 0.5)


def _to_hex(rgb: list[float]) -> str:
    return "#" + "".join(f"{_round_half_up(min(255, max(0, v))):02x}" for v in rgb)


def mix_hex(hexcolor: str, other: str, t: float) -> str:
    """Mixes a colour with another (`t` = share of `other`, 0-1)."""
    a, b = _channels(hexcolor), _channels(other)
    return _to_hex([v + (b[i] - v) * t for i, v in enumerate(a)])


def darken_for_contrast(hexcolor: str, minimum: float = MIN_BRAND_CONTRAST) -> str:
    out = hexcolor.lower()
    for _ in range(40):
        if contrast_with_white(out) >= minimum:
            break
        out = mix_hex(out, "#000000", 0.06)
    return out


def _brand_color(v: Any) -> str:
    if not isinstance(v, str) or not _HEX.match(v):
        raise ValueError("צבע לא תקין")
    if contrast_with_white(v) < MIN_BRAND_CONTRAST:
        raise ValueError("הצבע הראשי בהיר מדי לטקסט לבן על כפתורים. בחרו גוון כהה יותר")
    return v


def _accent_color(v: Any) -> str:
    if not isinstance(v, str) or not _HEX.match(v):
        raise ValueError("צבע לא תקין")
    return v


class CustomColors(SiteModel):
    primary: Annotated[str, BeforeValidator(_brand_color)]
    accent: Annotated[str, BeforeValidator(_accent_color)]


class ThemeLabels(SiteModel):
    _omit_when_unset = frozenset({"mobileCall", "mobileContact", "cardLink"})
    mobileCall: Label30 | None = None
    mobileContact: Label30 | None = None
    cardLink: Label60 | None = None


class Theme(SiteModel):
    _omit_when_unset = frozenset({"language", "custom", "labels"})
    language: Literal["he", "en"] | None = None  # customer website language (D-142); unset = Hebrew
    palette: PaletteKey
    custom: CustomColors | None = None  # owner-chosen colours replace the palette's (D-083)
    font: FontKey
    logoAssetId: ImageRef = None
    labels: ThemeLabels | None = None


def resolve_palette(theme: dict[str, Any]) -> dict[str, str]:
    """The colours a site actually uses: its custom colours, or the chosen palette."""
    custom = theme.get("custom")
    if custom:
        return {
            "primary": custom["primary"],
            "accent": custom["accent"],
            "soft": mix_hex(custom["primary"], "#ffffff", 0.92),
        }
    p = PALETTES[theme["palette"]]
    return {"primary": p["primary"], "accent": p["accent"], "soft": p["soft"]}


# ---------------------------------------------------------------------------- templates

TEMPLATE_KEYS = ("beauty", "trades", "garage", "clinic", "food")
TemplateKey = Literal["beauty", "trades", "garage", "clinic", "food"]

_BEAUTY = (
    "beauty studio events photo barber nails makeup spa tattoo hairremoval yoga fitness dance "
    "martialarts florist designer weddings venue rentals jewelry videography"
).split()
_GARAGE = "garage carwash tires motorcycle towing".split()
_FOOD = "catering bartender bakery restaurant cafe foodtruck".split()
_CLINIC = (
    "therapy tutoring physio psychology nutrition dental alternative vet speech optics coaching kids "
    "music languages driving childcare eldercare"
).split()
TEMPLATE_BY_INDUSTRY: dict[str, str] = {
    **dict.fromkeys(_BEAUTY, "beauty"),
    **dict.fromkeys(_GARAGE, "garage"),
    **dict.fromkeys(_FOOD, "food"),
    **dict.fromkeys(_CLINIC, "clinic"),
}


def template_for_industry(industry: str) -> str:
    """Suggested template for an industry (owners can pick either)."""
    return TEMPLATE_BY_INDUSTRY.get(industry, "trades")


# ---------------------------------------------------------------------------- draft + API


def check_draft(sections: list[Any], pages: list[Any]) -> None:
    """Unique section ids and page addresses across the whole site (forms post by id)."""
    from app.errors import AppError

    slugs: set[str] = set()
    for i, p in enumerate(pages):
        if p.slug in slugs:
            msg = M["pageSlugTaken"]
            raise AppError("VALIDATION_ERROR", None, {f"pages.{i}.slug": msg})
        slugs.add(p.slug)
    ids = [s.id for s in sections] + [s.id for p in pages for s in p.sections]
    if len(set(ids)) != len(ids):
        raise AppError("VALIDATION_ERROR", None, {"sections": "מזהי מקטעים כפולים"})


def _pages_max(v: Any) -> Any:
    if isinstance(v, list) and len(v) > SITE_LIMITS["pages"]:
        raise ValueError(M["tooManyPages"])
    return v


class SaveDraftRequest(SiteModel):
    """Full draft replace, guarded by the revision the client last saw (409 when stale)."""

    revision: Annotated[int, Field(ge=0)]
    templateKey: TemplateKey
    theme: Theme
    seo: Seo
    sections: Sections
    pages: Annotated[list[SitePage], BeforeValidator(_pages_max)] = Field(default_factory=list)


class CreateSiteRequest(BaseModel):
    templateKey: TemplateKey
    language: Literal["he", "en"] | None = None  # omitted = the business's language (D-143)


class SetSubdomainRequest(BaseModel):
    subdomain: Annotated[str, BeforeValidator(validate_subdomain)]


class PublishRequest(BaseModel):
    """Publishes exactly the draft revision the owner is looking at (409 if it moved on)."""

    revision: Annotated[int, Field(ge=0)]


class ChangeTemplateRequest(BaseModel):
    templateKey: TemplateKey
    revision: Annotated[int, Field(ge=0)]


def dump(model: BaseModel) -> dict[str, Any]:
    """A validated model as the JSON-able dict stored on the site row and sent to clients."""
    return model.model_dump(mode="json")
