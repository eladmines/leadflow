"""Turns a stored webhook payload into messages, leads and replies (D-202).

This is the work the webhook routes used to do inside the request (moved here unchanged). It runs
inline in the API (`MESSAGE_BUS=inline`) or in the messaging worker (`rabbitmq`); either way the
business is decided from the receiving number, page or address, never from anything else.
"""

import re
from datetime import UTC, datetime
from typing import Any

from app.modules.whatsapp import schemas as s
from app.modules.whatsapp.service import InboundMessage, WhatsAppService
from app.shared.attribution import attribution_from_meta_referral

DELIVERY = ("sent", "delivered", "read", "failed")

MEDIA_LABELS = {
    "image": "תמונה",
    "video": "סרטון",
    "audio": "הודעה קולית",
    "voice": "הודעה קולית",
    "document": "מסמך",
    "sticker": "מדבקה",
    "location": "מיקום",
    "contacts": "איש קשר",
}
UNSUPPORTED = "[הודעה מסוג שעדיין לא נתמך]"


def message_text(m: dict[str, Any]) -> str:
    """Text of an incoming message; media shows as "[תמונה] caption" (files aren't downloaded)."""
    kind = str(m.get("type") or "")
    part = m.get(kind) if isinstance(m.get(kind), dict) else {}
    if kind == "text":
        return str(part.get("body") or "")
    if kind == "button":
        return str(part.get("text") or "")
    if kind == "interactive":
        reply = part.get("button_reply") or part.get("list_reply") or {}
        return str(reply.get("title") or "") if isinstance(reply, dict) else ""
    label = MEDIA_LABELS.get(kind)
    if not label:
        return UNSUPPORTED
    caption = part.get("caption") if isinstance(part.get("caption"), str) else ""
    return f"[{label}] {caption}" if caption else f"[{label}]"


def reply_id(m: dict[str, Any]) -> str | None:
    """Id of the tapped button or list row (the booking bot's choices)."""
    if m.get("type") != "interactive":
        return None
    part = m.get("interactive") if isinstance(m.get("interactive"), dict) else {}
    reply = part.get("button_reply") or part.get("list_reply")
    rid = reply.get("id") if isinstance(reply, dict) else None
    return rid[:200] if isinstance(rid, str) else None


def ad_referral(referral: Any) -> dict[str, Any] | None:
    return attribution_from_meta_referral(referral) if isinstance(referral, dict) else None


def messenger_text(m: dict[str, Any]) -> str:
    if m.get("text"):
        return str(m["text"])
    atts = m.get("attachments")
    kind = (atts[0].get("type") if atts and isinstance(atts[0], dict) else "") or ""
    label = MEDIA_LABELS.get("document" if kind == "file" else kind)
    return f"[{label}]" if label else UNSUPPORTED


def _seconds(value: Any) -> datetime:
    try:
        sec = float(value)
        if sec > 0:
            return datetime.fromtimestamp(sec, UTC)
    except (TypeError, ValueError, OverflowError):
        pass
    return datetime.now(UTC)


def _millis(value: Any) -> datetime:
    if isinstance(value, int | float) and not isinstance(value, bool) and value > 0:
        return datetime.fromtimestamp(value / 1000, UTC)
    return datetime.now(UTC)


async def process_whatsapp(svc: WhatsAppService, body: Any) -> None:
    entries = body.get("entry") if isinstance(body, dict) else None
    for entry in entries if isinstance(entries, list) else []:
        for change in (entry.get("changes") if isinstance(entry, dict) else None) or []:
            v = change.get("value") if isinstance(change, dict) else None
            if not isinstance(v, dict):
                continue
            number_id = (v.get("metadata") or {}).get("phone_number_id")
            names = {
                str(c.get("wa_id") or ""): (c.get("profile") or {}).get("name")
                for c in v.get("contacts") or []
                if isinstance(c, dict)
            }
            for m in v.get("messages") or []:
                if not isinstance(m, dict):
                    continue
                sender = re.sub(r"\D", "", str(m.get("from") or ""))
                mid = str(m.get("id") or "")
                if not sender or not mid:
                    continue
                await svc.receive(
                    InboundMessage(
                        to=number_id if isinstance(number_id, str) else None,
                        waMessageId=mid[:128],
                        from_=f"+{sender}",
                        profileName=names.get(sender),
                        body=message_text(m),
                        replyId=reply_id(m),
                        attribution=ad_referral(m.get("referral")),
                        receivedAt=_seconds(m.get("timestamp")),
                    )
                )
            for st in v.get("statuses") or []:
                if isinstance(st, dict) and isinstance(st.get("id"), str) and st.get("status") in DELIVERY:
                    await svc.update_status(st["id"], st["status"])


async def process_messenger(svc: WhatsAppService, body: Any) -> None:
    """Facebook Messenger and Instagram (F23, F28)."""
    if not isinstance(body, dict) or body.get("object") not in ("page", "instagram"):
        return
    instagram = body["object"] == "instagram"
    channel, prefix = ("instagram", "ig") if instagram else ("messenger", "fb")
    for entry in body.get("entry") or []:
        for event in (entry.get("messaging") if isinstance(entry, dict) else None) or []:
            if not isinstance(event, dict):
                continue
            m = event.get("message")
            sender = (event.get("sender") or {}).get("id")
            if not isinstance(m, dict) or not isinstance(m.get("mid"), str) or not isinstance(sender, str):
                continue
            recipient = (event.get("recipient") or {}).get("id")
            if m.get("is_echo"):
                customer = re.sub(r"[^\d]", "", recipient or "")[:40] if isinstance(recipient, str) else ""
                if not customer:
                    continue
                await svc.receive_echo(
                    channel=channel,
                    page_id=sender,
                    customer=f"{prefix}:{customer}",
                    wa_message_id=m["mid"][:128],
                    body=messenger_text(m),
                    sent_at=_millis(event.get("timestamp")),
                )
                continue
            psid = re.sub(r"[^\d]", "", sender)[:40]
            if not psid:
                continue
            await svc.receive(
                InboundMessage(
                    channel=channel,
                    to=recipient if isinstance(recipient, str) else None,
                    waMessageId=m["mid"][:128],
                    from_=f"{prefix}:{psid}",
                    body=messenger_text(m),
                    attribution=ad_referral(m.get("referral") or event.get("referral")),
                    receivedAt=_millis(event.get("timestamp")),
                )
            )


async def process_email(svc: WhatsAppService, body: Any) -> None:
    """F27: the mail was validated and normalised before it was stored."""
    await svc.receive_email(s.EmailInbound.model_validate(body))


PROCESSORS = {"whatsapp": process_whatsapp, "messenger": process_messenger, "email": process_email}


async def process(svc: WhatsAppService, provider: str, payload: Any) -> None:
    await PROCESSORS[provider](svc, payload)
