import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { SESSION_COOKIE_NAME, apiPaths } from '@leadflow/shared';
import type { MemoryEmailSender } from '../src/integrations/email';
import { csrfHeaders, sessionCookie } from './helpers';

export const paths = apiPaths.auth;

export const PASSWORD = 'Sup3r-secret-pass!';

export function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'דנה כהן',
    email: 'dana@example.com',
    password: PASSWORD,
    acceptTerms: true,
    ...overrides,
  };
}

type Inject = Pick<FastifyInstance, 'inject'>;

/** POST with the CSRF marker, optional JSON body and optional session token. */
export function post(app: Inject, url: string, body?: unknown, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...csrfHeaders, ...(token ? sessionCookie(token) : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

export function getMe(app: Inject, token?: string) {
  return app.inject({
    method: 'GET',
    url: paths.me,
    headers: token ? sessionCookie(token) : {},
  });
}

export function sessionCookieOf(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
}

/** The raw session token set by a response (throws if none). */
export function sessionTokenOf(res: LightMyRequestResponse): string {
  const c = sessionCookieOf(res);
  if (!c?.value) throw new Error(`no session cookie (status ${res.statusCode}): ${res.body}`);
  return c.value;
}

/** True when the response clears the session cookie (empty value, Max-Age=0). */
export function clearsSessionCookie(res: LightMyRequestResponse): boolean {
  const c = sessionCookieOf(res);
  return !!c && c.value === '' && c.maxAge === 0;
}

export async function registerUser(app: Inject, overrides: Record<string, unknown> = {}) {
  const res = await post(app, paths.register, registerBody(overrides));
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { res, token: sessionTokenOf(res), user: res.json().user as { id: string } };
}

/** Extracts the token from the last email sent to `to` (link `...?token=`). */
export function lastEmailToken(email: MemoryEmailSender, to: string): string {
  const msgs = email.to(to);
  const msg = msgs[msgs.length - 1];
  if (!msg) throw new Error(`no email sent to ${to}`);
  const m = /[?&]token=([A-Za-z0-9_-]{43})/.exec(msg.text);
  if (!m?.[1]) throw new Error('no token link in email');
  return m[1];
}
