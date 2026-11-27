import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext, useLocation, type To } from 'react-router-dom';

type Navigate = (to: To, state?: unknown, opts?: unknown) => void;

const pathnameOf = (to: To, current: string) =>
  typeof to === 'string' ? new URL(to, `http://x${current}`).pathname : (to.pathname ?? current);

/**
 * Warns before leaving a screen with unsaved changes (D-207): closing or reloading the tab asks
 * the browser's own question (`beforeunload`), and an in-app link or `navigate()` to another page is
 * held until the user decides (`blocked` → `proceed()` or `stay()`). Changes of the search string on
 * the same page (tabs) pass. The app uses `<BrowserRouter>` (no data router, so no `useBlocker`):
 * the router's navigator is wrapped while `when` is true. The browser's Back button is not held.
 */
export function useUnsavedChangesGuard(when: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const { pathname } = useLocation();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const bypass = useRef(false);
  const here = useRef(pathname);
  here.current = pathname;

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a value to show their prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  useEffect(() => {
    if (!when) return;
    const nav = navigator as unknown as { push: Navigate; replace: Navigate };
    const push = nav.push;
    const replace = nav.replace;
    const hold =
      (original: Navigate): Navigate =>
      (to, ...rest) => {
        const go = () => original.call(navigator, to, ...rest);
        if (bypass.current || pathnameOf(to, here.current) === here.current) return go();
        setPending(() => go);
      };
    nav.push = hold(push);
    nav.replace = hold(replace);
    return () => {
      nav.push = push;
      nav.replace = replace;
    };
  }, [when, navigator]);

  const proceed = useCallback(() => {
    const go = pending;
    setPending(null);
    if (go) {
      bypass.current = true;
      go();
      bypass.current = false;
    }
  }, [pending]);

  /** Runs a navigation that must not be held (e.g. after deleting the record). */
  const leave = useCallback((go: () => void) => {
    bypass.current = true;
    try {
      go();
    } finally {
      bypass.current = false;
    }
  }, []);

  return { blocked: pending !== null, proceed, stay: () => setPending(null), leave };
}
