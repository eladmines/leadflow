"""F33: when the domain of the business's existing website expires (packages/shared/src/domain.ts)."""

import re
from urllib.parse import urlsplit

# Two-label public suffixes we meet (`name.co.il` is the domain, not `co.il`).
SECOND_LEVEL = frozenset(
    "co.il org.il net.il ac.il muni.il k12.il gov.il idf.il co.uk org.uk me.uk ac.uk com.au net.au "
    "org.au co.nz com.br co.za co.jp com.tr".split()
)

DOMAIN_REMINDER_DAYS = (60, 30, 7, 0)  # days before the expiry (0 = the day it expires, or after)
DOMAIN_CHECKS = ("ok", "unsupported", "failed")


def registrable_domain(value: str | None) -> str | None:
    """`https://www.shiran.co.il/about` → `shiran.co.il`; None when it isn't a normal domain name."""
    if not value:
        return None
    url = value if re.match(r"^[a-z][a-z0-9+.-]*://", value, re.I) else f"https://{value}"
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return None
    if not host:
        return None
    host = host.lower().rstrip(".")
    # No IP addresses, no single labels (localhost), nothing with unusual characters.
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", host) or re.fullmatch(r"\d+(\.\d+){3}", host):
        return None
    labels = host.split(".")
    suffix_labels = 2 if ".".join(labels[-2:]) in SECOND_LEVEL else 1
    if len(labels) <= suffix_labels:
        return None
    return ".".join(labels[-(suffix_labels + 1) :])
