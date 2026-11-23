import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { useCurrentBusiness } from './CurrentBusiness';
import { tr } from '../../i18n';

/**
 * A small "refresh" icon in a card's header: reloads that card's data now. Cards that draw from the
 * same request (all of Reports) reload together, since that is one request. `scope` narrows it to a
 * feature's queries; without it, everything on screen.
 */
export function CardRefresh({ title, scope }: { title: string; scope?: 'reports' }) {
  const queryClient = useQueryClient();
  const business = useCurrentBusiness();
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: scope ? ['businesses', business.id, scope] : ['businesses', business.id],
      });
    } finally {
      setLoading(false);
    }
  };
  const label = tr('רענון: {0}', title);
  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={loading}
      aria-busy={loading}
      aria-label={label}
      title={tr('רענון')}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60"
    >
      <RefreshCw
        aria-hidden
        className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')}
      />
    </button>
  );
}
