import { describe, expect, it } from 'vitest';
import { passwordResetTemplate, verifyEmailTemplate } from './templates';

const link = 'http://localhost:5173/verify-email?token=abc';

describe('email templates', () => {
  it('verify email: Hebrew RTL html + text with the link and 24 h validity', () => {
    const t = verifyEmailTemplate({ fullName: 'דנה כהן', link });
    expect(t.subject).toBe('אימות כתובת האימייל שלך ב-LeadFlow');
    expect(t.html).toContain('<html dir="rtl" lang="he">');
    expect(t.html).toContain(`dir="ltr"`);
    expect(t.html).toContain('דנה כהן');
    expect(t.html).toContain('24 שעות');
    expect(t.text).toContain(link);
    expect(t.text).toContain('24 שעות');
  });

  it('password reset: link, 30 minutes, "password unchanged" note', () => {
    const resetLink = 'http://localhost:5173/reset-password?token=abc';
    const t = passwordResetTemplate({ fullName: 'דנה', link: resetLink });
    expect(t.subject).toBe('איפוס הסיסמה שלך ב-LeadFlow');
    expect(t.html).toContain('<html dir="rtl" lang="he">');
    expect(t.html).toContain('30 דקות');
    expect(t.text).toContain(resetLink);
    expect(t.text).toContain('הסיסמה שלך לא שונתה');
  });

  it('escapes the full name in html', () => {
    const t = verifyEmailTemplate({ fullName: '<script>alert(1)</script>', link });
    expect(t.html).not.toContain('<script>');
    expect(t.html).toContain('&lt;script&gt;');
  });
});
