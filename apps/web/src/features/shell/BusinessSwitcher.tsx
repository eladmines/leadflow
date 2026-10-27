import { businessWebPaths, type Business } from '@leadflow/shared';
import { Plus } from 'lucide-react';
import { useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { useBusinesses } from '../businesses/api';

/** Shows the current business; with more than one, a native select switches between them. */
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
        <>
          <label htmlFor={id} className="text-xs font-medium text-ink-muted">
            העסק הנוכחי
          </label>
          <select
            id={id}
            value={business.id}
            onChange={(e) => {
              const target = list.find((b) => b.id === e.target.value);
              if (!target) return;
              onNavigate?.();
              navigate(
                target.status === 'ONBOARDING' && target.role === 'OWNER'
                  ? businessWebPaths.onboardingFor(target.id)
                  : businessWebPaths.home(target.id),
              );
            }}
            className={cn(inputClasses(false), 'cursor-pointer font-medium')}
          >
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <div className="flex flex-col">
          <span className="text-xs font-medium text-ink-muted">העסק הנוכחי</span>
          <span className="truncate font-semibold text-ink">{business.name}</span>
        </div>
      )}
      <Link
        to={businessWebPaths.onboarding}
        onClick={onNavigate}
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-brand-700 hover:underline"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
        הוספת עסק
      </Link>
    </div>
  );
}
