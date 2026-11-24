import re
from email.message import EmailMessage as MimeMessage

import aiosmtplib
import httpx

from app.config import Settings
from app.integrations.email.types import EmailMessage, EmailSender


class MemoryEmailSender:
    """Keeps sent messages in memory so tests can read links out of them."""

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []
        self.fail_with: Exception | None = None

    async def send(self, message: EmailMessage) -> None:
        if self.fail_with:
            raise self.fail_with
        self.sent.append(message)

    def to(self, address: str) -> list[EmailMessage]:
        addr = address.strip().lower()
        return [m for m in self.sent if m.to.lower() == addr]

    def clear(self) -> None:
        self.sent.clear()
        self.fail_with = None

    async def close(self) -> None:
        return None


class DisabledEmailSender:
    """No email goes out (hosting without a mail service yet)."""

    async def send(self, message: EmailMessage) -> None:
        return None

    async def close(self) -> None:
        return None


class SmtpEmailSender:
    """SMTP: Mailpit locally (no auth), or a real mail server with a login."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings

    async def send(self, message: EmailMessage) -> None:
        mime = MimeMessage()
        mime["From"] = message.from_ or self.s.EMAIL_FROM
        mime["To"] = message.to
        mime["Subject"] = message.subject
        if message.reply_to:
            mime["Reply-To"] = message.reply_to
        if message.in_reply_to:
            mime["In-Reply-To"] = message.in_reply_to
            mime["References"] = message.in_reply_to
        mime.set_content(message.text)
        mime.add_alternative(message.html, subtype="html")
        await aiosmtplib.send(
            mime,
            hostname=self.s.SMTP_HOST,
            port=self.s.SMTP_PORT,
            username=self.s.SMTP_USER,
            password=self.s.SMTP_PASS,
            use_tls=self.s.SMTP_SECURE,
            # Upgrades with STARTTLS when the server offers it (Mailpit doesn't).
            start_tls=None,
            timeout=15,
            # Without it the library looks up this machine's own name, which can take seconds.
            local_hostname="localhost",
        )

    async def close(self) -> None:
        return None


def parse_sender(value: str) -> dict[str, str]:
    """ "SimpleCatch <me@gmail.com>" or "me@gmail.com" → name and address."""
    m = re.match(r"^\s*(.*?)\s*<([^>]+)>\s*$", value)
    if not m:
        return {"email": value.strip()}
    return {"name": m.group(1), "email": m.group(2)} if m.group(1) else {"email": m.group(2)}


class BrevoEmailSender:
    """Brevo's email API over HTTPS: works where outgoing SMTP ports are blocked."""

    def __init__(self, api_key: str, sender: str) -> None:
        self.api_key = api_key
        self.sender = sender

    async def send(self, message: EmailMessage) -> None:
        payload: dict = {
            "sender": parse_sender(message.from_ or self.sender),
            "to": [{"email": message.to}],
            "subject": message.subject,
            "htmlContent": message.html,
            "textContent": message.text,
        }
        if message.reply_to:
            payload["replyTo"] = parse_sender(message.reply_to)
        if message.in_reply_to:
            payload["headers"] = {"In-Reply-To": message.in_reply_to}
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={"api-key": self.api_key, "accept": "application/json"},
                json=payload,
            )
        if res.status_code >= 400:
            raise RuntimeError(f"email provider responded {res.status_code}")

    async def close(self) -> None:
        return None


def create_email_sender(settings: Settings) -> EmailSender:
    """Picks the adapter from EMAIL_TRANSPORT."""
    if settings.EMAIL_TRANSPORT == "memory":
        return MemoryEmailSender()
    if settings.EMAIL_TRANSPORT == "disabled":
        return DisabledEmailSender()
    if settings.EMAIL_TRANSPORT == "brevo":
        assert settings.BREVO_API_KEY, "BREVO_API_KEY is required when EMAIL_TRANSPORT is brevo"
        return BrevoEmailSender(settings.BREVO_API_KEY, settings.EMAIL_FROM)
    return SmtpEmailSender(settings)
