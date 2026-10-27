import type { SaveDraftRequest, Site } from '@leadflow/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { saveDraft } from './api';

export type Draft = Omit<SaveDraftRequest, 'revision'>;
export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

const DEBOUNCE_MS = 800;
const backupKey = (businessId: string) => `leadflow:site-draft:${businessId}`;

/** Local fallback copy when a save fails (PRD §18 step 3). Storage may be unavailable. */
export function readBackup(businessId: string): { revision: number; draft: Draft } | null {
  try {
    const raw = localStorage.getItem(backupKey(businessId));
    return raw ? (JSON.parse(raw) as { revision: number; draft: Draft }) : null;
  } catch {
    return null;
  }
}
export function clearBackup(businessId: string) {
  try {
    localStorage.removeItem(backupKey(businessId));
  } catch {
    /* ignore */
  }
}
function writeBackup(businessId: string, revision: number, draft: Draft) {
  try {
    localStorage.setItem(backupKey(businessId), JSON.stringify({ revision, draft }));
  } catch {
    /* ignore */
  }
}

/**
 * Debounced autosave with optimistic locking. Only one request is in flight; edits made during a
 * save are sent right after it. A 409 stops autosave (another editor saved first).
 */
export function useDraftAutosave(businessId: string, site: Site, draft: Draft) {
  const [state, setState] = useState<SaveState>('saved');
  const revision = useRef(site.revision);
  const latest = useRef(draft);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  /** The draft the server has (initially the loaded one). Unchanged draft → nothing to save. */
  const lastSaved = useRef(draft);
  const stopped = useRef(false);
  const scheduled = useRef(false);

  latest.current = draft;

  const save = useCallback(async () => {
    if (stopped.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    scheduled.current = false;
    inFlight.current = true;
    setState('saving');
    const sending = latest.current;
    try {
      const res = await saveDraft(businessId, { ...sending, revision: revision.current });
      lastSaved.current = sending;
      revision.current = res.site?.revision ?? revision.current + 1;
      clearBackup(businessId);
      setState(latest.current === sending && !again.current ? 'saved' : 'pending');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        stopped.current = true;
        setState('conflict');
      } else {
        writeBackup(businessId, revision.current, latest.current);
        setState('error');
      }
      again.current = false;
      return;
    } finally {
      inFlight.current = false;
    }
    if (again.current || latest.current !== sending) {
      again.current = false;
      void save();
    }
  }, [businessId]);

  useEffect(() => {
    // Robust to StrictMode's double effect run: only real changes schedule a save.
    if (draft === lastSaved.current) return;
    if (stopped.current) return;
    setState('pending');
    scheduled.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [draft, save]);

  // Flush on unmount (e.g. navigating away within the app).
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (scheduled.current && !stopped.current) void save();
    },
    [save],
  );

  // Leaving the page with an edit still waiting for its debounce: send it now with keepalive.
  // A local backup is written first in case the request doesn't make it.
  useEffect(() => {
    const onPageHide = () => {
      if (!scheduled.current || stopped.current || inFlight.current) return;
      clearTimeout(timer.current);
      scheduled.current = false;
      writeBackup(businessId, revision.current, latest.current);
      void saveDraft(
        businessId,
        { ...latest.current, revision: revision.current },
        { keepalive: true },
      )
        .then(() => clearBackup(businessId))
        .catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [businessId]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state === 'pending' || state === 'saving' || state === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state]);

  return { state, retry: () => void save(), revision: () => revision.current };
}
