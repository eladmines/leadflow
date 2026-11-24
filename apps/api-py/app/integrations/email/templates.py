"""Email templates (apps/api/src/integrations/email/templates.ts), Hebrew or English.

Account emails (verify, reset, password changed) use the language of the app the person used.
"""

from dataclasses import dataclass
from html import escape
from typing import Literal

Language = Literal["he", "en"]

HOURS = 24  # EMAIL_VERIFY_TOKEN_TTL
MINUTES = 30  # PASSWORD_RESET_TOKEN_TTL


@dataclass
class RenderedEmail:
    subject: str
    html: str
    text: str


def _esc(value: str) -> str:
    return escape(value, quote=True).replace("&#x27;", "&#39;")


def _layout(title: str, body_html: str, lang: Language) -> str:
    rtl = lang == "he"
    direction, align = ("rtl", "right") if rtl else ("ltr", "left")
    return f"""<!doctype html>
<html dir="{direction}" lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(title)}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;direction:{direction};text-align:{align};">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
{body_html}
</div>
</body>
</html>"""


def _button(link: str, label: str, lang: Language) -> str:
    href = _esc(link)
    copy = (
        "If the button doesn't work, copy this link into your browser:"
        if lang == "en"
        else "אם הכפתור לא עובד, אפשר להעתיק את הקישור הזה לדפדפן:"
    )
    return (
        f'<p style="margin:24px 0;"><a href="{href}" style="display:inline-block;background:#2563eb;'
        f'color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;">'
        f"{_esc(label)}</a></p>\n"
        f'<p style="margin:0 0 8px;">{copy}</p>\n'
        f'<p style="margin:0 0 16px;word-break:break-all;"><a href="{href}" dir="ltr" '
        f'style="color:#2563eb;">{href}</a></p>'
    )


def _h1(text: str) -> str:
    return f'<h1 style="font-size:20px;margin:0 0 16px;">{_esc(text)}</h1>'


def verify_email_template(full_name: str, link: str, lang: Language = "he") -> RenderedEmail:
    en = lang == "en"
    subject = "Verify your email address for SimpleCatch" if en else "אימות כתובת האימייל שלך ב-SimpleCatch"
    hello = f"Hello {full_name}," if en else f"שלום {full_name},"
    intro = (
        "Thanks for signing up to SimpleCatch. To verify your email address, click the button:"
        if en
        else "תודה שנרשמת ל-SimpleCatch. כדי לאמת את כתובת האימייל שלך, יש ללחוץ על הכפתור:"
    )
    intro_text = (
        "Thanks for signing up to SimpleCatch. To verify your email address, open the link:"
        if en
        else "תודה שנרשמת ל-SimpleCatch. כדי לאמת את כתובת האימייל שלך, יש לפתוח את הקישור:"
    )
    valid = f"The link is valid for {HOURS} hours." if en else f"הקישור תקף ל-{HOURS} שעות."
    ignore = (
        "If you didn't sign up to SimpleCatch, you can ignore this email."
        if en
        else "אם לא נרשמת ל-SimpleCatch, אפשר להתעלם מהודעה זו."
    )
    label = "Verify email address" if en else "אימות כתובת האימייל"
    html = _layout(
        subject,
        f"""{_h1(hello)}
<p style="margin:0 0 8px;">{intro}</p>
{_button(link, label, lang)}
<p style="margin:0 0 8px;">{valid}</p>
<p style="margin:0;color:#6b7280;">{ignore}</p>""",
        lang,
    )
    text = "\n".join([hello, "", intro_text, link, "", valid, ignore])
    return RenderedEmail(subject, html, text)


def password_reset_template(full_name: str, link: str, lang: Language = "he") -> RenderedEmail:
    en = lang == "en"
    subject = "Reset your SimpleCatch password" if en else "איפוס הסיסמה שלך ב-SimpleCatch"
    hello = f"Hello {full_name}," if en else f"שלום {full_name},"
    intro = (
        "We received a request to reset your SimpleCatch password. "
        "To choose a new password, click the button:"
        if en
        else "קיבלנו בקשה לאיפוס הסיסמה שלך ב-SimpleCatch. כדי לבחור סיסמה חדשה, יש ללחוץ על הכפתור:"
    )
    intro_text = (
        "We received a request to reset your SimpleCatch password. To choose a new password, open the link:"
        if en
        else "קיבלנו בקשה לאיפוס הסיסמה שלך ב-SimpleCatch. כדי לבחור סיסמה חדשה, יש לפתוח את הקישור:"
    )
    valid = f"The link is valid for {MINUTES} minutes." if en else f"הקישור תקף ל-{MINUTES} דקות."
    ignore = (
        "If you didn't ask to reset your password, you can ignore this email. Your password hasn't changed."
        if en
        else "אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו. הסיסמה שלך לא שונתה."
    )
    label = "Reset password" if en else "איפוס הסיסמה"
    html = _layout(
        subject,
        f"""{_h1(hello)}
<p style="margin:0 0 8px;">{intro}</p>
{_button(link, label, lang)}
<p style="margin:0 0 8px;">{valid}</p>
<p style="margin:0;color:#6b7280;">{ignore}</p>""",
        lang,
    )
    text = "\n".join([hello, "", intro_text, link, "", valid, ignore])
    return RenderedEmail(subject, html, text)


def password_changed_template(full_name: str, reset_link: str, lang: Language = "he") -> RenderedEmail:
    """Security notice after a password change."""
    en = lang == "en"
    subject = "Your SimpleCatch password was changed" if en else "הסיסמה שלך ב-SimpleCatch שונתה"
    hello = f"Hello {full_name}," if en else f"שלום {full_name},"
    changed = (
        "Your SimpleCatch account password was just changed, and all other devices were signed out."
        if en
        else "הסיסמה לחשבון SimpleCatch שלך שונתה הרגע, וכל שאר המכשירים נותקו."
    )
    not_you = (
        "If this wasn't you, reset your password right away:"
        if en
        else "אם זה לא היית את/ה, אפסו את הסיסמה מיד:"
    )
    label = "Reset password" if en else "איפוס סיסמה"
    html = _layout(
        subject,
        f"""{_h1(hello)}
<p style="margin:0 0 8px;">{changed}</p>
<p style="margin:0 0 8px;">{not_you}</p>
{_button(reset_link, label, lang)}""",
        lang,
    )
    text = "\n".join([hello, changed, not_you, reset_link])
    return RenderedEmail(subject, html, text)


def invite_template(
    business_name: str,
    inviter_name: str | None,
    role_label: str,
    link: str,
    days: int,
    lang: Language = "he",
) -> RenderedEmail:
    """F09: a team invitation."""
    en = lang == "en"
    subject = (
        f"You're invited to join {business_name}'s team on SimpleCatch"
        if en
        else f"הוזמנת להצטרף לצוות של {business_name} ב-SimpleCatch"
    )
    if en:
        who = f"{inviter_name or 'Someone'} invited you to join {business_name}"
    else:
        invited = f"{inviter_name} הזמין/ה אותך" if inviter_name else "הוזמנת"
        who = f"{invited} להצטרף ל{business_name}"
    role = f"Your role on the team: {role_label}." if en else f"התפקיד שלך בצוות: {role_label}."
    role_html = (
        f"Your role on the team: <strong>{_esc(role_label)}</strong>. "
        "SimpleCatch keeps the business's enquiries, customers and website in one place."
        if en
        else f"התפקיד שלך בצוות: <strong>{_esc(role_label)}</strong>. "
        "ב-SimpleCatch מנהלים את הפניות, הלקוחות והאתר של העסק במקום אחד."
    )
    valid = (
        f"The invitation is valid for {days} days. To join, sign in (or sign up) with this email address."
        if en
        else f"ההזמנה תקפה ל-{days} ימים. כדי להצטרף צריך להתחבר (או להירשם) עם כתובת האימייל הזו."
    )
    ignore = (
        "If you weren't expecting this invitation, you can ignore this email."
        if en
        else "אם לא ציפית להזמנה, אפשר להתעלם מהודעה זו."
    )
    html = _layout(
        subject,
        f"""{_h1(who)}
<p style="margin:0 0 8px;">{role_html}</p>
{_button(link, "Join the team" if en else "הצטרפות לצוות", lang)}
<p style="margin:0 0 8px;">{valid}</p>
<p style="margin:0;color:#6b7280;">{ignore}</p>""",
        lang,
    )
    text = "\n".join(
        [
            f"{who} on SimpleCatch." if en else f"{who} ב-SimpleCatch.",
            role,
            "",
            f"{'Join' if en else 'להצטרפות'}: {link}",
            "",
            valid,
        ]
    )
    return RenderedEmail(subject, html, text)
