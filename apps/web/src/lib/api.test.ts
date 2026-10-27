import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('sends the CSRF marker header and includes credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/x', { method: 'POST', body: '{}' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init.headers).get('X-Requested-With')).toBe('LeadFlow');
    expect(init.credentials).toBe('include');
  });

  it('converts the shared error body into an ApiError with field errors', async () => {
    const body = { error: { code: 'VALIDATION_ERROR', message: 'שגיאה', fields: { email: 'x' } } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })),
    );
    await expect(apiFetch('/api/x')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { email: 'x' },
    });
  });

  it('maps a network failure to a Hebrew ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    const err: unknown = await apiFetch('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/[֐-׿]/);
  });
});
