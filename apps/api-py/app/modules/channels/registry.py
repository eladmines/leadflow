"""F25 (D-159): which business owns a WhatsApp number or Facebook Page, and how to send for it.

Each business's own connection (database, token encrypted) comes first; the single connection in
the environment (F12/F23 POC) keeps working as a fallback. With the `local` providers the in-memory
senders stand in for Meta (development and tests).
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.secret_box import open_secret, secret_key
from app.db.models import ChannelConnection
from app.integrations.messenger import CloudMessengerSender, MessengerSender
from app.integrations.whatsapp import CloudWhatsAppSender, WhatsAppSender

CHANNELS = ("whatsapp", "messenger", "instagram", "email")


class ChannelRegistry:
    def __init__(
        self,
        db: AsyncSession,
        settings: Settings,
        env_whatsapp: WhatsAppSender,
        env_messenger: MessengerSender,
    ) -> None:
        self.db = db
        self.settings = settings
        self.env_whatsapp = env_whatsapp  # the environment's (or a test's) senders
        self.env_messenger = env_messenger
        self.key = secret_key(settings)

    async def _connection(
        self, channel: str, *, business_id: uuid.UUID | None = None, external_id: str | None = None
    ) -> ChannelConnection | None:
        cond: list[Any] = [ChannelConnection.channel == channel]
        if business_id is not None:
            cond.append(ChannelConnection.business_id == business_id)
        if external_id is not None:
            cond.append(ChannelConnection.external_id == external_id)
        return (await self.db.execute(select(ChannelConnection).where(*cond).limit(1))).scalar_one_or_none()

    async def business_for(self, channel: str, external_id: str | None) -> uuid.UUID | None:
        """The business for an incoming message, by Meta's phone number id or Page id."""
        if external_id:
            row = await self._connection(channel, external_id=external_id)
            if row:
                return row.business_id
        c = self.settings
        # Email and Instagram have no environment fallback: only what a business connected itself.
        if channel in ("email", "instagram"):
            return None
        if channel == "whatsapp":
            if not c.WHATSAPP_BUSINESS_ID:
                return None
            ok = not c.WHATSAPP_PHONE_NUMBER_ID or c.WHATSAPP_PHONE_NUMBER_ID == external_id
            return uuid.UUID(c.WHATSAPP_BUSINESS_ID) if ok else None
        if not c.MESSENGER_BUSINESS_ID:
            return None
        ok = not c.MESSENGER_PAGE_ID or c.MESSENGER_PAGE_ID == external_id
        return uuid.UUID(c.MESSENGER_BUSINESS_ID) if ok else None

    async def whatsapp(self, business_id: uuid.UUID) -> WhatsAppSender | None:
        row = await self._connection("whatsapp", business_id=business_id)
        if row:
            if self.settings.WHATSAPP_PROVIDER == "cloud":
                return CloudWhatsAppSender(
                    row.external_id,
                    open_secret(row.token_encrypted, self.key),
                    self.settings.WHATSAPP_GRAPH_VERSION,
                )
            return self.env_whatsapp
        return self.env_whatsapp if self.settings.WHATSAPP_BUSINESS_ID == str(business_id) else None

    async def messenger(self, business_id: uuid.UUID) -> MessengerSender | None:
        row = await self._connection("messenger", business_id=business_id)
        if row:
            if self.settings.MESSENGER_PROVIDER == "cloud":
                return CloudMessengerSender(
                    row.external_id,
                    open_secret(row.token_encrypted, self.key),
                    self.settings.WHATSAPP_GRAPH_VERSION,
                )
            return self.env_messenger
        return self.env_messenger if self.settings.MESSENGER_BUSINESS_ID == str(business_id) else None

    async def instagram(self, business_id: uuid.UUID) -> MessengerSender | None:
        """Sends Instagram DMs for a business (F28): the linked Page's token, `me` = that Page."""
        row = await self._connection("instagram", business_id=business_id)
        if row is None:
            return None
        if self.settings.MESSENGER_PROVIDER == "cloud":
            return CloudMessengerSender(
                "me",
                open_secret(row.token_encrypted, self.key),
                self.settings.WHATSAPP_GRAPH_VERSION,
                kind="instagram",
            )
        return self.env_messenger

    async def gmail(self, business_id: uuid.UUID) -> dict[str, Any] | None:
        """The business's connected Gmail (F29): its address, refresh token and sync cursor."""
        row = await self._connection("gmail", business_id=business_id)
        if row is None:
            return None
        return {
            "id": row.id,
            "email": row.external_id,
            "refresh_token": open_secret(row.token_encrypted, self.key),
            "sync_cursor": row.sync_cursor,
        }

    async def email_address(self, business_id: uuid.UUID) -> str | None:
        """The business's forwarding address (F27), or None."""
        row = await self._connection("email", business_id=business_id)
        return row.external_id if row else None

    async def is_connected(self, business_id: uuid.UUID, channel: str | None = None) -> bool:
        channels = [channel] if channel else list(CHANNELS)
        for ch in channels:
            if ch == "whatsapp" and self.settings.WHATSAPP_BUSINESS_ID == str(business_id):
                return True
            if ch == "messenger" and self.settings.MESSENGER_BUSINESS_ID == str(business_id):
                return True
        n = (
            await self.db.execute(
                select(func.count())
                .select_from(ChannelConnection)
                .where(ChannelConnection.business_id == business_id, ChannelConnection.channel.in_(channels))
            )
        ).scalar_one()
        return n > 0
