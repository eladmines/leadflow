import {
  apiPaths,
  type MarkNotificationsReadRequest,
  type NotificationListResponse,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { apiFetch } from '../../lib/api';

const np = apiPaths.notifications;
export const notificationsKey = (businessId: string) =>
  ['businesses', businessId, 'notifications'] as const;

/** The bell's data (D-097). New events arrive on the server, so check every 30 seconds. */
export function useNotifications(businessId: string) {
  return useQuery({
    queryKey: notificationsKey(businessId),
    queryFn: () => apiFetch<NotificationListResponse>(np.list(businessId)),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Marks notifications read (these ids, or all), updating the bell at once. */
export function useMarkRead(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MarkNotificationsReadRequest) =>
      apiFetch<void>(np.read(businessId), { method: 'POST', body: JSON.stringify(body) }),
    onMutate: ({ ids }) => {
      const now = new Date().toISOString();
      queryClient.setQueryData<NotificationListResponse>(notificationsKey(businessId), (old) => {
        if (!old) return old;
        const notifications = old.notifications.map((n) =>
          !n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: now } : n,
        );
        return { notifications, unreadCount: notifications.filter((n) => !n.readAt).length };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsKey(businessId) }),
  });
}

// --- Pop-ups on/off: a per-viewer choice in local storage (D-097). -----------------------------

const popupsKey = (userId: string) => `leadflow.popups.off:${userId}`;
// Shared by the bell (the switch) and the pop-ups (the reader), which live in different places.
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();

function popupsOn(userId: string | undefined): boolean {
  if (!userId) return true;
  if (memory.has(userId)) return memory.get(userId)!;
  try {
    return localStorage.getItem(popupsKey(userId)) !== '1';
  } catch {
    return true;
  }
}

export function usePopupsEnabled(userId: string | undefined) {
  const enabled = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => popupsOn(userId),
  );
  const setEnabled = useCallback(
    (on: boolean) => {
      if (!userId) return;
      try {
        if (on) localStorage.removeItem(popupsKey(userId));
        else localStorage.setItem(popupsKey(userId), '1');
      } catch {
        // Storage blocked: the choice lasts for this visit only.
        memory.set(userId, on);
      }
      listeners.forEach((l) => l());
    },
    [userId],
  );
  return [enabled, setEnabled] as const;
}
