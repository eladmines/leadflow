import { useLayoutEffect, useRef } from 'react';

/**
 * A chat's message list opens on its newest message, and follows new ones (D-174). Scrolls only
 * the list itself — never the page (scrollIntoView would move the whole page).
 */
export function useScrollToLatest<T extends HTMLElement>(latestKey: string | undefined) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [latestKey]);
  return ref;
}
