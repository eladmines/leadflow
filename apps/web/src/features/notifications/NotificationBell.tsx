import { notificationPath, notificationText, type Notification } from '@leadflow/shared';
import { Bell } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { formatDateTime, timeAgo } from '../leads/api';
import { useMarkRead, useNotifications, usePopupsEnabled } from './api';

const PANEL_WIDTH = 340;

/**
 * The bell (D-097): unread count, and a panel with the latest notifications. Clicking one marks it
 * read and opens what it's about. Shared by the sidebar and the phone's top bar.
 */
export function NotificationBell({
  businessId,
  onNavigate,
}: {
  businessId: string;
  onNavigate?: () => void;
}) {
  const list = useNotifications(businessId);
  const markRead = useMarkRead(businessId);
  const navigate = useNavigate();
  const userId = useMe().data?.user?.id;
  const [popups, setPopups] = usePopupsEnabled(userId);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = list.data?.unreadCount ?? 0;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 24);
    // Open toward the page: the panel's right edge lines up with the button (RTL sidebar).
    const left = Math.min(Math.max(r.right - width, 12), window.innerWidth - width - 12);
    setPos({ top: r.bottom + 8, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = (n: Notification) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    onNavigate?.();
    navigate(notificationPath(businessId, n));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `התראות, ${unread} חדשות` : 'התראות'}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <Bell aria-hidden className="h-5 w-5" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger-600 px-1 text-[11px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {/* In a portal: the sticky sidebar is its own stacking layer and would clip the panel. */}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="התראות"
            className="fixed z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lift"
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.min(PANEL_WIDTH, window.innerWidth - 24),
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-surface-border px-4 py-3">
              <h2 className="text-base font-semibold text-ink">התראות</h2>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markRead.mutate({})}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  סימון הכול כנקרא
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {list.isPending ? (
                <div className="p-4">
                  <Spinner size="sm" label="טוענים התראות…" />
                </div>
              ) : list.isError ? (
                <p className="p-4 text-sm text-danger-700">לא הצלחנו לטעון את ההתראות.</p>
              ) : list.data.notifications.length === 0 ? (
                <p className="p-6 text-center text-sm text-ink-muted">
                  אין התראות עדיין. כשתגיע פנייה חדשה, היא תופיע כאן.
                </p>
              ) : (
                <ul aria-label="רשימת התראות" className="divide-y divide-surface-border">
                  {list.data.notifications.map((n) => {
                    const { title, body } = notificationText(n);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => openItem(n)}
                          className={cn(
                            'flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-surface-muted',
                            !n.readAt && 'bg-brand-50/60',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                              n.readAt ? 'bg-transparent' : 'bg-brand-500',
                            )}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-sm font-medium text-ink">
                              {title}
                              {!n.readAt && <span className="sr-only"> (חדשה)</span>}
                            </span>
                            {body && (
                              <span className="truncate text-sm text-ink-muted">{body}</span>
                            )}
                            <time
                              dateTime={n.createdAt}
                              title={formatDateTime(n.createdAt)}
                              className="text-xs text-ink-subtle"
                            >
                              {timeAgo(n.createdAt)}
                            </time>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <label className="flex items-center gap-2 border-t border-surface-border px-4 py-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={popups}
                onChange={(e) => setPopups(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              הקפצת התראות על פניות והודעות חדשות
            </label>
          </div>,
          document.body,
        )}
    </>
  );
}
