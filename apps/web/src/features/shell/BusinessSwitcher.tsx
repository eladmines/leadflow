import { businessWebPaths, type Business } from '@simplecatch/shared';
import { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { SelectMenu } from '../../components/ui';
import { useBusinesses } from '../businesses/api';
import { tr } from '../../i18n';

/** Shows the current business; with more than one, a menu switches between them. */
export function BusinessSwitcher({
  business,
  onNavigate,
}: {
  business: Business;
  onNavigate?: () => void;
}) {
  const businesses = useBusinesses();
  const navigate = useNavigate();
  const id = useId();
  const list = businesses.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {list.length > 1 ? (
        <SelectMenu
          id={id}
          label={tr('העסק הנוכחי')}
          labelClassName="text-xs text-ink-muted"
          value={business.id}
          onChange={(v) => {
            const target = list.find((b) => b.id === v);
            if (!target) return;
            onNavigate?.();
            navigate(
              target.status === 'ONBOARDING' && target.role === 'OWNER'
                ? businessWebPaths.onboardingFor(target.id)
                : businessWebPaths.home(target.id),
            );
          }}
          options={list.map((b) => ({ value: b.id, label: b.name }))}
        />
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-surface-border bg-surface-muted p-2">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-sm font-semibold text-white"
          >
            {business.name.trim().charAt(0)}
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-ink">{business.name}</span>
            <span className="text-xs text-ink-muted">{tr('העסק הנוכחי')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
