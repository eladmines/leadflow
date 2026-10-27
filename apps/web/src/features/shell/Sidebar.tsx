import { businessWebPaths, can, roleLabels, type Business } from '@leadflow/shared';
import { Clock, LogOut } from 'lucide-react';
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
    <div className="flex h-full flex-col gap-6 px-4 py-6">
      <div className="px-2">
        <Logo />
      </div>
      <BusinessSwitcher business={business} onNavigate={onNavigate} />

      <nav aria-label="ניווט ראשי" className="flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-0.5">
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
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors',
                    isActive
                      ? 'bg-brand-600 font-medium text-white shadow-sm shadow-brand-900/10'
                      : comingSoon
                        ? 'text-ink-subtle hover:bg-surface-sunken hover:text-ink-muted'
                        : 'text-ink hover:bg-surface-sunken',
                  )
                }
              >
                <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" />
                <span className="flex-1">{label}</span>
                {comingSoon && (
                  <>
                    <Clock aria-hidden className="h-3.5 w-3.5 opacity-60" />
                    <span className="sr-only">(בקרוב)</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center gap-3 px-1">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700"
          >
            {user?.fullName.trim().charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{user?.fullName}</p>
            <p className="truncate text-xs text-ink-muted">{roleLabels[business.role]}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60"
          >
            <LogOut aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
            התנתקות
          </button>
        </div>
      </div>
    </div>
  );
}
