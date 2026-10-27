import { AUTH_TOKEN_PATTERN } from '@leadflow/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** Sets `<meta name="referrer" content="no-referrer">` while the page is mounted. */
function useNoReferrer() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const previous = meta?.content ?? DEFAULT_REFERRER_POLICY;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'referrer';
      document.head.appendChild(meta);
    }
    meta.content = 'no-referrer';
    return () => {
      // Changing the content (rather than removing the tag) is what restores the policy.
      if (meta) meta.content = previous;
    };
  }, []);
}

/**
 * Reads `?token=` once, then removes it from the address bar (history replace) so it
 * doesn't linger in history, screenshots or Referer headers. Returns the token only if
 * it has the shape of a real one; a malformed token is treated like a missing one.
 */
export function useOneTimeToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.search).get('token'));
  useNoReferrer();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('token')) return;
    params.delete('token');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [location, navigate]);

  return token && AUTH_TOKEN_PATTERN.test(token) ? token : null;
}
