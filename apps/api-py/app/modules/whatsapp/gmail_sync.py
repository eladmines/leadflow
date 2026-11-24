"""F29, D-188: every couple of minutes the new inbox mail of every connected Gmail becomes a
conversation. In-process like the other background jobs; does nothing until a business connects
Gmail."""

import asyncio
import logging
from typing import Any

from app.modules.whatsapp.service import WhatsAppService

log = logging.getLogger("simplecatch")


def start_gmail_sync(app: Any, interval_s: float = 120) -> "asyncio.Task[None]":
    async def loop() -> None:
        while True:
            await asyncio.sleep(interval_s)
            try:
                async with app.state.sessionmaker() as db:
                    st = app.state
                    await WhatsAppService(
                        db,
                        st.settings,
                        st.whatsapp_sender,
                        st.messenger_sender,
                        st.email,
                        st.gmail_api,
                        st.bot,
                    ).sync_gmail()
            except Exception as err:
                log.error("gmail sync run failed", extra={"errName": type(err).__name__})

    return asyncio.create_task(loop())
