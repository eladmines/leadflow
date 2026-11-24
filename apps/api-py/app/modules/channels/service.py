"""F25 (D-159): each business connects its own WhatsApp number and Facebook Page. Tokens are sealed
(AES-256-GCM) before they're stored and never leave the server. A number or Page belongs to one
business. The environment's single connection (F12/F23) still shows as "system".

Port of apps/api/src/modules/channels/service.ts.
"""

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from datetime import timedelta
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.secret_box import open_secret, seal_secret, secret_key
from app.core.timeutil import now_ms
from app.db.models import ChannelConnection, OauthPending
from app.deps import TenantContext
from app.errors import AppError
from app.integrations.gmail import GmailApi
from app.integrations.meta import MetaApi, MetaPage
from app.modules.audit import add_audit
from app.modules.channels import schemas as s

log = logging.getLogger("simplecatch")
STATE_TTL_MS = 15 * 60_000  # Facebook sign-in must come back within this time
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class ChannelService:
    def __init__(self, db: AsyncSession, settings: Settings, meta: MetaApi, gmail: GmailApi) -> None:
        self.db, self.settings, self.meta, self.gmail = db, settings, meta, gmail
        self.key = secret_key(settings)

    def _origin(self) -> str:
        parts = urlsplit(self.settings.app_url)
        return f"{parts.scheme}://{parts.netloc}"

    async def _row(self, business_id: uuid.UUID, channel: str) -> ChannelConnection | None:
        return (
            await self.db.execute(
                select(ChannelConnection).where(
                    ChannelConnection.business_id == business_id, ChannelConnection.channel == channel
                )
            )
        ).scalar_one_or_none()

    async def status(self, ctx: TenantContext) -> s.ChannelsResponse:
        rows = (
            (
                await self.db.execute(
                    select(ChannelConnection).where(ChannelConnection.business_id == ctx.business_id)
                )
            )
            .scalars()
            .all()
        )
        c = self.settings

        def one(channel: str) -> s.ChannelStatus:
            row = next((r for r in rows if r.channel == channel), None)
            if row:
                return s.ChannelStatus(
                    channel=channel, connected=True, name=row.display_name, source="business"
                )
            env = {"whatsapp": c.WHATSAPP_BUSINESS_ID, "messenger": c.MESSENGER_BUSINESS_ID}.get(channel)
            if env == str(ctx.business_id):
                return s.ChannelStatus(channel=channel, connected=True, name=None, source="environment")
            return s.ChannelStatus(channel=channel, connected=False, name=None, source=None)

        gmail_row = next((r for r in rows if r.channel == "gmail"), None)
        gmail = (
            s.ChannelStatus(channel="email", connected=True, name=gmail_row.display_name, source="business")
            if gmail_row
            else s.ChannelStatus(channel="email", connected=False, name=None, source=None)
        )
        return s.ChannelsResponse(
            whatsapp=one("whatsapp"),
            messenger=one("messenger"),
            instagram=one("instagram"),
            gmail=gmail,
            email=one("email"),
            emailInbound=bool(c.EMAIL_INBOUND_DOMAIN and c.EMAIL_INBOUND_SECRET),
            facebookLogin=bool(c.META_APP_ID),
            gmailLogin=bool(c.GOOGLE_CLIENT_ID and c.GOOGLE_CLIENT_SECRET),
        )

    async def connect_whatsapp(
        self, ctx: TenantContext, data: s.ConnectWhatsAppRequest
    ) -> s.ChannelsResponse:
        """WhatsApp with Meta's "Phone number ID" and an access token, checked against Meta first."""
        found = await self.meta.whatsapp_number(data.phoneNumberId, data.accessToken)
        local = self.settings.WHATSAPP_PROVIDER != "cloud"
        if not found and not local:
            msg = s.M["whatsappInvalid"]
            raise AppError("VALIDATION_ERROR", msg, {"accessToken": msg})
        await self._save(ctx, "whatsapp", data.phoneNumberId, found or data.phoneNumberId, data.accessToken)
        return await self.status(ctx)

    async def create_email_address(self, ctx: TenantContext) -> s.ChannelsResponse:
        """F27: the business's forwarding address, `<random>@<EMAIL_INBOUND_DOMAIN>`. Creating it
        again returns the same one. The random part is the only secret: it isn't derived from
        anything."""
        domain = self.settings.EMAIL_INBOUND_DOMAIN
        if not domain or not self.settings.EMAIL_INBOUND_SECRET:
            raise AppError("CONFLICT", s.M["emailUnavailable"])
        if await self._row(ctx.business_id, "email"):
            return await self.status(ctx)
        address = "".join(secrets.choice(_ALPHABET) for _ in range(10)) + f"@{domain}"
        await self._save(ctx, "email", address, address, "-")
        return await self.status(ctx)

    async def disconnect(self, ctx: TenantContext, channel: str) -> s.ChannelsResponse:
        row = await self._row(ctx.business_id, channel)
        if row and channel == "gmail":
            # Tell Google the grant is gone (best effort: the row goes either way).
            try:
                await self.gmail.revoke(open_secret(row.token_encrypted, self.key))
            except Exception as err:
                log.error("gmail revoke failed", extra={"errName": type(err).__name__})
        if row:
            page_still_used = (
                channel == "instagram" and await self._row(ctx.business_id, "messenger") is not None
            )
            if channel == "messenger" or (channel == "instagram" and not page_still_used):
                # Stop the Page's messages reaching us (best effort: the row goes either way).
                # Instagram shares the Page's subscription, so it stays while Facebook still uses it.
                try:
                    await self.meta.unsubscribe_page(
                        row.page_id or row.external_id, open_secret(row.token_encrypted, self.key)
                    )
                except Exception as err:
                    log.error("facebook unsubscribe failed", extra={"errName": type(err).__name__})
            await self.db.execute(delete(ChannelConnection).where(ChannelConnection.id == row.id))
            add_audit(
                self.db,
                "channel.disconnected",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="channel_connection",
                entity_id=row.id,
                metadata={"channel": channel},
            )
            await self.db.commit()
        return await self.status(ctx)

    # -- Facebook sign-in ----------------------------------------------------------------------

    def _redirect_uri(self) -> str:
        return f"{self._origin()}{s.FACEBOOK_CALLBACK}"

    def facebook_start(self, ctx: TenantContext, for_channel: str = "facebook") -> dict[str, str]:
        """Where to send the person: Facebook's sign-in, coming back with a signed state."""
        c = self.settings
        if not c.META_APP_ID:
            raise AppError("CONFLICT", s.M["facebookUnavailable"])
        extra = {"i": 1} if for_channel == "instagram" else {}
        params = {
            "client_id": c.META_APP_ID,
            "redirect_uri": self._redirect_uri(),
            "state": self._sign_state(
                {
                    "b": str(ctx.business_id),
                    "u": str(ctx.user_id),
                    "e": int(time.time() * 1000) + STATE_TTL_MS,
                    **extra,
                }
            ),
            "response_type": "code",
        }
        if c.META_LOGIN_CONFIG_ID:
            params["config_id"] = c.META_LOGIN_CONFIG_ID
        else:
            params["scope"] = "pages_show_list,pages_messaging,pages_manage_metadata" + (
                ",instagram_basic,instagram_manage_messages" if for_channel == "instagram" else ""
            )
        return {
            "url": f"https://www.facebook.com/{c.WHATSAPP_GRAPH_VERSION}/dialog/oauth?{urlencode(params)}"
        }

    async def facebook_callback(self, code: str | None, state: str | None, error: str | None) -> str:
        """Facebook sends the person back here. Their Pages (with tokens, sealed) wait 15 minutes for
        them to pick one; the answer is where to send the browser next."""
        st = self._read_state(state)
        app = self._origin()
        if not st or st["g"]:
            return f"{app}/app"

        def back(result: str) -> str:
            return f"{app}/b/{st['b']}/settings?tab=channels&{'instagram' if st['i'] else 'facebook'}={quote(result, safe='')}"

        if error or not code:
            return back("cancelled")
        try:
            user_token = await self.meta.exchange_code(code, self._redirect_uri())
            pages = await self.meta.pages(user_token)
        except Exception as err:
            log.error("facebook sign-in failed", extra={"errName": type(err).__name__})
            return back("error")
        if not pages:
            return back("no-pages")
        now = now_ms()
        pending = OauthPending(
            id=uuid.uuid4(),
            business_id=uuid.UUID(st["b"]),
            user_id=uuid.UUID(st["u"]),
            data_encrypted=seal_secret(json.dumps([p.to_json() for p in pages]), self.key),
            expires_at=now + timedelta(milliseconds=STATE_TTL_MS),
            created_at=now,
        )
        self.db.add(pending)
        await self.db.commit()
        return back(str(pending.id))

    async def _pending_pages(self, ctx: TenantContext, pending_id: str) -> list[MetaPage]:
        row = None
        try:
            pid = uuid.UUID(pending_id)
            row = (
                await self.db.execute(
                    select(OauthPending).where(
                        OauthPending.id == pid,
                        OauthPending.business_id == ctx.business_id,
                        OauthPending.user_id == ctx.user_id,
                        OauthPending.expires_at > now_ms(),
                    )
                )
            ).scalar_one_or_none()
        except ValueError:
            row = None
        if row is None:
            raise AppError("CONFLICT", s.M["facebookExpired"])
        return [MetaPage.from_json(p) for p in json.loads(open_secret(row.data_encrypted, self.key))]

    async def facebook_pages(self, ctx: TenantContext, pending_id: str) -> s.FacebookPagesResponse:
        pages = await self._pending_pages(ctx, pending_id)
        return s.FacebookPagesResponse(
            pages=[
                s.FacebookPage(
                    id=p.id, name=p.name, instagram=f"@{p.instagram['username']}" if p.instagram else None
                )
                for p in pages
            ]
        )

    async def _clear_pending(self, pending_id: str) -> None:
        await self.db.execute(
            delete(OauthPending).where(
                or_(OauthPending.id == uuid.UUID(pending_id), OauthPending.expires_at < now_ms())
            )
        )
        await self.db.commit()

    async def connect_facebook(
        self, ctx: TenantContext, data: s.ConnectFacebookRequest
    ) -> s.ChannelsResponse:
        """Connects the chosen Page: its messages are sent to us, and its token is kept sealed."""
        page = next((p for p in await self._pending_pages(ctx, data.pendingId) if p.id == data.pageId), None)
        if page is None:
            raise AppError("CONFLICT", s.M["facebookExpired"])
        await self._assert_free(ctx, "messenger", page.id)
        try:
            await self.meta.subscribe_page(page.id, page.access_token)
        except Exception as err:
            log.error("facebook subscribe failed", extra={"errName": type(err).__name__})
            raise AppError("CONFLICT", s.M["facebookFailed"]) from err
        await self._save(ctx, "messenger", page.id, page.name, page.access_token)
        await self._clear_pending(data.pendingId)
        return await self.status(ctx)

    async def connect_instagram(
        self, ctx: TenantContext, data: s.ConnectInstagramRequest
    ) -> s.ChannelsResponse:
        """F28: connects Instagram. With a picked Page (after sign-in) its linked account; with
        nothing, the account linked to the Facebook Page this business already connected. Messages
        arrive on the Page's subscription, and replies use the Page's token (kept sealed)."""
        if data.pendingId and data.pageId:
            picked = next(
                (p for p in await self._pending_pages(ctx, data.pendingId) if p.id == data.pageId), None
            )
            if picked is None:
                raise AppError("CONFLICT", s.M["facebookExpired"])
            page_id, token, instagram = picked.id, picked.access_token, picked.instagram
        else:
            row = await self._row(ctx.business_id, "messenger")
            if row is None:
                raise AppError("CONFLICT", s.M["instagramFailed"])
            token = open_secret(row.token_encrypted, self.key)
            page_id, instagram = row.external_id, await self.meta.instagram_of(row.external_id, token)
        if not instagram:
            raise AppError("CONFLICT", s.M["instagramNoAccount"])
        await self._assert_free(ctx, "instagram", instagram["id"])
        try:
            await self.meta.subscribe_page(page_id, token)
        except Exception as err:
            log.error("instagram subscribe failed", extra={"errName": type(err).__name__})
            raise AppError("CONFLICT", s.M["instagramFailed"]) from err
        await self._save(ctx, "instagram", instagram["id"], f"@{instagram['username']}", token, page_id)
        if data.pendingId:
            await self._clear_pending(data.pendingId)
        return await self.status(ctx)

    # -- Gmail sign-in (F29) ---------------------------------------------------------------------

    def _gmail_redirect_uri(self) -> str:
        return f"{self._origin()}{s.GMAIL_CALLBACK}"

    def gmail_start(self, ctx: TenantContext) -> dict[str, str]:
        """Where to send the person: Google's consent screen, coming back with a signed state."""
        c = self.settings
        if not c.GOOGLE_CLIENT_ID or not c.GOOGLE_CLIENT_SECRET:
            raise AppError("CONFLICT", s.M["gmailUnavailable"])
        state = self._sign_state(
            {
                "b": str(ctx.business_id),
                "u": str(ctx.user_id),
                "e": int(time.time() * 1000) + STATE_TTL_MS,
                "g": 1,
            }
        )
        return {"url": self.gmail.auth_url(self._gmail_redirect_uri(), state)}

    async def gmail_callback(self, code: str | None, state: str | None, error: str | None) -> str:
        """Google sends the person back here. The inbox is connected on the spot (one account,
        nothing to choose); only mail that arrives from now on is imported. The answer is where to
        send the browser."""
        st = self._read_state(state)
        app = self._origin()
        if not st or not st["g"]:
            return f"{app}/app"

        def back(result: str) -> str:
            return f"{app}/b/{st['b']}/settings?tab=channels&gmail={quote(result, safe='')}"

        if error or not code:
            return back("cancelled")
        try:
            tokens = await self.gmail.exchange_code(code, self._gmail_redirect_uri())
            taken = (
                await self.db.execute(
                    select(ChannelConnection.business_id).where(
                        ChannelConnection.channel == "gmail", ChannelConnection.external_id == tokens.email
                    )
                )
            ).scalar_one_or_none()
            if taken and str(taken) != st["b"]:
                return back("taken")
            business_id = uuid.UUID(st["b"])
            row = await self._row(business_id, "gmail")
            now = now_ms()
            values = dict(
                external_id=tokens.email,
                display_name=tokens.email,
                token_encrypted=seal_secret(tokens.refresh_token, self.key),
                connected_by_id=uuid.UUID(st["u"]),
                sync_cursor=int(time.time() * 1000),  # nothing before this moment is imported
                updated_at=now,
            )
            if row:
                for k, v in values.items():
                    setattr(row, k, v)
            else:
                row = ChannelConnection(
                    id=uuid.uuid4(), business_id=business_id, channel="gmail", created_at=now, **values
                )
                self.db.add(row)
            add_audit(
                self.db,
                "channel.connected",
                business_id=business_id,
                actor_user_id=uuid.UUID(st["u"]),
                entity_type="channel_connection",
                entity_id=row.id,
                metadata={"channel": "gmail"},
            )
            await self.db.commit()
        except Exception as err:
            # Google's HTTP status only (never its text or any token): enough to tell a wrong
            # secret (401) from a disabled API or redirect mismatch (400/403).
            await self.db.rollback()
            log.error(
                "gmail sign-in failed",
                extra={"errName": type(err).__name__, "status": getattr(err, "status", None)},
            )
            return back("error")
        return back("connected")

    # -- helpers -----------------------------------------------------------------------------------

    async def _assert_free(self, ctx: TenantContext, channel: str, external_id: str) -> None:
        taken = (
            await self.db.execute(
                select(ChannelConnection.business_id).where(
                    ChannelConnection.channel == channel, ChannelConnection.external_id == external_id
                )
            )
        ).scalar_one_or_none()
        if taken and taken != ctx.business_id:
            raise AppError("CONFLICT", s.M["alreadyTaken"])

    async def _save(
        self,
        ctx: TenantContext,
        channel: str,
        external_id: str,
        display_name: str,
        token: str,
        page_id: str | None = None,
    ) -> None:
        await self._assert_free(ctx, channel, external_id)
        now = now_ms()
        values = dict(
            external_id=external_id,
            display_name=display_name[:120],
            token_encrypted=seal_secret(token, self.key),
            page_id=page_id,
            connected_by_id=ctx.user_id,
            updated_at=now,
        )
        row = await self._row(ctx.business_id, channel)
        if row:
            for k, v in values.items():
                setattr(row, k, v)
        else:
            row = ChannelConnection(
                id=uuid.uuid4(), business_id=ctx.business_id, channel=channel, created_at=now, **values
            )
            self.db.add(row)
        add_audit(
            self.db,
            "channel.connected",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="channel_connection",
            entity_id=row.id,
            metadata={"channel": channel},
        )
        await self.db.commit()

    def _sign_state(self, payload: dict[str, Any]) -> str:
        body = _b64(json.dumps(payload, separators=(",", ":")).encode())
        return f"{body}.{_b64(hmac.new(self.key, body.encode(), hashlib.sha256).digest())}"

    def _read_state(self, state: str | None) -> dict[str, Any] | None:
        if not state:
            return None
        parts = state.split(".")
        if len(parts) != 2 or not all(parts):
            return None
        body, sig = parts
        expected = _b64(hmac.new(self.key, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig.encode(), expected.encode()):
            return None
        try:
            p = json.loads(_unb64(body).decode())
            if not (
                isinstance(p.get("b"), str)
                and isinstance(p.get("u"), str)
                and isinstance(p.get("e"), int | float)
            ):
                return None
            return (
                {"b": p["b"], "u": p["u"], "i": p.get("i") == 1, "g": p.get("g") == 1}
                if p["e"] > time.time() * 1000
                else None
            )
        except (ValueError, UnicodeDecodeError):
            return None
