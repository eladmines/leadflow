"""Local stand-in for Meta (F12 POC): sends a signed WhatsApp webhook event to the local API, as if
a customer wrote to the connected number. Needs WHATSAPP_BUSINESS_ID / _APP_SECRET in .env.

    uv run python scripts/wa_simulate.py --from 0501234567 --name "דנה" --text "היי"
    uv run python scripts/wa_simulate.py --status read --id wamid.local-…
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
from app.shared.phone import normalize_israeli_phone  # noqa: E402

WEBHOOK = "/api/v1/integrations/whatsapp/webhook"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="sender", default="0501234567")
    ap.add_argument("--name", default="לקוחה לדוגמה")
    ap.add_argument("--text", default="היי, אפשר לקבוע תור לתספורת?")
    ap.add_argument("--status")
    ap.add_argument("--id")
    ap.add_argument("--url")
    a = ap.parse_args()
    cfg = get_settings()
    if not cfg.WHATSAPP_BUSINESS_ID or not cfg.WHATSAPP_APP_SECRET:
        print("Set WHATSAPP_BUSINESS_ID and WHATSAPP_APP_SECRET in apps/api-py/.env first.")
        return 1
    phone = normalize_israeli_phone(a.sender) or "+" + "".join(c for c in a.sender if c.isdigit())
    wa_id = phone.lstrip("+")
    if a.status:
        value = {"statuses": [{"id": a.id, "status": a.status, "recipient_id": wa_id}]}
    else:
        value = {
            "contacts": [{"wa_id": wa_id, "profile": {"name": a.name}}],
            "messages": [
                {
                    "from": wa_id,
                    "id": f"wamid.sim-{int(time.time() * 1000)}",
                    "timestamp": str(int(time.time())),
                    "type": "text",
                    "text": {"body": a.text},
                }
            ],
        }
    body = json.dumps(
        {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "id": "simulator",
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "messaging_product": "whatsapp",
                                "metadata": {"phone_number_id": cfg.WHATSAPP_PHONE_NUMBER_ID or "simulator"},
                                **value,
                            },
                        }
                    ],
                }
            ],
        }
    ).encode()
    url = a.url or f"http://localhost:{os.environ.get('PORT', '4000')}{WEBHOOK}"
    res = httpx.post(
        url,
        content=body,
        headers={
            "content-type": "application/json",
            "x-hub-signature-256": sign_webhook_body(body, cfg.WHATSAPP_APP_SECRET),
        },
    )
    print(res.status_code, res.text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
