import { describe, expect, it } from 'vitest';
import { createFormToken, verifyFormToken } from './form-token';

const SECRET = 'x'.repeat(32);

describe('form token', () => {
  it('verifies, reports fill speed, and exposes a stable nonce', () => {
    const t = createFormToken(SECRET, 'shiran', 1_000_000_000_000);
    expect(verifyFormToken(SECRET, 'shiran', t, 1_000_000_001_000)).toMatchObject({
      ok: true,
      tooFast: true,
    });
    const slow = verifyFormToken(SECRET, 'shiran', t, 1_000_000_010_000);
    expect(slow).toMatchObject({ ok: true, tooFast: false });
    expect(slow.ok && slow.nonce).toHaveLength(16);
  });

  it('rejects other subdomains, tampering, garbage and old tokens', () => {
    const now = 1_000_000_000_000;
    const t = createFormToken(SECRET, 'shiran', now);
    expect(verifyFormToken(SECRET, 'other', t, now + 5000)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(verifyFormToken('y'.repeat(32), 'shiran', t, now + 5000).ok).toBe(false);
    expect(
      verifyFormToken(SECRET, 'shiran', t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), now + 5000)
        .ok,
    ).toBe(false);
    expect(verifyFormToken(SECRET, 'shiran', '__LF_FORM_TOKEN__', now).ok).toBe(false);
    expect(verifyFormToken(SECRET, 'shiran', undefined, now).ok).toBe(false);
    expect(verifyFormToken(SECRET, 'shiran', t, now + 25 * 3600_000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
