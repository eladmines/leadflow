import { EMAIL_VERIFY_TOKEN_TTL_MS, PASSWORD_RESET_TOKEN_TTL_MS } from '@leadflow/shared';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const HOURS = Math.round(EMAIL_VERIFY_TOKEN_TTL_MS / 3_600_000);
const MINUTES = Math.round(PASSWORD_RESET_TOKEN_TTL_MS / 60_000);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;direction:rtl;text-align:right;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
${bodyHtml}
</div>
</body>
</html>`;
}

function button(link: string, label: string): string {
  const href = escapeHtml(link);
  return `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;">${escapeHtml(label)}</a></p>
<p style="margin:0 0 8px;">אם הכפתור לא עובד, אפשר להעתיק את הקישור הזה לדפדפן:</p>
<p style="margin:0 0 16px;word-break:break-all;"><a href="${href}" dir="ltr" style="color:#2563eb;">${href}</a></p>`;
}

export function verifyEmailTemplate(params: { fullName: string; link: string }): RenderedEmail {
  const subject = 'אימות כתובת האימייל שלך ב-LeadFlow';
  const name = escapeHtml(params.fullName);
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">שלום ${name},</h1>
<p style="margin:0 0 8px;">תודה שנרשמת ל-LeadFlow. כדי לאמת את כתובת האימייל שלך, יש ללחוץ על הכפתור:</p>
${button(params.link, 'אימות כתובת האימייל')}
<p style="margin:0 0 8px;">הקישור תקף ל-${HOURS} שעות.</p>
<p style="margin:0;color:#6b7280;">אם לא נרשמת ל-LeadFlow, אפשר להתעלם מהודעה זו.</p>`,
  );
  const text = [
    `שלום ${params.fullName},`,
    '',
    'תודה שנרשמת ל-LeadFlow. כדי לאמת את כתובת האימייל שלך, יש לפתוח את הקישור:',
    params.link,
    '',
    `הקישור תקף ל-${HOURS} שעות.`,
    'אם לא נרשמת ל-LeadFlow, אפשר להתעלם מהודעה זו.',
  ].join('\n');
  return { subject, html, text };
}

export function passwordResetTemplate(params: { fullName: string; link: string }): RenderedEmail {
  const subject = 'איפוס הסיסמה שלך ב-LeadFlow';
  const name = escapeHtml(params.fullName);
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">שלום ${name},</h1>
<p style="margin:0 0 8px;">קיבלנו בקשה לאיפוס הסיסמה שלך ב-LeadFlow. כדי לבחור סיסמה חדשה, יש ללחוץ על הכפתור:</p>
${button(params.link, 'איפוס הסיסמה')}
<p style="margin:0 0 8px;">הקישור תקף ל-${MINUTES} דקות.</p>
<p style="margin:0;color:#6b7280;">אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו. הסיסמה שלך לא שונתה.</p>`,
  );
  const text = [
    `שלום ${params.fullName},`,
    '',
    'קיבלנו בקשה לאיפוס הסיסמה שלך ב-LeadFlow. כדי לבחור סיסמה חדשה, יש לפתוח את הקישור:',
    params.link,
    '',
    `הקישור תקף ל-${MINUTES} דקות.`,
    'אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו. הסיסמה שלך לא שונתה.',
  ].join('\n');
  return { subject, html, text };
}
