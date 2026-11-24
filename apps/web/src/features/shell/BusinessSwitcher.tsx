import { businessWebPaths, type Business } from '@simplecatch/shared';
import { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { SelectMenu } from '../../components/ui';
import { useBusinesses } from '../businesses/api';
import { tr } from '../../i18n';

/** With more than one business (e.g. invited ones), a menu switches between them. */
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

  // One business needs no switcher.
  if (list.length < 2) return null;

  return (
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
  );
}
