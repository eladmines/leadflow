import { describe, expect, it } from 'vitest';
import { redactUrl } from './logger';

describe('logged addresses', () => {
  it("hide the webhook's verify token and other tokens, and keep the rest", () => {
    expect(
      redactUrl(
        '/api/v1/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=abc123&hub.challenge=9',
      ),
    ).toBe(
      '/api/v1/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=[REDACTED]&hub.challenge=9',
    );
    expect(redactUrl('/invite?token=secret')).toBe('/invite?token=[REDACTED]');
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });
});
