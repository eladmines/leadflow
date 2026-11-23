import { describe, expect, it } from 'vitest';
import { registrableDomain } from './domain';

describe('registrableDomain (F33)', () => {
  it('finds the domain a business pays for', () => {
    expect(registrableDomain('https://www.shiran.co.il/about?x=1')).toBe('shiran.co.il');
    expect(registrableDomain('shiran.co.il')).toBe('shiran.co.il');
    expect(registrableDomain('http://blog.shop.example.com')).toBe('example.com');
    expect(registrableDomain('WWW.Example.ORG')).toBe('example.org');
    expect(registrableDomain('https://site.example.co.uk/')).toBe('example.co.uk');
    expect(registrableDomain('https://my-shop.shop')).toBe('my-shop.shop');
    expect(registrableDomain('https://www.walla.co.il:8080/')).toBe('walla.co.il');
  });

  it('says null when there is no domain to look up', () => {
    for (const v of [
      '',
      null,
      undefined,
      'localhost',
      'http://127.0.0.1:3000',
      'https://co.il',
      'not a url',
      'ftp://',
    ]) {
      expect(registrableDomain(v)).toBeNull();
    }
  });
});
