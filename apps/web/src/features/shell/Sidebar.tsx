import { businessWebPaths, can, roleLabels, type Business } from '@leadflow/shared';
import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Alert, Logo } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { useSignOut } from '../auth/useSignOut';
import { BusinessSwitcher } from './BusinessSwitcher';
import { navItems } from './nav';

/** Sidebar content, shared by the desktop column and the mobile drawer. */
export function Sidebar({ business, onNavigate }: { business: Business; onNavigate?: () => void }) {
  const me = useMe();
  const { signOut, isPending, error } = useSignOut();
  const user = me.data?.user;
  const items = navItems.filter((i) => !i.permission || can(business.role, i.permission));

  return (
    <div className="flex h-full flex-col gap-4 px-3 py-4">
      <div className="px-2 pt-1">
        <Logo />
      </div>
      <BusinessSwitcher business={business} onNavigate={onNavigate} />

      <nav aria-label="ניווט ראשי" className="flex-1 overflow-y-auto">
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
                className={({ isActive }) =>
                  cn(
                    'group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-surface font-medium text-ink shadow-card ring-1 ring-surface-border'
                      : comingSoon
                        ? 'text-ink-subtle hover:bg-surface-sunken hover:text-ink-muted'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden
                      className={cn('h-4 w-4 shrink-0', isActive && 'text-brand-600')}
                    />
                    <span className="flex-1">{label}</span>
                    {comingSoon && (
                      <>
                        <span
                          aria-hidden
                          className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle"
                        >
                          בקרוב
                        </span>
                        <span className="sr-only">(בקרוב)</span>
                      </>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-3 border-t border-surface-border pt-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center gap-2.5 px-1">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-800"
          >
            {user?.fullName.trim().charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <NavLink
              to={businessWebPaths.section(business.id, 'account')}
              onClick={onNavigate}
              className="block truncate text-sm font-medium text-ink hover:underline"
              aria-label={`החשבון שלי: ${user?.fullName ?? ''}`}
            >
              {user?.fullName}
            </NavLink>
            <p className="truncate text-xs text-ink-muted">{roleLabels[business.role]}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={isPending}
            aria-label="התנתקות"
            title="התנתקות"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60"
          >
            <LogOut aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  );
}
