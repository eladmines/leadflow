import { businessWebPaths, can } from '@leadflow/shared';
import { ChevronLeft } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshButton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import { useBotSettings } from './api';
import { InboxView } from '../conversations/InboxView';
import { refreshInbox } from '../conversations/api';
import { tr } from '../../i18n';

/** `/b/:businessId/conversations`: the inbox (D-158, D-175). */
export function ConversationsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'whatsapp.inbox')) return <NoPermission what={tr('שיחות')} />;
  return <Inbox businessId={business.id} />;
}

/**
 * Only the inbox (D-175): every conversation, WhatsApp and Facebook (D-158). The automatic answer
 * lives in Automations, personal numbers in Settings → Channels; old `?tab=` links go there.
 */
function Inbox({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const bot = useBotSettings(businessId);
  const tab = params.get('tab');
  if (tab === 'auto')
    return <Navigate to={businessWebPaths.section(businessId, 'automations')} replace />;
  if (tab === 'personal') {
    return (
      <Navigate to={`${businessWebPaths.section(businessId, 'settings')}?tab=channels`} replace />
    );
  }
  const on = bot.data ? bot.data.settings.mode !== 'off' : null;

  return (
    <section
      aria-label={tr('שיחות')}
      className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
    >
      <PageHeader
        inPanel
        title={tr('שיחות')}
        description={tr('כל ההודעות מוואטסאפ ומפייסבוק במקום אחד.')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {on !== null && (
              <Link
                to={businessWebPaths.section(businessId, 'automations')}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1.5 text-sm text-ink ring-1 ring-surface-border hover:bg-surface-sunken"
              >
                <span
                  aria-hidden
                  className={cn('h-2 w-2 rounded-full', on ? 'bg-emerald-500' : 'bg-slate-400')}
                />
                {on ? tr('מענה אוטומטי: פועל') : tr('מענה אוטומטי: כבוי')}
                <ChevronLeft aria-hidden className="h-4 w-4 ltr:rotate-180" />
              </Link>
            )}
            <RefreshButton
              onRefresh={() =>
                Promise.all([
                  queryClient.invalidateQueries({
                    queryKey: ['businesses', businessId, 'whatsapp'],
                  }),
                  refreshInbox(queryClient, businessId),
                ])
              }
            />
          </div>
        }
      />
      <div className="p-4 sm:p-5">
        <InboxView businessId={businessId} />
      </div>
    </section>
  );
}
