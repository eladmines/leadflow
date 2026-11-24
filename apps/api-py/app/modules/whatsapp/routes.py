"""Meta's webhooks (WhatsApp, Messenger, Instagram), the inbound-email webhook, and the tenant
routes for threads, the inbox and classification. Port of whatsapp/routes.ts (the booking bot's
settings routes come with the bot)."""

import json
import re
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from pydantic import ValidationError
from starlette.responses import JSONResponse, PlainTextResponse, Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.errors import AppError
from app.integrations.whatsapp import verify_webhook_signature
from app.modules.whatsapp import schemas as s
from app.modules.whatsapp.service import InboundMessage, WhatsAppService, build_service
from app.shared import whatsapp as sw
from app.shared.attribution import attribution_from_meta_referral

WEBHOOK = "/api/v1/integrations/whatsapp/webhook"
MESSENGER_WEBHOOK = "/api/v1/integrations/messenger/webhook"
EMAIL_INBOUND = "/api/v1/integrations/email/inbound"
EMAIL_SIGNATURE_HEADER = "x-leadflow-signature"
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


def service_for(request: Request, db: Db) -> WhatsAppService:
    return build_service(request.app.state, db)


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


async def _signed_json(request: Request, secret: str | None, header: str) -> Any:
    """The body of a webhook whose signature checks out; None when it isn't usable JSON."""
    if not secret:
        raise AppError("NOT_FOUND")
    raw = await request.body()
    if not verify_webhook_signature(raw, request.headers.get(header), secret):
        raise AppError("UNAUTHENTICATED")
    try:
        return json.loads(raw)
    except ValueError:
        return None


webhooks = APIRouter(tags=["whatsapp"])


def _handshake(request: Request, mode: str | None, token: str | None, challenge: str | None) -> Response:
    expected = request.app.state.settings.WHATSAPP_VERIFY_TOKEN
    if not (expected and mode == "subscribe" and token == expected):
        raise AppError("FORBIDDEN")
    return PlainTextResponse(challenge or "")


@webhooks.get(WEBHOOK)
@webhooks.get(MESSENGER_WEBHOOK)
async def verify(
    request: Request,
    mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    challenge: Annotated[str | None, Query(alias="hub.challenge", max_length=200)] = None,
):
    return _handshake(request, mode, token, challenge)


@webhooks.post(WEBHOOK)
async def whatsapp_webhook(request: Request, db: Db):
    """Meta's webhook. Every POST must carry a valid signature; the number it was sent to decides
    the business (F25). Meta only needs a 200; anything else makes it retry."""
    body = await _signed_json(request, request.app.state.settings.WHATSAPP_APP_SECRET, "x-hub-signature-256")
    svc = service_for(request, db)
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
    return JSONResponse({"ok": True})


@webhooks.post(MESSENGER_WEBHOOK)
async def messenger_webhook(request: Request, db: Db):
    """Facebook Messenger's and Instagram's webhook (F23, F28): same Meta app, same signature."""
    body = await _signed_json(request, request.app.state.settings.WHATSAPP_APP_SECRET, "x-hub-signature-256")
    if not isinstance(body, dict) or body.get("object") not in ("page", "instagram"):
        return JSONResponse({"ok": True})
    instagram = body["object"] == "instagram"
    channel, prefix = ("instagram", "ig") if instagram else ("messenger", "fb")
    svc = service_for(request, db)
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
    return JSONResponse({"ok": True})


@webhooks.post(EMAIL_INBOUND)
async def email_webhook(request: Request, db: Db):
    """F27 (D-177): the inbound-email webhook, signed with EMAIL_INBOUND_SECRET over the raw body.
    Valid requests always get 200; what can't be used is dropped quietly."""
    cfg = request.app.state.settings
    if not cfg.EMAIL_INBOUND_DOMAIN:
        raise AppError("NOT_FOUND")
    body = await _signed_json(request, cfg.EMAIL_INBOUND_SECRET, EMAIL_SIGNATURE_HEADER)
    try:
        mail = s.EmailInbound.model_validate(_normalise_mail(body))
    except (ValidationError, AttributeError, TypeError):
        return JSONResponse({"ok": True})
    await service_for(request, db).receive_email(mail)
    return JSONResponse({"ok": True})


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalise_mail(body: Any) -> dict[str, Any]:
    """The inbound schema: addresses are trimmed and lower-cased, text is bounded."""
    out = dict(body)
    for key in ("to", "from"):
        value = out[key].strip().lower()
        if len(value) > 254 or not _EMAIL.match(value):
            raise TypeError("bad address")
        out[key] = value
    out["messageId"] = out["messageId"].strip()
    if (
        not 1 <= len(out["messageId"]) <= 512
        or len(out.get("subject") or "") > 500
        or len(out.get("text") or "") > 200_000
    ):
        raise TypeError("bad mail")
    for key in ("subject", "text"):
        out[key] = out.get(key) or ""
    return out


tenant = tenant_router()
INBOX = [require_permission("whatsapp.inbox")]


@tenant.get(
    "/leads/{lead_id}/whatsapp",
    response_model=s.ThreadResponse,
    dependencies=[require_permission("leads.view")],
)
async def thread(lead_id: str, ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).thread(ctx, lead_id)


@tenant.post(
    "/leads/{lead_id}/whatsapp",
    status_code=201,
    response_model=s.SendResponse,
    dependencies=[require_permission("leads.update")],
)
async def send(lead_id: str, body: s.SendRequest, ctx: Tenant, request: Request, db: Db):
    return s.SendResponse(message=await service_for(request, db).send(ctx, lead_id, body.text))


@tenant.put(
    "/leads/{lead_id}/whatsapp/bot", status_code=204, dependencies=[require_permission("leads.update")]
)
async def pause_bot(lead_id: str, body: s.PauseBotRequest, ctx: Tenant, request: Request, db: Db):
    await service_for(request, db).pause_bot(ctx, lead_id, body.paused)
    return Response(status_code=204)


@tenant.get("/whatsapp/inbox", response_model=s.InboxResponse, dependencies=INBOX)
async def inbox(ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).inbox(ctx)


@tenant.get("/whatsapp/personal", response_model=s.PersonalNumbersResponse, dependencies=INBOX)
async def personal(ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).personal_numbers(ctx)


@tenant.post("/whatsapp/numbers/{number_id}/classify", response_model=s.ClassifyResponse, dependencies=INBOX)
async def classify(number_id: str, body: s.ClassifyRequest, ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).classify(ctx, number_id, body.as_)


@tenant.delete("/whatsapp/numbers/{number_id}", status_code=204, dependencies=INBOX)
async def forget_personal(number_id: str, ctx: Tenant, request: Request, db: Db):
    await service_for(request, db).forget_personal(ctx, number_id)
    return Response(status_code=204)


# -- booking bot settings, statuses and the "meanwhile" video ---------------------------------------


@tenant.get(
    "/whatsapp/bot", response_model=sw.BotResponse, response_model_exclude_unset=True, dependencies=INBOX
)
async def get_bot(ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).bot_settings(ctx)


@tenant.put(
    "/whatsapp/bot", response_model=sw.BotResponse, response_model_exclude_unset=True, dependencies=INBOX
)
async def put_bot(body: sw.BotSettingsRequest, ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).update_bot_settings(ctx, body)


@tenant.put(
    "/whatsapp/status", response_model=sw.BotResponse, response_model_exclude_unset=True, dependencies=INBOX
)
async def put_status(body: sw.SetStatusRequest, ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).set_status(ctx, body)


async def _read_video(request: Request) -> bytes:
    """The uploaded MP4 (one file, up to WhatsApp's 16 MB)."""
    invalid = sw.M["videoInvalid"]
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise AppError("VALIDATION_ERROR", invalid)
    too_large = AppError("VALIDATION_ERROR", sw.M["videoTooLarge"], {"video": sw.M["videoTooLarge"]})
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > sw.SHOWCASE_VIDEO_MAX_BYTES + 64 * 1024:
        raise too_large
    try:
        form = await request.form(max_files=1, max_fields=5)
    except Exception as err:
        raise AppError("VALIDATION_ERROR", invalid) from err
    upload = next((v for v in form.values() if hasattr(v, "read") and hasattr(v, "filename")), None)
    if upload is None:
        raise AppError("VALIDATION_ERROR", invalid)
    data = await upload.read(sw.SHOWCASE_VIDEO_MAX_BYTES + 1)
    if len(data) > sw.SHOWCASE_VIDEO_MAX_BYTES:
        raise too_large
    return data


@tenant.put(
    "/whatsapp/showcase/video",
    response_model=sw.BotResponse,
    response_model_exclude_unset=True,
    dependencies=INBOX,
)
async def put_video(ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).set_showcase_video(ctx, await _read_video(request))


@tenant.get("/whatsapp/showcase/video", dependencies=INBOX)
async def get_video(ctx: Tenant, request: Request, db: Db):
    video = await service_for(request, db).showcase_video(ctx)
    return Response(
        video,
        media_type="video/mp4",
        headers={"cache-control": "private, no-store", "x-content-type-options": "nosniff"},
    )


@tenant.delete(
    "/whatsapp/showcase/video",
    response_model=sw.BotResponse,
    response_model_exclude_unset=True,
    dependencies=INBOX,
)
async def delete_video(ctx: Tenant, request: Request, db: Db):
    return await service_for(request, db).delete_showcase_video(ctx)
