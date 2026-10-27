import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

describe('loadConfig', () => {
  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('parses comma-separated web origins', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      WEB_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(cfg.WEB_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(cfg.PORT).toBe(4000);
  });
});
