"""Local stand-in for the inbound-email service (F27): posts a signed email to the local API, as if
a customer wrote to the business's forwarding address. Needs EMAIL_INBOUND_DOMAIN and
EMAIL_INBOUND_SECRET in .env, and the address created in Settings → Channels.

    uv run python scripts/mail_simulate.py --to abc123xyz9@mail.simplecatch.local \\
        --from dana@example.com --name "דנה" --subject "תור" --text "היי, אפשר תור?"
"""

import argparse
import json
import os
import sys
import time

import httpx

sys.path.insert(0, os.getcwd())

from app.config import get_settings  # noqa: E402
from app.integrations.whatsapp import sign_webhook_body  # noqa: E402

PATH = "/api/v1/integrations/email/inbound"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to")
    ap.add_argument("--from", dest="sender", default="dana@example.com")
    ap.add_argument("--name", default="דנה כהן")
    ap.add_argument("--subject", default="שאלה על תור")
    ap.add_argument("--text", default="היי, אפשר לקבוע תור ליום חמישי?")
    ap.add_argument("--url")
    a = ap.parse_args()
    cfg = get_settings()
    if not cfg.EMAIL_INBOUND_SECRET or not cfg.EMAIL_INBOUND_DOMAIN:
        print("Set EMAIL_INBOUND_DOMAIN and EMAIL_INBOUND_SECRET in apps/api-py/.env first.")
        return 1
    if not a.to:
        print("Pass --to <the business forwarding address> (shown in Settings → Channels).")
        return 1
    body = json.dumps(
        {
            "to": a.to,
            "from": a.sender,
            "fromName": a.name,
            "subject": a.subject,
            "text": a.text,
            "messageId": f"<sim-{int(time.time() * 1000)}@simulator.local>",
        }
    ).encode()
    base = a.url or f"http://localhost:{os.environ.get('PORT', '4000')}"
    res = httpx.post(
        base + PATH,
        content=body,
        headers={
            "content-type": "application/json",
            "x-leadflow-signature": sign_webhook_body(body, cfg.EMAIL_INBOUND_SECRET),
        },
    )
    print("Sent." if res.is_success else f"Failed: {res.status_code}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
