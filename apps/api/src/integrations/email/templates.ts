import {
  EMAIL_VERIFY_TOKEN_TTL_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
  type Language,
} from '@leadflow/shared';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Emails are in Hebrew or English (D-143): business emails in the business's language, account
 * emails (verify, reset, password changed) in the language of the app the person used.
 */

const HOURS = Math.round(EMAIL_VERIFY_TOKEN_TTL_MS / 3_600_000);
const MINUTES = Math.round(PASSWORD_RESET_TOKEN_TTL_MS / 60_000);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string, lang: Language): string {
  const rtl = lang === 'he';
  return `<!doctype html>
<html dir="${rtl ? 'rtl' : 'ltr'}" lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;direction:${rtl ? 'rtl' : 'ltr'};text-align:${rtl ? 'right' : 'left'};">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
${bodyHtml}
</div>
</body>
</html>`;
}

function button(link: string, label: string, lang: Language): string {
  const href = escapeHtml(link);
  const copy =
    lang === 'en'
      ? "If the button doesn't work, copy this link into your browser:"
      : 'אם הכפתור לא עובד, אפשר להעתיק את הקישור הזה לדפדפן:';
  return `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;">${escapeHtml(label)}</a></p>
<p style="margin:0 0 8px;">${copy}</p>
<p style="margin:0 0 16px;word-break:break-all;"><a href="${href}" dir="ltr" style="color:#2563eb;">${href}</a></p>`;
}

export function verifyEmailTemplate(
  params: { fullName: string; link: string },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en
    ? 'Verify your email address for LeadFlow'
    : 'אימות כתובת האימייל שלך ב-LeadFlow';
  const hello = en ? `Hello ${params.fullName},` : `שלום ${params.fullName},`;
  const intro = en
    ? 'Thanks for signing up to LeadFlow. To verify your email address, click the button:'
    : 'תודה שנרשמת ל-LeadFlow. כדי לאמת את כתובת האימייל שלך, יש ללחוץ על הכפתור:';
  const introText = en
    ? 'Thanks for signing up to LeadFlow. To verify your email address, open the link:'
    : 'תודה שנרשמת ל-LeadFlow. כדי לאמת את כתובת האימייל שלך, יש לפתוח את הקישור:';
  const valid = en ? `The link is valid for ${HOURS} hours.` : `הקישור תקף ל-${HOURS} שעות.`;
  const ignore = en
    ? "If you didn't sign up to LeadFlow, you can ignore this email."
    : 'אם לא נרשמת ל-LeadFlow, אפשר להתעלם מהודעה זו.';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(hello)}</h1>
<p style="margin:0 0 8px;">${intro}</p>
${button(params.link, en ? 'Verify email address' : 'אימות כתובת האימייל', lang)}
<p style="margin:0 0 8px;">${valid}</p>
<p style="margin:0;color:#6b7280;">${ignore}</p>`,
    lang,
  );
  const text = [hello, '', introText, params.link, '', valid, ignore].join('\n');
  return { subject, html, text };
}

export function passwordResetTemplate(
  params: { fullName: string; link: string },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en ? 'Reset your LeadFlow password' : 'איפוס הסיסמה שלך ב-LeadFlow';
  const hello = en ? `Hello ${params.fullName},` : `שלום ${params.fullName},`;
  const intro = en
    ? 'We received a request to reset your LeadFlow password. To choose a new password, click the button:'
    : 'קיבלנו בקשה לאיפוס הסיסמה שלך ב-LeadFlow. כדי לבחור סיסמה חדשה, יש ללחוץ על הכפתור:';
  const introText = en
    ? 'We received a request to reset your LeadFlow password. To choose a new password, open the link:'
    : 'קיבלנו בקשה לאיפוס הסיסמה שלך ב-LeadFlow. כדי לבחור סיסמה חדשה, יש לפתוח את הקישור:';
  const valid = en ? `The link is valid for ${MINUTES} minutes.` : `הקישור תקף ל-${MINUTES} דקות.`;
  const ignore = en
    ? "If you didn't ask to reset your password, you can ignore this email. Your password hasn't changed."
    : 'אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו. הסיסמה שלך לא שונתה.';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(hello)}</h1>
<p style="margin:0 0 8px;">${intro}</p>
${button(params.link, en ? 'Reset password' : 'איפוס הסיסמה', lang)}
<p style="margin:0 0 8px;">${valid}</p>
<p style="margin:0;color:#6b7280;">${ignore}</p>`,
    lang,
  );
  const text = [hello, '', introText, params.link, '', valid, ignore].join('\n');
  return { subject, html, text };
}

/** F07: a new website lead, sent to owners and managers. Personal data stays out of the subject. */
export function newLeadTemplate(
  params: {
    businessName: string;
    name: string;
    phone: string;
    email: string | null;
    message: string | null;
    link: string;
    /** Where the recipient can turn these emails off. */
    settingsLink: string;
  },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en
    ? `New website enquiry — ${params.businessName}`
    : `פנייה חדשה מהאתר — ${params.businessName}`;
  const rows: [string, string][] = [
    [en ? 'Name' : 'שם', params.name],
    [en ? 'Phone' : 'טלפון', params.phone],
    ...(params.email ? ([[en ? 'Email' : 'אימייל', params.email]] as [string, string][]) : []),
    ...(params.message ? ([[en ? 'Message' : 'הודעה', params.message]] as [string, string][]) : []),
  ];
  const title = en ? 'A new enquiry came in from your website' : 'התקבלה פנייה חדשה מהאתר';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${title}</h1>
<table style="border-collapse:collapse;width:100%;margin:0 0 8px;">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;color:#6b7280;width:80px;vertical-align:top;">${k}</td><td style="padding:6px 0;white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`,
      )
      .join('')}</table>
${button(params.link, en ? 'View the lead' : 'לצפייה בליד', lang)}
<p style="margin:0;color:#6b7280;">${
      en
        ? 'Get back to the customer quickly — enquiries answered fast close more often.'
        : 'כדאי לחזור ללקוח מהר — פניות שנענות מהר נסגרות יותר.'
    }</p>
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">${
      en
        ? `Don't want these notifications? <a href="${escapeHtml(params.settingsLink)}" style="color:#9ca3af;">You can turn them off in your account settings</a>.`
        : `לא רוצים לקבל את ההתראות האלה? <a href="${escapeHtml(params.settingsLink)}" style="color:#9ca3af;">אפשר לכבות אותן בהגדרות החשבון</a>.`
    }</p>`,
    lang,
  );
  const text = [
    title,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `${en ? 'View the lead' : 'לצפייה בליד'}: ${params.link}`,
    '',
    `${en ? 'Turn these notifications off' : 'לכיבוי ההתראות האלה'}: ${params.settingsLink}`,
  ].join('\n');
  return { subject, html, text };
}

/** F09: invitation to join a business's team. */
export function inviteTemplate(
  params: {
    businessName: string;
    inviterName: string | null;
    roleLabel: string;
    link: string;
    days: number;
  },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en
    ? `You're invited to join ${params.businessName}'s team on LeadFlow`
    : `הוזמנת להצטרף לצוות של ${params.businessName} ב-LeadFlow`;
  const whoText = en
    ? `${params.inviterName ?? 'Someone'} invited you to join ${params.businessName}`
    : `${params.inviterName ? `${params.inviterName} הזמין/ה אותך` : 'הוזמנת'} להצטרף ל${params.businessName}`;
  const role = en
    ? `Your role on the team: ${params.roleLabel}.`
    : `התפקיד שלך בצוות: ${params.roleLabel}.`;
  const roleHtml = en
    ? `Your role on the team: <strong>${escapeHtml(params.roleLabel)}</strong>. LeadFlow keeps the business's enquiries, customers and website in one place.`
    : `התפקיד שלך בצוות: <strong>${escapeHtml(params.roleLabel)}</strong>. ב-LeadFlow מנהלים את הפניות, הלקוחות והאתר של העסק במקום אחד.`;
  const valid = en
    ? `The invitation is valid for ${params.days} days. To join, sign in (or sign up) with this email address.`
    : `ההזמנה תקפה ל-${params.days} ימים. כדי להצטרף צריך להתחבר (או להירשם) עם כתובת האימייל הזו.`;
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(whoText)}</h1>
<p style="margin:0 0 8px;">${roleHtml}</p>
${button(params.link, en ? 'Join the team' : 'הצטרפות לצוות', lang)}
<p style="margin:0 0 8px;">${valid}</p>
<p style="margin:0;color:#6b7280;">${
      en
        ? "If you weren't expecting this invitation, you can ignore this email."
        : 'אם לא ציפית להזמנה, אפשר להתעלם מהודעה זו.'
    }</p>`,
    lang,
  );
  const text = [
    en ? `${whoText} on LeadFlow.` : `${whoText} ב-LeadFlow.`,
    role,
    '',
    `${en ? 'Join' : 'להצטרפות'}: ${params.link}`,
    '',
    valid,
  ].join('\n');
  return { subject, html, text };
}

/** F10: a task is due. */
export function taskReminderTemplate(
  params: {
    name: string;
    title: string;
    dueText: string;
    leadName: string | null;
    link: string;
  },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en ? `Reminder: ${params.title}` : `תזכורת: ${params.title}`;
  const due = en ? 'Due' : 'מועד';
  const lead = en ? 'Lead' : 'ליד';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${
      en
        ? `Hello ${escapeHtml(params.name)}, it's time for a task`
        : `שלום ${escapeHtml(params.name)}, הגיע הזמן למשימה`
    }</h1>
<p style="margin:0 0 4px;font-size:16px;"><strong>${escapeHtml(params.title)}</strong></p>
<p style="margin:0 0 4px;color:#6b7280;">${due}: ${escapeHtml(params.dueText)}</p>
${params.leadName ? `<p style="margin:0 0 4px;color:#6b7280;">${lead}: ${escapeHtml(params.leadName)}</p>` : ''}
${button(params.link, en ? 'Open in LeadFlow' : 'לפתיחה ב-LeadFlow', lang)}`,
    lang,
  );
  const text = [
    en ? `Hello ${params.name}, it's time for a task:` : `שלום ${params.name}, הגיע הזמן למשימה:`,
    params.title,
    `${due}: ${params.dueText}`,
    ...(params.leadName ? [`${lead}: ${params.leadName}`] : []),
    '',
    params.link,
  ].join('\n');
  return { subject, html, text };
}

/** Security notice after a password change (O-008). */
export function passwordChangedTemplate(
  params: { fullName: string; resetLink: string },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en ? 'Your LeadFlow password was changed' : 'הסיסמה שלך ב-LeadFlow שונתה';
  const hello = en ? `Hello ${params.fullName},` : `שלום ${params.fullName},`;
  const changed = en
    ? 'Your LeadFlow account password was just changed, and all other devices were signed out.'
    : 'הסיסמה לחשבון LeadFlow שלך שונתה הרגע, וכל שאר המכשירים נותקו.';
  const notYou = en
    ? "If this wasn't you, reset your password right away:"
    : 'אם זה לא היית את/ה, אפסו את הסיסמה מיד:';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(hello)}</h1>
<p style="margin:0 0 8px;">${changed}</p>
<p style="margin:0 0 8px;">${notYou}</p>
${button(params.resetLink, en ? 'Reset password' : 'איפוס סיסמה', lang)}`,
    lang,
  );
  const text = [hello, changed, notYou, params.resetLink].join('\n');
  return { subject, html, text };
}

/** F18: a quote sent to the customer (transactional, sent on the business's request). */
export function quoteTemplate(
  params: {
    businessName: string;
    customerName: string;
    number: number;
    total: string;
    validUntil: string | null;
    link: string;
  },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en
    ? `Quote no. ${params.number} from ${params.businessName}`
    : `הצעת מחיר מס׳ ${params.number} מ${params.businessName}`;
  const hello = en ? `Hello ${params.customerName},` : `שלום ${params.customerName},`;
  const valid = params.validUntil
    ? en
      ? `The quote is valid until ${params.validUntil}.`
      : `ההצעה בתוקף עד ${params.validUntil}.`
    : null;
  const view = en ? 'View and approve the quote' : 'לצפייה בהצעה ולאישור';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(hello)}</h1>
<p style="margin:0 0 8px;">${
      en
        ? `${escapeHtml(params.businessName)} sent you a quote for <strong>${escapeHtml(params.total)}</strong>.`
        : `${escapeHtml(params.businessName)} שלחו לך הצעת מחיר על סך <strong>${escapeHtml(params.total)}</strong>.`
    }</p>
${valid ? `<p style="margin:0 0 8px;color:#6b7280;">${escapeHtml(valid)}</p>` : ''}
${button(params.link, view, lang)}`,
    lang,
  );
  const text = [
    hello,
    en
      ? `${params.businessName} sent you a quote for ${params.total}.`
      : `${params.businessName} שלחו לך הצעת מחיר על סך ${params.total}.`,
    ...(valid ? [valid] : []),
    '',
    `${view}: ${params.link}`,
  ].join('\n');
  return { subject, html, text };
}

/** F18: the customer accepted or rejected a quote (to owners and managers). */
export function quoteDecisionTemplate(
  params: {
    businessName: string;
    customerName: string;
    number: number;
    accepted: boolean;
    total: string;
    link: string;
  },
  lang: Language = 'he',
): RenderedEmail {
  const en = lang === 'en';
  const subject = en
    ? `${params.customerName} ${params.accepted ? 'accepted' : 'declined'} quote no. ${params.number}`
    : `${params.customerName} ${params.accepted ? 'אישר/ה' : 'דחה/תה'} את הצעת המחיר מס׳ ${params.number}`;
  const amount = `${en ? 'Quote amount' : 'סכום ההצעה'}: ${params.total}`;
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(subject)}</h1>
<p style="margin:0 0 8px;">${escapeHtml(amount)}</p>
${button(params.link, en ? 'Open the quote' : 'לפתיחת ההצעה', lang)}`,
    lang,
  );
  const text = [subject, amount, '', params.link].join('\n');
  return { subject, html, text };
}
