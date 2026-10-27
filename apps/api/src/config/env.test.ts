import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

const DB = 'postgresql://u:p@localhost:5432/db';

describe('loadConfig', () => {
  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('parses comma-separated web origins', () => {
    const cfg = loadConfig({
      DATABASE_URL: DB,
      WEB_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(cfg.WEB_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(cfg.PORT).toBe(4000);
  });

  it('applies F01 defaults outside production', () => {
    const cfg = loadConfig({ DATABASE_URL: DB });
    expect(cfg.APP_URL).toBe('http://localhost:5173');
    expect(cfg.COOKIE_SECURE).toBe(false);
    expect(cfg.EMAIL_TRANSPORT).toBe('smtp');
    expect(cfg.SMTP_HOST).toBe('localhost');
    expect(cfg.SMTP_PORT).toBe(1025);
    expect(cfg.EMAIL_FROM).toBe('LeadFlow <no-reply@leadflow.local>');
    expect(cfg.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(cfg.AUTH_RATE_LIMIT_WINDOW).toBe(900_000);
  });

  it("parses COOKIE_SECURE from the explicit strings 'true' and 'false'", () => {
    expect(loadConfig({ DATABASE_URL: DB, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(loadConfig({ DATABASE_URL: DB, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ DATABASE_URL: DB, COOKIE_SECURE: '0' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ DATABASE_URL: DB, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });

  it('strips a trailing slash from APP_URL', () => {
    expect(loadConfig({ DATABASE_URL: DB, APP_URL: 'https://app.test/' }).APP_URL).toBe(
      'https://app.test',
    );
  });

  it('requires APP_URL in production and defaults COOKIE_SECURE to true there', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production' })).toThrow(/APP_URL/);
    const cfg = loadConfig({
      DATABASE_URL: DB,
      NODE_ENV: 'production',
      APP_URL: 'https://app.leadflow.test',
    });
    expect(cfg.COOKIE_SECURE).toBe(true);
  });

  it('rejects an insecure cookie or the memory email transport in production', () => {
    const base = { DATABASE_URL: DB, NODE_ENV: 'production', APP_URL: 'https://a.test' };
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'memory' })).toThrow(/EMAIL_TRANSPORT/);
  });

  it('parses rate-limit settings as numbers', () => {
    const cfg = loadConfig({
      DATABASE_URL: DB,
      AUTH_RATE_LIMIT_MAX: '3',
      AUTH_RATE_LIMIT_WINDOW: '60000',
    });
    expect(cfg.AUTH_RATE_LIMIT_MAX).toBe(3);
    expect(cfg.AUTH_RATE_LIMIT_WINDOW).toBe(60_000);
  });
});
