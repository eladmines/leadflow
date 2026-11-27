import { businessWebPaths, can, roleLabels, type Business } from '@simplecatch/shared';
import { ChevronDown, CreditCard, LogOut, Search, UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useUnreadConversations } from '../conversations/api';
import { Alert, Logo } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { useSignOut } from '../auth/useSignOut';
import { BusinessSwitcher } from './BusinessSwitcher';
import { shortcutLabel } from './CommandPalette';
import { navGroupLabels, navItems, type NavGroup, type NavItem } from './nav';
import { NotificationBell } from '../notifications/NotificationBell';
import { tr } from '../../i18n';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';

/** The quick-search button: in the desktop top bar and the mobile drawer. */
export function SearchButton({
  onSearch,
  className,
}: {
  onSearch: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSearch}
      data-tour="search"
      className={cn(
        'flex h-9 items-center gap-2 rounded-lg border border-surface-border bg-surface-muted px-2.5 text-sm text-ink-muted hover:border-brand-300 hover:bg-surface hover:text-ink',
        className,
      )}
    >
      <Search aria-hidden className="h-4 w-4" />
      <span className="flex-1 text-start">{tr('חיפוש מהיר')}</span>
      <kbd
        dir="ltr"
        className="rounded border border-surface-border bg-surface px-1.5 text-[11px] text-ink-subtle"
      >
        {shortcutLabel}
      </kbd>
    </button>
  );
}

/**
 * The signed-in user (D-206): a button with the avatar, name and role that opens a menu with
 * My account, Plan & billing (owners only, `business.update`) and Sign out. Menu-button pattern:
 * Enter/Space/↓ open on the first item, ↑ on the last; arrows, Home and End move; Escape closes
 * and returns focus; Tab or a click outside closes. In the top bar (desktop) or the drawer.
 */
export function UserCard({
  business,
  onNavigate,
  placement = 'down',
}: {
  business: Business;
  onNavigate?: () => void;
  /** Where the menu opens: under the button (top bar) or above it (bottom of the drawer). */
  placement?: 'down' | 'up';
}) {
  const user = useMe().data?.user;
  const { signOut, isPending, error } = useSignOut();
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Which item gets focus once the menu is shown (keyboard opening); null = none (pointer).
  const [focusOnOpen, setFocusOnOpen] = useState<'first' | 'last' | null>(null);
  const navigate = useNavigate();
  const section = (s: string) => businessWebPaths.section(business.id, s);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open || !focusOnOpen) return;
    const all = items();
    (focusOnOpen === 'first' ? all[0] : all[all.length - 1])?.focus();
    setFocusOnOpen(null);
  }, [open, focusOnOpen]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const go = (to: string) => {
    close(false);
    onNavigate?.();
    navigate(to);
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        return move(i - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(all.length - 1);
      case 'Escape':
        e.preventDefault();
        // Inside the drawer, Escape closes only this menu, not the drawer.
        e.stopPropagation();
        return close(true);
      case 'Tab':
        return close(false);
    }
  };

  const itemClasses =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-ink hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none disabled:opacity-60';

  return (
    <div ref={rootRef} className="relative flex flex-col gap-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={tr('תפריט המשתמש: {0}', user?.fullName ?? '')}
        onClick={() => {
          setOpen((o) => !o);
          // Enter / Space on the button arrive here as a click with no pointer position.
          setFocusOnOpen(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
            setFocusOnOpen(e.key === 'ArrowUp' ? 'last' : 'first');
          }
        }}
        className="flex w-full items-center gap-2.5 rounded-lg p-1 text-start hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[13px] font-semibold text-white"
        >
          {user?.fullName.trim().charAt(0)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium text-ink">{user?.fullName}</span>
          <span className="block truncate text-xs text-ink-muted">
            {tr(roleLabels[business.role])}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 text-ink-subtle transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={tr('תפריט המשתמש')}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute end-0 z-40 flex w-56 flex-col gap-px rounded-xl border border-surface-border bg-surface p-1.5 shadow-lift',
            placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => go(section('account'))}
            className={itemClasses}
          >
            <UserRound aria-hidden className="h-4 w-4 text-ink-muted" />
            {tr('החשבון שלי')}
          </button>
          {can(business.role, 'business.update') && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => go(section('billing'))}
              className={itemClasses}
            >
              <CreditCard aria-hidden className="h-4 w-4 text-ink-muted" />
              {tr('מנוי וחיוב')}
            </button>
          )}
          <div role="separator" className="my-1 h-px bg-surface-border" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={isPending}
            onClick={() => {
              close(true);
              void signOut();
            }}
            className={itemClasses}
          >
            <LogOut aria-hidden className="h-4 w-4 text-ink-muted rtl:-scale-x-100" />
            {tr('התנתקות')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Sidebar content, shared by the desktop column and the mobile drawer (D-114): the business,
 * then the menu under small topic labels; each icon in its section's colour (D-137), the current
 * page on a light blue row (D-131). Sections not built yet stay out of the menu. On desktop search, the bell,
 * the flags and the user live in the top bar; the drawer carries them itself.
 */
/** Unread conversations next to "Conversations" (F24); owners and managers only. */
function UnreadBadge({ business }: { business: Business }) {
  const count =
    useUnreadConversations(business.id, can(business.role, 'whatsapp.inbox')).data?.unreadCount ??
    0;
  if (!count) return null;
  return (
    <span className="rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-white">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> {tr('לא נקראו')}</span>
    </span>
  );
}

export function Sidebar({
  business,
  onNavigate,
  onSearch,
  inDrawer = false,
}: {
  business: Business;
  onNavigate?: () => void;
  onSearch?: () => void;
  /** The mobile drawer: adds bell, flags, search and the user, and keeps clear of the close button. */
  inDrawer?: boolean;
}) {
  const items = navItems.filter(
    (i) => !i.comingSoon && (!i.permission || can(business.role, i.permission)),
  );
  // The drawer and the desktop column can both be in the page: keep the label ids apart.
  const uid = useId();
  const sections: { group?: NavGroup; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else sections.push({ group: item.group, items: [item] });
  }

  return (
    <div className="flex min-h-full flex-col gap-4 bg-surface px-3 py-4">
      <div className={cn('flex items-center justify-between gap-2 ps-2 pt-1', inDrawer && 'pe-10')}>
        <Logo to="/" />
        {inDrawer && (
          <div className="flex items-center gap-1">
            <LanguageSwitch />
            <NotificationBell businessId={business.id} onNavigate={onNavigate} />
          </div>
        )}
      </div>
      <BusinessSwitcher business={business} onNavigate={onNavigate} />
      {inDrawer && onSearch && <SearchButton onSearch={onSearch} />}

      <nav aria-label={tr('ניווט ראשי')} className="flex-1 overflow-y-auto">
        {sections.map(({ group, items: sectionItems }) => (
          <div key={group ?? 'home'} className={cn(group && 'mt-2')}>
            {group && (
              <h2
                id={`${uid}-${group}`}
                className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle"
              >
                {navGroupLabels[group]}
              </h2>
            )}
            <ul
              aria-labelledby={group ? `${uid}-${group}` : undefined}
              className="flex flex-col gap-px"
            >
              {sectionItems.map(({ segment, label, icon: Icon, color }) => (
                <li key={segment || 'dashboard'}>
                  <NavLink
                    to={
                      segment
                        ? businessWebPaths.section(business.id, segment)
                        : businessWebPaths.home(business.id)
                    }
                    end={segment === ''}
                    onClick={onNavigate}
                    data-tour={segment || 'dashboard'}
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 items-center gap-3 rounded-lg px-2 text-sm transition-colors',
                        isActive
                          ? 'bg-brand-50 font-semibold text-brand-700'
                          : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                      )
                    }
                  >
                    <Icon aria-hidden className={cn('h-[18px] w-[18px] shrink-0', color.icon)} />
                    <span className="flex-1">{label}</span>
                    {segment === 'conversations' && <UnreadBadge business={business} />}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {inDrawer && (
        <div className="border-t border-surface-border px-1 pt-3">
          <UserCard business={business} onNavigate={onNavigate} placement="up" />
        </div>
      )}
    </div>
  );
}
