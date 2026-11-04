import { businessWebPaths, can, roleLabels, type Business } from '@leadflow/shared';
import { LogOut, Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Alert, Logo } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { useSignOut } from '../auth/useSignOut';
import { BusinessSwitcher } from './BusinessSwitcher';
import { shortcutLabel } from './CommandPalette';
import { navItems } from './nav';
import { NotificationBell } from '../notifications/NotificationBell';
import { tr } from '../../i18n';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';

/** Sidebar content, shared by the desktop column and the mobile drawer. */
export function Sidebar({
  business,
  onNavigate,
  onSearch,
  inDrawer = false,
}: {
  business: Business;
  onNavigate?: () => void;
  onSearch?: () => void;
  /** The mobile drawer's close button sits at the top end corner; keep the top row clear of it. */
  inDrawer?: boolean;
}) {
  const me = useMe();
  const { signOut, isPending, error } = useSignOut();
  const user = me.data?.user;
  const items = navItems.filter((i) => !i.permission || can(business.role, i.permission));

  return (
    <div className="flex min-h-full flex-col gap-4 bg-gradient-to-b from-brand-100 to-brand-50 px-3 py-4">
      <div className={cn('flex items-center justify-between gap-2 ps-2 pt-1', inDrawer && 'pe-10')}>
        <Logo />
        <div className="flex items-center gap-1">
          {/* On desktop the flags sit at the top of the page instead (BusinessLayout). */}
          {inDrawer && <LanguageSwitch />}
          <NotificationBell businessId={business.id} onNavigate={onNavigate} />
        </div>
      </div>
      <BusinessSwitcher business={business} onNavigate={onNavigate} />
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          data-tour="search"
          className="flex h-9 items-center gap-2 rounded-lg border border-surface-border bg-surface px-2.5 text-sm text-ink-muted shadow-card hover:border-accent-300 hover:text-ink"
        >
          <Search aria-hidden className="h-4 w-4" />
          <span className="flex-1 text-start">{tr('חיפוש מהיר')}</span>
          <kbd
            dir="ltr"
            className="rounded border border-surface-border bg-surface-muted px-1.5 text-[11px] text-ink-subtle"
          >
            {shortcutLabel}
          </kbd>
        </button>
      )}

      <nav aria-label={tr('ניווט ראשי')} className="flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-px">
          {items.map(({ segment, label, icon: Icon, comingSoon }) => (
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
                    'group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-surface font-semibold text-brand-800 shadow-card'
                      : comingSoon
                        ? 'text-ink-muted hover:bg-surface/60'
                        : 'text-accent-700 hover:bg-surface/70 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive
                          ? 'text-coral-500'
                          : comingSoon
                            ? 'text-ink-subtle'
                            : 'text-brand-600',
                      )}
                    />
                    <span className="flex-1">{label}</span>
                    {comingSoon && (
                      <>
                        <span
                          aria-hidden
                          className="rounded-md bg-surface/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted"
                        >
                          {tr('בקרוב')}
                        </span>
                        <span className="sr-only">{tr('(בקרוב)')}</span>
                      </>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-3 border-t border-brand-200 pt-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center gap-2.5 px-1">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-coral-500 text-[13px] font-semibold text-white"
          >
            {user?.fullName.trim().charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
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
    </div>
  );
}
