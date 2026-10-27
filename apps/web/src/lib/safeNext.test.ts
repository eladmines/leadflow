import { describe, expect, it } from 'vitest';
import { loginPathWithNext, sanitizeNext } from './safeNext';

describe('sanitizeNext', () => {
  it.each([
    ['/app', '/app'],
    ['/app/leads?status=new#top', '/app/leads?status=new#top'],
    ['/verify-email', '/verify-email'],
  ])('accepts the same-site path %s', (raw, expected) => {
    expect(sanitizeNext(raw)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'app',
    'https://evil.example/phish',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/app\\..\\x',
    'javascript:alert(1)',
    ' /app',
    '/login',
    '/login?next=/app',
    '/register/',
    '/forgot-password',
  ])('rejects %j and falls back to /app', (raw) => {
    expect(sanitizeNext(raw)).toBe('/app');
  });
});

describe('loginPathWithNext', () => {
  it('encodes the target path', () => {
    expect(loginPathWithNext('/app/leads?x=1')).toBe('/login?next=%2Fapp%2Fleads%3Fx%3D1');
  });

  it('omits next when the target is not a safe path', () => {
    expect(loginPathWithNext('//evil.example')).toBe('/login');
  });
});
