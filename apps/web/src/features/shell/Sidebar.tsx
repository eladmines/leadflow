import { businessWebPaths, can, roleLabels, type Business } from '@leadflow/shared';
import { ChevronDown, LogOut, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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

/** Who is signed in, a link to their account, and sign out: the top bar (desktop) or drawer. */
export function UserCard({
  business,
  onNavigate,
}: {
  business: Business;
  onNavigate?: () => void;
}) {
  const user = useMe().data?.user;
  const { signOut, isPending, error } = useSignOut();
  return (
    <div className="flex flex-col gap-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[13px] font-semibold text-white"
        >
          {user?.fullName.trim().charAt(0)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <NavLink
            to={businessWebPaths.section(business.id, 'account')}
            onClick={onNavigate}
            className="block truncate text-sm font-medium text-ink hover:underline"
            aria-label={tr('החשבון שלי: {0}', user?.fullName ?? '')}
          >
            {user?.fullName}
          </NavLink>
          <p className="truncate text-xs text-ink-muted">{tr(roleLabels[business.role])}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={isPending}
          aria-label={tr('התנתקות')}
          title={tr('התנתקות')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60"
        >
          <LogOut aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </div>
    </div>
  );
}

const OPEN_KEY = 'leadflow.nav.open';
const readOpen = (): NavGroup[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null') as unknown;
    return Array.isArray(v) ? (v as NavGroup[]) : null;
  } catch {
    return null;
  }
};

/**
 * Which menu topics are open (D-125): the ones the person opened (remembered in this browser),
 * plus the topic of each page they arrive on.
 */
function useOpenTopics(businessId: string, expandAll: boolean) {
  const { pathname } = useLocation();
  const segment = pathname.split(`/b/${businessId}/`)[1]?.split('/')[0] ?? '';
  const current = navItems.find((i) => i.segment && i.segment === segment)?.group;
  const [open, setOpen] = useState<NavGroup[]>(() => {
    const saved = readOpen() ?? [];
    return current && !saved.includes(current) ? [...saved, current] : saved;
  });
  // Arriving on a page opens its topic (it can still be closed).
  useEffect(() => {
    if (current) setOpen((o) => (o.includes(current) ? o : [...o, current]));
  }, [current]);
  const isOpen = (g: NavGroup) => expandAll || open.includes(g);
  const toggle = (g: NavGroup) => {
    const next = open.includes(g) ? open.filter((x) => x !== g) : [...open, g];
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // Remembering is a convenience only.
    }
  };
  return { isOpen, toggle };
}

/**
 * Sidebar content, shared by the desktop column and the mobile drawer (D-114): the business,
 * then the menu in sections, each feature with its own colour tile. On desktop search, the bell,
 * the flags and the user live in the top bar; the drawer carries them itself.
 */
export function Sidebar({
  business,
  onNavigate,
  onSearch,
  inDrawer = false,
  expandAll = false,
}: {
  business: Business;
  onNavigate?: () => void;
  onSearch?: () => void;
  /** The mobile drawer: adds bell, flags, search and the user, and keeps clear of the close button. */
  inDrawer?: boolean;
  /** Every topic open (the product tour points at each item). */
  expandAll?: boolean;
}) {
  const items = navItems.filter((i) => !i.permission || can(business.role, i.permission));
  const { isOpen, toggle } = useOpenTopics(business.id, expandAll);
  const sections: { group?: NavGroup; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else sections.push({ group: item.group, items: [item] });
  }

  return (
    <div className="flex min-h-full flex-col gap-4 bg-surface px-3 py-4">
      <div className={cn('flex items-center justify-between gap-2 ps-2 pt-1', inDrawer && 'pe-10')}>
        <Logo />
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
              <button
                type="button"
                aria-expanded={isOpen(group)}
                aria-controls={`nav-${group}`}
                onClick={() => toggle(group)}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-semibold uppercase tracking-wider text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <span className="flex-1 text-start">{navGroupLabels[group]}</span>
                {!isOpen(group) && (
                  <span className="rounded-full bg-surface-sunken px-1.5 text-[10px] font-medium normal-case tracking-normal text-ink-muted">
                    {sectionItems.length}
                  </span>
                )}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'h-4 w-4 transition-transform',
                    !isOpen(group) && '-rotate-90 rtl:rotate-90',
                  )}
                />
              </button>
            )}
            <ul
              id={group ? `nav-${group}` : undefined}
              hidden={group ? !isOpen(group) : undefined}
              // `hidden` alone loses to the flex display; the class keeps a closed topic closed.
              className={cn('flex flex-col gap-px', group && !isOpen(group) && 'hidden')}
            >
              {sectionItems.map(({ segment, label, icon: Icon, comingSoon, tone }) => (
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
                        'group flex h-9 items-center gap-3 rounded-lg px-2 text-sm transition-colors',
                        isActive
                          ? 'bg-brand-50 font-semibold text-brand-700'
                          : comingSoon
                            ? 'text-ink-muted hover:bg-surface-muted'
                            : 'text-ink hover:bg-surface-muted',
                      )
                    }
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white',
                        tone,
                        comingSoon && 'opacity-50',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1">{label}</span>
                    {comingSoon && (
                      <>
                        <span
                          aria-hidden
                          className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-muted"
                        >
                          {tr('בקרוב')}
                        </span>
                        <span className="sr-only">{tr('(בקרוב)')}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {inDrawer && (
        <div className="border-t border-surface-border px-1 pt-3">
          <UserCard business={business} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
