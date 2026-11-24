from dataclasses import dataclass
from typing import Protocol


@dataclass
class EmailMessage:
    to: str
    subject: str
    html: str
    text: str
    # Sender override ("Name <address>"); default is the server's EMAIL_FROM.
    from_: str | None = None
    reply_to: str | None = None
    # Message-ID this answers, so the customer's mail program threads it.
    in_reply_to: str | None = None


class EmailSender(Protocol):
    """Outbound email. Implementations must never log message bodies (single-use tokens)."""

    async def send(self, message: EmailMessage) -> None: ...

    async def close(self) -> None: ...
