import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/env';
import { BrevoEmailSender, DisabledEmailSender, parseSender } from './http';
import { createEmailSender } from './index';

const DB = 'postgresql://u:p@localhost:5432/db';
const message = { to: 'dana@example.com', subject: 'שלום', html: '<p>קוד</p>', text: 'קוד' };

describe('email without SMTP (D-120)', () => {
  it('sends through Brevo over HTTPS with the verified sender', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"messageId":"1"}', { status: 201 });
    }) as unknown as typeof fetch;
    await new BrevoEmailSender({
      apiKey: 'key-123456789',
      from: 'LeadFlow <me@gmail.com>',
      fetch: fake,
    }).send(message);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('key-123456789');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      sender: { name: 'LeadFlow', email: 'me@gmail.com' },
      to: [{ email: 'dana@example.com' }],
      subject: 'שלום',
      htmlContent: '<p>קוד</p>',
      textContent: 'קוד',
    });
  });

  it('fails without echoing the provider response (callers log and carry on)', async () => {
    const fake = (async () =>
      new Response('{"message":"secret detail"}', { status: 401 })) as unknown as typeof fetch;
    const send = new BrevoEmailSender({
      apiKey: 'k'.repeat(12),
      from: 'me@gmail.com',
      fetch: fake,
    }).send(message);
    await expect(send).rejects.toThrow('email provider responded 401');
    await expect(send).rejects.not.toThrow(/secret/);
  });

  it('parses the sender with or without a name', () => {
    expect(parseSender('LeadFlow <me@gmail.com>')).toEqual({
      name: 'LeadFlow',
      email: 'me@gmail.com',
    });
    expect(parseSender('me@gmail.com')).toEqual({ email: 'me@gmail.com' });
  });

  it('disabled sends nothing and returns at once, also in production', async () => {
    const cfg = loadConfig({
      DATABASE_URL: DB,
      NODE_ENV: 'production',
      APP_URL: 'https://a.test',
      FORM_TOKEN_SECRET: 'x'.repeat(40),
      EMAIL_TRANSPORT: 'disabled',
    });
    const sender = createEmailSender(cfg);
    expect(sender).toBeInstanceOf(DisabledEmailSender);
    await expect(sender.send(message)).resolves.toBeUndefined();
  });

  it('brevo needs its key', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, EMAIL_TRANSPORT: 'brevo' })).toThrow(
      /BREVO_API_KEY/,
    );
    const cfg = loadConfig({
      DATABASE_URL: DB,
      EMAIL_TRANSPORT: 'brevo',
      BREVO_API_KEY: 'xkeysib-123456',
    });
    expect(createEmailSender(cfg)).toBeInstanceOf(BrevoEmailSender);
  });
});
