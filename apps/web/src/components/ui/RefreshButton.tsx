import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { tr } from '../../i18n';

/**
 * "רענון": reloads a screen's data now instead of waiting for the background refresh. The icon
 * spins while loading; screen readers hear "עודכן" when it's done.
 */
export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const refresh = async () => {
    setState('loading');
    try {
      await onRefresh();
    } finally {
      setState('done');
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => void refresh()}
        disabled={state === 'loading'}
        aria-busy={state === 'loading'}
      >
        <RefreshCw
          aria-hidden
          className={cn(
            'h-4 w-4',
            state === 'loading' && 'animate-spin motion-reduce:animate-none',
          )}
        />
        {tr('רענון')}
      </Button>
      <span role="status" className="sr-only">
        {state === 'done' ? tr('עודכן') : ''}
      </span>
    </>
  );
}
