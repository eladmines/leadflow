import {
  notificationPath,
  notificationText,
  URGENT_NOTIFICATION_TYPES,
  type Notification,
} from '@leadflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';
import { useMarkRead, useNotifications, usePopupsEnabled } from './api';
import { tr } from '../../i18n';

const SHOW_MS = 8_000;
const MAX_TOASTS = 3;

/**
 * Short pop-ups (D-097) for new leads and WhatsApp messages that arrive while the app is open.
 * Only what's new since the page loaded pops up; the bell keeps everything. Never over the site
 * editor, which needs the whole screen.
 */
export function NotificationToasts({
  businessId,
  userId,
}: {
  businessId: string;
  userId: string | undefined;
}) {
  const list = useNotifications(businessId);
  const markRead = useMarkRead(businessId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [enabled] = usePopupsEnabled(userId);
  const inEditor = useMatch('/b/:businessId/site') !== null;
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Notification[]>([]);

  useEffect(() => {
    const items = list.data?.notifications;
    if (!items) return;
    // First load: everything already there counts as seen.
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !seen.current!.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => seen.current!.add(n.id));
    // Something happened: refresh the lists that show it.
    void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'leads'] });
    void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'whatsapp'] });
    const urgent = fresh.filter((n) => !n.readAt && URGENT_NOTIFICATION_TYPES.includes(n.type));
    if (urgent.length && enabled && !inEditor) {
      setToasts((t) => [...urgent, ...t].slice(0, MAX_TOASTS));
    }
  }, [list.data, enabled, inEditor, businessId, queryClient]);

  // Each pop-up leaves after a few seconds.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((t) => t.slice(0, -1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismiss = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  const open = (n: Notification) => {
    markRead.mutate({ ids: [n.id] });
    dismiss(n.id);
    navigate(notificationPath(businessId, n));
  };

  return (
    <div
      aria-live="polite"
      aria-label={tr('התראות חדשות')}
      className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((n) => {
        const text = notificationText(n);
        const title = tr(text.title);
        const body = tr(text.body);
        return (
          <div
            key={n.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-surface-border bg-surface p-4 shadow-lift"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Bell aria-hidden className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-sm font-semibold text-ink">{title}</p>
              {body && <p className="truncate text-sm text-ink-muted">{body}</p>}
              <Button size="sm" className="mt-1 self-start" onClick={() => open(n)}>
                {tr('פתיחה')}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label={tr('סגירת ההתראה')}
              className="-me-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
