"""Renders a site draft to a complete, static HTML document, in the site's language and direction
(packages/shared/src/site-render.ts).

Security: every user-provided string goes through `esc()`. URLs are never user-provided: only
`tel:` from a validated E.164 phone and a Google Maps search URL built with a percent-encoded
query. No scripts are emitted. The editor-preview mode of the TypeScript renderer is not ported:
the editor runs in the browser; the server only publishes.
"""

import re
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.shared.business import WEEKDAYS
from app.shared.phone import format_israeli_phone
from app.shared.site import FONTS, resolve_palette
from app.shared.site_i18n import fill, site_text

LEAD_FORM_PATH = "/__lead"
FORM_TOKEN_PLACEHOLDER = "__LF_FORM_TOKEN__"  # replaced by the public server per page view
HONEYPOT_FIELD = "website"  # visitors never see it; bots tend to fill it
SECTION_TYPES = ("hero", "about", "services", "gallery", "pricing", "testimonials", "faq", "contact", "cta")

_CSS = Path(__file__).parent / "data" / "site.css"

ICONS = {
    "phone": '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    "pin": '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "chat": '<path d="M4 5h16v11H8l-4 4z"/>',
    "arrow": '<path d="M19 12H5m6-6l-6 6 6 6"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
}


def esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _encode_uri_component(s: str) -> str:
    return quote(s, safe="-_.!~*'()")


def paragraphs(s: str) -> str:
    """Escapes and keeps the owner's line breaks."""
    return "".join(f"<p>{esc(p).replace(chr(10), '<br>')}</p>" for p in re.split(r"\n{2,}", s))


def tel_href(e164: str) -> str:
    return f"tel:{re.sub(r'[^+0-9]', '', e164)}"


def maps_href(address: str) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={_encode_uri_component(address)}"


def img(m: dict[str, Any], alt: str, cls: str, lazy: bool = True, extra: str = "") -> str:
    loading = ' loading="lazy" decoding="async"' if lazy else ""
    return (
        f'<img class="{cls}" src="{esc(m["url"])}" alt="{esc(alt)}" width="{m["width"]}" height="{m["height"]}"'
        f"{loading}{extra}>"
    )


def icon(name: str, cls: str = "ic") -> str:
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[name]}</svg>'


def _appointment_fields(b: dict[str, Any], L: dict[str, Any]) -> str:
    """F17: optional appointment request (confirmed by the business afterwards)."""
    services = b.get("services") or []
    form = L["form"]
    options = "".join(f'<option value="{esc(x["id"])}">{esc(x["name"])}</option>' for x in services)
    service_field = (
        f'<label>{form["service"]}<select name="serviceId"><option value="">{form["chooseService"]}</option>'
        f"{options}</select></label>"
        if services
        else ""
    )
    return (
        f'<fieldset class="slot"><legend>{form["slot"]}</legend>{service_field}'
        f'<div class="slot-row"><label>{form["date"]}<input name="date" type="date"></label>'
        f'<label>{form["time"]}<input name="time" type="time" step="900"></label></div>'
        f'<p class="slot-note">{form["slotNote"]}</p></fieldset>'
    )


def _lead_form(s: dict[str, Any], b: dict[str, Any], page_slug: str, L: dict[str, Any]) -> str:
    """Plain HTML lead form (no JavaScript on customer sites). Browser-side checks via HTML
    attributes; the server validates again. The token placeholder is replaced per page view."""
    f, form = s["form"], L["form"]
    email = (
        f'<label>{form["email"]}<input name="email" type="email" dir="ltr" maxlength="254" autocomplete="email"></label>'
        if f["askEmail"]
        else ""
    )
    message = (
        f'<label>{form["message"]}<textarea name="message" rows="4" maxlength="1000"></textarea></label>'
        if f["askMessage"]
        else ""
    )
    appointment = _appointment_fields(b, L) if f["askAppointment"] else ""
    return (
        f'<form class="lead-form" method="post" action="{LEAD_FORM_PATH}" aria-label="{form["label"]}">\n'
        f'<input type="hidden" name="_t" value="{FORM_TOKEN_PLACEHOLDER}"><input type="hidden" name="_s" value="{esc(s["id"])}">'
        f'<input type="hidden" name="_p" value="{esc(page_slug)}">\n'
        f'<div class="hp" aria-hidden="true"><label>{form["website"]}<input name="{HONEYPOT_FIELD}" tabindex="-1" autocomplete="off"></label></div>\n'
        f'<label>{form["name"]}<input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>\n'
        f'<label>{form["phone"]}<input name="phone" type="tel" required inputmode="tel" dir="ltr" maxlength="20" '
        r'pattern="[0-9+()\s\-]{9,20}" '
        f'title="{form["phoneHint"]}" autocomplete="tel"></label>\n'
        f"{email}\n"
        f"{message}\n"
        f"{appointment}\n"
        f'<label class="consent"><input type="checkbox" name="consent" required> {esc(fill(form["consent"], b["name"]))}</label>\n'
        f'<button class="btn" type="submit">{esc(f["buttonLabel"])}</button>\n'
        f"</form>"
    )


def hours_summary(hours: dict[str, Any] | None, lang: str | None = None) -> list[str]:
    """ "ראשון–חמישי 09:00–18:00" lines, grouping consecutive days with the same hours."""
    if not hours:
        return []
    days = site_text(lang)["weekdays"]
    groups: list[dict[str, str]] = []
    for d in WEEKDAYS:
        h = hours.get(d)
        key = f"{h['from']}–{h['to']}" if h and h.get("open") else "סגור"
        if groups and groups[-1]["key"] == key:
            groups[-1]["to"] = days[d]
        else:
            groups.append({"from": days[d], "to": days[d], "key": key})
    return [
        f"{g['from'] if g['from'] == g['to'] else g['from'] + '–' + g['to']} {g['key']}"
        for g in groups
        if g["key"] != "סגור"
    ]


def hours_html(line: str) -> str:
    """Hours line with times kept left-to-right."""
    m = re.search(r"[0-9]", line)
    if not m:
        return esc(line)
    return f'{esc(line[: m.start()])}<bdi dir="ltr">{esc(line[m.start() :])}</bdi>'


def _nav_label(s: dict[str, Any], L: dict[str, Any]) -> str:
    """The section's short name: menu item and the label above its title."""
    return s.get("navLabel") or L["nav"].get(s["type"]) or ""


def _heading(eyebrow: str | None, title: str, sub: str | None = None) -> str:
    eb = f'<span class="eyebrow"><span>{esc(eyebrow)}</span></span>' if eyebrow else ""
    lead = f'<p class="lead">{esc(sub)}</p>' if sub is not None else ""
    return f'<div class="head">{eb}<h2>{esc(title)}</h2>{lead}</div>'


def _style_classes(s: dict[str, Any], alt: bool) -> str:
    """Classes for a section's chosen look (D-082); `alt` = the automatic soft alternation."""
    st = s.get("style") or {}
    bg = st.get("bg") or "auto"
    spacing = st.get("spacing")
    title_color = st.get("titleColor")
    parts = [
        "soft" if bg == "soft" or (bg == "auto" and alt) else "",
        "sec-brand" if bg == "brand" else "",
        "sec-dark" if bg == "dark" else "",
        "al-center" if st.get("align") == "center" else "",
        "sp-compact" if spacing == "compact" else "sp-airy" if spacing == "airy" else "",
        "tc-brand" if title_color == "brand" else "tc-accent" if title_color == "accent" else "",
        "ts-large" if st.get("titleSize") == "large" else "",
        "btn-outline" if st.get("button") == "outline" else "",
    ]
    return " ".join(p for p in parts if p)


def _with_classes(base: str, extra: str) -> str:
    return " ".join(p for p in (base, extra) if p)


class _Ctx:
    def __init__(self, b, contact_href, page_slug, media, testimonial_count, labels, lang):
        self.b = b
        self.contact_href = contact_href  # on this page, or on the home page (D-081); '' = none
        self.page_slug = page_slug  # current page address ('' = home), posted with the lead form
        self.media = media
        self.testimonial_count = testimonial_count
        self.labels = labels
        self.lang = lang
        self.L = site_text(lang)


def _hero(s: dict[str, Any], sid: str, c: _Ctx) -> str:
    k = _style_classes(s, False)
    b, L = c.b, c.L
    call = tel_href(b["phone"]) if b.get("phone") else ""
    to_contact = c.contact_href
    primary = call if s["buttonAction"] == "call" and call else to_contact
    # The second button offers the other way to reach the business.
    if primary == call and to_contact:
        secondary = f'<a class="btn ghost" href="{to_contact}">{icon("chat")}{esc(s.get("secondaryLabel") or L["leaveDetails"])}</a>'
    elif primary != call and call:
        secondary = f'<a class="btn ghost" href="{call}">{icon("phone")}<bdi dir="ltr">{esc(format_israeli_phone(b["phone"]))}</bdi></a>'
    else:
        secondary = ""
    hours = hours_summary(b.get("openingHours"), c.lang)
    chips = [
        f"{icon('pin')}<span>{esc(' · '.join(b['serviceAreas'][:3]))}</span>" if b["serviceAreas"] else "",
        f"{icon('chat')}{esc(fill(L['recommend'], c.testimonial_count))}" if c.testimonial_count >= 2 else "",
        f"{icon('clock')}<span>{hours_html(hours[0])}</span>" if hours else "",
    ]
    chips = [x for x in chips if x]
    # Short form for the badge: "בעלי מקצוע (חשמל, ...)" → "בעלי מקצוע".
    industry = None
    if b["industry"] != "other":
        label = L["industries"].get(b["industry"])
        industry = re.sub(r"\s*\(.*\)\s*$", "", label) if label else None
    bg = c.media.get(s["imageAssetId"]) if s.get("imageAssetId") else None

    eyebrow = f'<span class="eyebrow">{esc(industry)}</span>' if industry else ""
    lead = f'<p class="lead">{esc(s["subtitle"])}</p>' if s["subtitle"] else ""
    primary_btn = (
        f'<a class="btn" href="{primary}">{esc(s["buttonLabel"])}{icon("arrow", "ic flip")}</a>'
        if s["buttonLabel"] and primary
        else ""
    )
    chips_html = f'<ul class="chips">{"".join(f"<li>{x}</li>" for x in chips)}</ul>' if chips else ""
    text = (
        f'<div class="hero-text">{eyebrow}\n<h1>{esc(s["title"])}</h1>{lead}\n'
        f'<div class="actions">{primary_btn}{secondary}</div>\n{chips_html}</div>'
    )
    if bg:
        return f'<header class="{_with_classes("hero has-img", k)}" id="{sid}">{img(bg, "", "hero-bg", False)}<div class="wrap">{text}</div></header>'
    # No photo: a "business card" with the real contact details balances the layout.
    rows = [
        (
            f'<li>{icon("phone")}<div><span class="k">{L["phone"]}</span><a href="{call}"><bdi dir="ltr">{esc(format_israeli_phone(b["phone"]))}</bdi></a></div></li>'
            if b.get("phone")
            else ""
        ),
        (
            f'<li>{icon("pin")}<div><span class="k">{L["address"]}</span><span>{esc(b["address"])}</span></div></li>'
            if b.get("address")
            else ""
        ),
        (
            f'<li>{icon("clock")}<div><span class="k">{L["hours"]}</span>'
            + "".join(f"<span>{hours_html(ln)}</span>" for ln in hours)
            + "</div></li>"
            if hours
            else ""
        ),
    ]
    rows = [r for r in rows if r]
    aside = ""
    if rows:
        card_link = (
            f'<a class="card-link" href="{to_contact}">{esc(c.labels.get("cardLink") or L["cardLink"])} {icon("arrow", "ic flip")}</a>'
            if to_contact
            else ""
        )
        aside = (
            f'<aside class="biz-card" aria-label="{L["businessDetails"]}"><p class="biz-name">{esc(b["name"])}</p>'
            f"<ul>{''.join(rows)}</ul>{card_link}</aside>"
        )
    return f'<header class="{_with_classes("hero", k)}" id="{sid}"><div class="wrap hero-grid">{text}{aside}</div></header>'


def _section(s: dict[str, Any], c: _Ctx, alt: bool) -> str:
    b, media, L = c.b, c.media, c.L
    sid = f"s-{esc(s['id'])}"
    k = _style_classes(s, alt)
    cls = f' class="{k}"' if k else ""
    head = _heading(_nav_label(s, L), s.get("title", ""), None) if s["type"] != "hero" else ""
    t = s["type"]
    if t == "hero":
        return _hero(s, sid, c)
    if t == "about":
        pic = media.get(s["imageAssetId"]) if s.get("imageAssetId") else None
        if pic:
            return (
                f'<section id="{sid}"{cls}><div class="wrap about-grid"><div class="about-text">{head}'
                f'{paragraphs(s["body"])}</div><div class="about-media">{img(pic, s["imageAlt"], "about-img", True)}</div></div></section>'
            )
        return (
            f'<section id="{sid}"{cls}><div class="wrap narrow about-solo">{head}'
            f'<div class="about-body">{paragraphs(s["body"])}</div></div></section>'
        )
    if t == "gallery":
        pics = [i for i in s["items"] if i["assetId"] in media]
        if not pics:
            return ""
        figures = "".join(
            f"<figure>{img(media[i['assetId']], i['caption'], 'gallery-img', True)}"
            + (f"<figcaption>{esc(i['caption'])}</figcaption>" if i["caption"] else "")
            + "</figure>"
            for i in pics
        )
        feature = " feature" if len(pics) >= 3 else ""
        return f'<section id="{sid}"{cls}><div class="wrap">{head}<div class="gallery{feature}">{figures}</div></div></section>'
    if t == "services":
        cards = "".join(
            f'<article class="card service"><span class="tile">{icon("check")}</span><h3>{esc(i["name"])}</h3>'
            + (f"<p>{esc(i['description'])}</p>" if i["description"] else "")
            + "</article>"
            for i in s["items"]
        )
        return f'<section id="{sid}"{cls}><div class="wrap">{head}<div class="grid services">{cards}</div></div></section>'
    if t == "pricing":
        rows = "".join(
            f'<li><span>{esc(i["name"])}</span><span class="dots"></span><bdi>{esc(i["price"])}</bdi></li>'
            for i in s["items"]
        )
        note = f'<p class="note">{esc(s["note"])}</p>' if s["note"] else ""
        return (
            f'<section id="{sid}"{cls}><div class="wrap narrow">{head}<div class="card price-card">'
            f'<ul class="prices">{rows}</ul>{note}</div></div></section>'
        )
    if t == "testimonials":
        items = [i for i in s["items"] if i["quote"]]
        if not items:
            return ""
        figures = "".join(
            f'<figure class="card quote"><span class="qmark" aria-hidden="true">”</span><blockquote>{esc(i["quote"])}</blockquote>'
            + (
                f'<figcaption><span class="avatar" aria-hidden="true">{esc(i["author"].strip()[:1])}</span>{esc(i["author"])}</figcaption>'
                if i["author"]
                else ""
            )
            + "</figure>"
            for i in items
        )
        return f'<section id="{sid}"{cls}><div class="wrap">{head}<div class="grid">{figures}</div></div></section>'
    if t == "faq":
        shown = [i for i in s["items"] if i["question"]]
        details = "".join(
            f"<details{' open' if n == 0 else ''}><summary>{esc(i['question'])}</summary><p>{esc(i['answer'])}</p></details>"
            for n, i in enumerate(shown)
        )
        return f'<section id="{sid}"{cls}><div class="wrap narrow">{head}<div class="faq">{details}</div></div></section>'
    if t == "contact":
        return _contact(s, c, sid, k, head_sub=True)
    if t == "cta":
        href = tel_href(b["phone"]) if b.get("phone") else c.contact_href
        sub = f"<p>{esc(s['subtitle'])}</p>" if s["subtitle"] else ""
        button = (
            f'<a class="btn light" href="{href}">{icon("phone") if b.get("phone") else ""}{esc(s["buttonLabel"])}</a>'
            if s["buttonLabel"] and href
            else ""
        )
        classes = _with_classes("cta-wrap", re.sub(r"\bsoft\b", "", k, count=1))
        return (
            f'<section id="{sid}" class="{classes}"><div class="wrap"><div class="cta"><div><h2>{esc(s["title"])}</h2>{sub}</div>'
            f"{button}</div></div></section>"
        )
    raise ValueError(f"unknown section type {t}")


def _contact(s: dict[str, Any], c: _Ctx, sid: str, k: str, head_sub: bool) -> str:
    b, L = c.b, c.L
    rows: list[str] = []
    if s["showPhone"] and b.get("phone"):
        rows.append(
            f'<li>{icon("phone")}<div><span class="k">{L["phone"]}</span><a href="{tel_href(b["phone"])}">'
            f'<bdi dir="ltr">{esc(format_israeli_phone(b["phone"]))}</bdi></a></div></li>'
        )
    if s["showAddress"] and b.get("address"):
        rows.append(
            f'<li>{icon("pin")}<div><span class="k">{L["address"]}</span><a href="{maps_href(b["address"])}" '
            f'target="_blank" rel="noopener">{esc(b["address"])}</a></div></li>'
        )
    if b["serviceAreas"]:
        rows.append(
            f'<li>{icon("check")}<div><span class="k">{L["areas"]}</span><span>{esc(", ".join(b["serviceAreas"]))}</span></div></li>'
        )
    hours_table = ""
    if s["showHours"] and b.get("openingHours"):
        trs = []
        for d in WEEKDAYS:
            h = (b["openingHours"] or {}).get(d)
            cell = (
                f'<bdi dir="ltr">{esc(h["from"])}–{esc(h["to"])}</bdi>'
                if h and h.get("open")
                else f'<span class="closed">{L["closed"]}</span>'
            )
            trs.append(f'<tr><th scope="row">{L["weekdays"][d]}</th><td>{cell}</td></tr>')
        hours_table = f'<table class="hours"><caption>{L["hours"]}</caption>{"".join(trs)}</table>'
    form = f'<div class="form-wrap">{_lead_form(s, b, c.page_slug, L)}</div>' if s["form"]["enabled"] else ""
    # One panel: details on a brand-coloured side, the form beside them; either may be alone.
    info = ""
    if rows or hours_table:
        info = f'<div class="contact-info">{"<ul class=" + chr(34) + "info" + chr(34) + ">" + "".join(rows) + "</ul>" if rows else ""}{hours_table}</div>'
    heading = _heading(_nav_label(s, L), s["title"], s["subtitle"] or None)
    grid = ""
    if info or form:
        solo = "" if info and form else " solo"
        grid = f'<div class="contact-grid{solo}">{info}{form}</div>'
    return f'<section id="{sid}" class="{_with_classes("contact", k)}"><div class="wrap">{heading}\n{grid}</div></section>'


@cache
def _css_template() -> str:
    return _CSS.read_text(encoding="utf-8")


def _css(palette: dict[str, str], family: str) -> str:
    return (
        _css_template()
        .replace("__PRIMARY__", palette["primary"])
        .replace("__ACCENT__", palette["accent"])
        .replace("__SOFT__", palette["soft"])
        .replace("__FAMILY__", family)
    )


def _document_head(theme: dict[str, Any], title: str, description: str, noindex: bool = False) -> str:
    lang = theme.get("language") or "he"
    palette = resolve_palette(theme)
    font = FONTS[theme["font"]]
    font_param = _encode_uri_component(font["family"]).replace("%20", "+")
    robots = '<meta name="robots" content="noindex">' if noindex else ""
    return (
        f'<!doctype html>\n<html lang="{lang}" dir="{site_text(lang)["dir"]}">\n<head>\n<meta charset="utf-8">\n'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">{robots}\n'
        f"<title>{esc(title)}</title>\n"
        f'<meta name="description" content="{esc(description)}">\n'
        f'<meta property="og:title" content="{esc(title)}">\n'
        f'<meta property="og:description" content="{esc(description)}">\n'
        f'<meta name="theme-color" content="{palette["primary"]}">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={font_param}:wght@400;500;700;800&display=swap">\n'
        f"<style>{_css(palette, font['family'])}</style>\n</head>"
    )


def render_site_page(
    draft: dict[str, Any],
    b: dict[str, Any],
    media: dict[str, dict[str, Any]] | None = None,
    page: str | None = None,
) -> str:
    """A complete HTML document for the home page, or for the extra page at `page` (D-081)."""
    media = media or {}
    theme = draft["theme"]
    L = site_text(theme.get("language"))
    logo = media.get(theme["logoAssetId"]) if theme.get("logoAssetId") else None
    pages = draft.get("pages") or []
    current = next((p for p in pages if p["slug"] == page), None) if page else None
    visible = [s for s in (current["sections"] if current else draft["sections"]) if s["visible"]]
    if current:
        seo = {
            "title": current["seo"]["title"] or f"{current['title']} · {b['name']}",
            "description": current["seo"]["description"] or draft["seo"]["description"],
        }
    else:
        seo = draft["seo"]
    contact_id = next((s["id"] for s in visible if s["type"] == "contact"), None)
    home_contact_id = next(
        (s["id"] for s in draft["sections"] if s["visible"] and s["type"] == "contact"), None
    )
    contact_href = (
        f"#s-{esc(contact_id)}" if contact_id else f"/#s-{esc(home_contact_id)}" if home_contact_id else ""
    )
    testimonial_count = sum(
        len([i for i in s["items"] if i["quote"]]) for s in visible if s["type"] == "testimonials"
    )
    ctx = _Ctx(
        b, contact_href, current["slug"] if current else "", media, testimonial_count,
        theme.get("labels") or {}, theme.get("language"),
    )  # fmt: skip

    # Header menu: the site's pages when it has any in the menu (D-081); otherwise the first
    # section of each type that has a short label.
    menu_pages = [p for p in pages if p["inMenu"]]

    def page_link(href: str, label: str, is_current: bool) -> str:
        return f'<li><a href="{href}"{" aria-current=" + chr(34) + "page" + chr(34) if is_current else ""}>{esc(label)}</a></li>'

    # The home page's sections stay in the menu, and pages are added after them; a section with
    # the same name as a page ("אודות") gives way to the page (D-086).
    page_titles = {p["title"] for p in menu_pages}
    seen: set[str] = set()
    section_links: list[str] = []
    for s in draft["sections"]:
        if not s["visible"] or not L["nav"].get(s["type"]) or s["type"] in seen:
            continue
        seen.add(s["type"])
        if s["type"] == "gallery" and not any(i["assetId"] in media for i in s["items"]):
            continue
        if _nav_label(s, L) in page_titles:
            continue
        label = esc(_nav_label(s, L))
        section_links.append(
            f'<li><a href="/#s-{esc(s["id"])}">{label}</a></li>'
            if current
            else f'<li><a href="#s-{esc(s["id"])}">{label}</a></li>'
        )
    menu = "".join(
        (
            ([page_link("/", L["home"], False)] if current else [])
            + section_links
            + [
                page_link(f"/{esc(p['slug'])}", p["title"], bool(current) and p["slug"] == current["slug"])
                for p in menu_pages
            ]
        )[:8]
    )

    # Alternate soft backgrounds between content sections (hero and CTA have their own look).
    n = 0
    parts = []
    for s in visible:
        if s["type"] in ("hero", "cta"):
            parts.append(_section(s, ctx, False))
        else:
            parts.append(_section(s, ctx, n % 2 == 1))
            n += 1
    html = "\n".join(parts)

    call = tel_href(b["phone"]) if b.get("phone") else ""
    mbar = ""
    if call or contact_href:
        call_btn = (
            f'<a href="{call}">{icon("phone")}{esc(ctx.labels.get("mobileCall") or L["callNow"])}</a>'
            if call
            else ""
        )
        contact_btn = (
            f'<a{" class=" + chr(34) + "alt" + chr(34) if call else ""} href="{contact_href}">{icon("chat")}{esc(ctx.labels.get("mobileContact") or L["leaveDetails"])}</a>'
            if contact_href
            else ""
        )
        mbar = f'<div class="mbar">{call_btn}{contact_btn}</div>'
    hours = hours_summary(b.get("openingHours"), ctx.lang)
    initial = esc(b["name"].strip()[:1])
    brand = (
        img(logo, b["name"], "logo", False)
        if logo
        else f'<span class="mark" aria-hidden="true">{initial}</span>'
    ) + f"<span>{esc(b['name'])}</span>"

    mobile_menu = (
        f'<details class="mmenu"><summary aria-label="{L["menu"]}">{icon("menu")}</summary><ul>{menu}</ul></details>'
        if menu_pages
        else ""
    )
    call_link = (
        f'<a class="call" href="{call}">{icon("phone")}<span class="num-text"><bdi dir="ltr">{esc(format_israeli_phone(b["phone"]))}</bdi></span></a>'
        if call
        else ""
    )
    foot_pages = (
        '<ul class="foot-pages">'
        + "".join(f'<li><a href="/{esc(p["slug"])}">{esc(p["title"])}</a></li>' for p in menu_pages)
        + "</ul>"
        if menu_pages
        else ""
    )
    foot_desc = f"<p>{esc(draft['seo']['description'])}</p>" if draft["seo"]["description"] else ""
    foot_mark = "" if logo else f'<span class="mark" aria-hidden="true">{initial}</span>'
    contact_col = ""
    if call or b.get("address"):
        li_phone = (
            f'<li><a href="{call}"><bdi dir="ltr">{esc(format_israeli_phone(b["phone"]))}</bdi></a></li>'
            if call
            else ""
        )
        li_addr = (
            f'<li><a href="{maps_href(b["address"])}" target="_blank" rel="noopener">{esc(b["address"])}</a></li>'
            if b.get("address")
            else ""
        )
        contact_col = f"<div><h3>{L['contactUs']}</h3><ul>{li_phone}{li_addr}</ul></div>"
    hours_col = (
        f"<div><h3>{L['hours']}</h3><ul>{''.join(f'<li>{hours_html(ln)}</li>' for ln in hours)}</ul></div>"
        if hours
        else ""
    )
    menu_html = f'<ul class="menu">{menu}</ul>' if menu else ""
    body_class = ' class="has-mbar"' if mbar else ""
    main = html or f'<div class="empty">{L["noSections"]}</div>'
    return (
        f"{_document_head(theme, seo['title'] or b['name'], seo['description'])}\n"
        f"<body{body_class}>\n"
        f'<nav class="nav" aria-label="{L["home"]}"><div class="wrap"><a class="brand" href="/">{brand}</a>{menu_html}{mobile_menu}{call_link}</div></nav>\n'
        f"<main>{main}</main>\n"
        f'<footer><div class="wrap foot"><div><a class="brand" href="/">{foot_mark}{esc(b["name"])}</a>{foot_desc}{foot_pages}</div>\n'
        f"{contact_col}\n"
        f"{hours_col}</div>\n"
        f'<div class="bottom"><div class="wrap">© {esc(b["name"])} · {L["builtWith"]}</div></div></footer>\n'
        f"{mbar}\n"
        f"</body>\n</html>"
    )


def render_site_message_page(theme: dict[str, Any], b: dict[str, Any], page: dict[str, Any]) -> str:
    """Small result page in the site's own look (thank-you, or "please fix" with the errors)."""
    items = page.get("items")
    items_html = f"<ul>{''.join(f'<li>{esc(i)}</li>' for i in items)}</ul>" if items else ""
    return (
        f"{_document_head(theme, page['title'] + ' · ' + b['name'], '', True)}\n"
        f"<body>\n"
        f'<nav class="nav"><div class="wrap"><a class="brand" href="/"><span class="mark" aria-hidden="true">{esc(b["name"].strip()[:1])}</span>'
        f"<span>{esc(b['name'])}</span></a></div></nav>\n"
        f'<main class="msg"><h1>{esc(page["title"])}</h1><p class="lead" style="margin-inline:auto">{esc(page["text"])}</p>'
        f'{items_html}<p><a class="btn" href="/">{esc(page["backLabel"])}</a></p></main>\n'
        f"</body>\n</html>"
    )
