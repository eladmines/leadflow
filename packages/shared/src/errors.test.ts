import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema, defaultErrorMessages, errorCodeSchema } from './errors';

describe('error contract', () => {
  it('has a Hebrew default message for every error code', () => {
    for (const code of errorCodeSchema.options) {
      expect(defaultErrorMessages[code]).toMatch(/[֐-׿]/);
    }
  });

  it('accepts a well-formed error body and rejects unknown codes', () => {
    expect(
      apiErrorBodySchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success,
    ).toBe(true);
    expect(apiErrorBodySchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(
      false,
    );
  });
});
