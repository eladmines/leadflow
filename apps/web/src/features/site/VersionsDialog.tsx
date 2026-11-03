import type { Site } from '@leadflow/shared';
import { useState } from 'react';
import { Alert, Button, DialogShell, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useRollback, useUnpublish, useVersions } from './api';
import { tr, intlLocale } from '../../i18n';

const dateFormat = new Intl.DateTimeFormat(intlLocale(), {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Published versions: roll back to any of them, or take the site offline. */
export function VersionsDialog({
  open,
  onOpenChange,
  site,
  businessId,
  canPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site;
  businessId: string;
  canPublish: boolean;
}) {
  const versions = useVersions(businessId, open);
  const rollback = useRollback(businessId);
  const unpublish = useUnpublish(businessId);
  const [confirmOffline, setConfirmOffline] = useState(false);
  const error = rollback.error ?? unpublish.error;

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={tr('היסטוריית פרסומים')}>
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {versions.isPending ? (
        <Spinner label={tr('טוענים גרסאות…')} />
      ) : versions.isError ? (
        <Alert tone="danger">{errorMessage(versions.error)}</Alert>
      ) : versions.data.length === 0 ? (
        <p className="text-sm text-ink-muted">{tr('האתר עדיין לא פורסם.')}</p>
      ) : (
        <ol
          aria-label={tr('גרסאות שפורסמו')}
          className="flex flex-col divide-y divide-surface-border"
        >
          {versions.data.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-ink">
                  {tr('גרסה')} {v.number}
                  {v.live && (
                    <span className="ms-2 rounded-full bg-success-50 px-2 py-0.5 text-xs text-success-600">
                      {tr('באוויר')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-muted">
                  {dateFormat.format(new Date(v.publishedAt))}
                  {v.publishedBy ? ` · ${v.publishedBy}` : ''}
                </p>
              </div>
              {canPublish && !v.live && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={rollback.isPending && rollback.variables === v.id}
                  disabled={rollback.isPending}
                  onClick={() => rollback.mutate(v.id)}
                >
                  {tr('החזרה לגרסה זו')}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {canPublish && site.published && (
        <div className="border-t border-surface-border pt-4">
          {confirmOffline ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={tr('אישור הורדה מהאוויר')}
            >
              <span className="text-sm text-ink">
                {tr('להוריד את האתר מהאוויר? הגרסאות יישמרו.')}
              </span>
              <Button
                variant="danger"
                size="sm"
                loading={unpublish.isPending}
                onClick={() =>
                  unpublish.mutate(undefined, { onSuccess: () => setConfirmOffline(false) })
                }
              >
                {tr('הורדה מהאוויר')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmOffline(false)}>
                {tr('ביטול')}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmOffline(true)}>
              {tr('הורדת האתר מהאוויר')}
            </Button>
          )}
        </div>
      )}
    </DialogShell>
  );
}
