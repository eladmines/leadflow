"""What a published site version stores (its `content` column), as far as other modules need it."""

from typing import Any


def section_map(content: Any) -> list[dict[str, str]]:
    """Every section of a published site in page order: its id, its page path and its name (the
    type: `services`; `services-2` for a repeat on the same page). Reports and the counting script
    use these names, so a client can never invent one (F32)."""
    if not isinstance(content, dict):
        return []
    pages: list[tuple[str, Any]] = [("/", content.get("sections"))]
    extra = content.get("pages")
    for p in extra if isinstance(extra, list) else []:
        if isinstance(p, dict) and isinstance(p.get("slug"), str):
            pages.append((f"/{p['slug']}", p.get("sections")))
    out: list[dict[str, str]] = []
    for path, sections in pages:
        seen: dict[str, int] = {}
        for sec in sections if isinstance(sections, list) else []:
            if not (
                isinstance(sec, dict) and isinstance(sec.get("id"), str) and isinstance(sec.get("type"), str)
            ):
                continue
            n = seen.get(sec["type"], 0) + 1
            seen[sec["type"]] = n
            out.append(
                {"id": sec["id"], "path": path, "name": sec["type"] if n == 1 else f"{sec['type']}-{n}"}
            )
    return out
