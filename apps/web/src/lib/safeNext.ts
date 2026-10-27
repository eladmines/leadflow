import { authWebPaths } from '@leadflow/shared';

/** Guest-only pages: sending a signed-in user "back" to one of them would loop. */
const GUEST_ONLY_PATHS: readonly string[] = [
  authWebPaths.login,
  authWebPaths.register,
  authWebPaths.forgotPassword,
];

/**
 * Validates a `?next=` value (D-025). Only same-site paths are accepted, so the
 * parameter can never become an open redirect. Anything else falls back to `/app`.
 *
 * Rejected: absent/empty, not starting with `/`, protocol-relative `//host`,
 * `/\host` (browsers treat `\` like `/`), any backslash or control character
 * (browsers strip tabs/newlines, so `/\t/host` would become `//host`), and the
 * guest-only auth pages.
 */
export function sanitizeNext(
  raw: string | null | undefined,
  fallback: string = authWebPaths.appHome,
) {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;

  const pathname = raw.split(/[?#]/, 1)[0] ?? '';
  if (GUEST_ONLY_PATHS.includes(pathname.replace(/\/+$/, '') || '/')) return fallback;
  return raw;
}

/** Builds `/login?next=<path>` for a page the user tried to open while signed out. */
export function loginPathWithNext(next: string) {
  const safe = sanitizeNext(next, '');
  if (!safe) return authWebPaths.login;
  return `${authWebPaths.login}?next=${encodeURIComponent(safe)}`;
}
