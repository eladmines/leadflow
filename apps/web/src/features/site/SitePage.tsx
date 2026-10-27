import { can } from '@leadflow/shared';
import { Globe } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { useSite } from './api';
import { SiteEditor } from './SiteEditor';
import { TemplatePicker } from './TemplatePicker';
import { clearBackup, readBackup, type Draft } from './useDraftAutosave';

/** `/b/:businessId/site`: template picker on first visit, then the editor. */
export function SitePage() {
  const business = useCurrentBusiness();
  const site = useSite(business.id);
  const [restored, setRestored] = useState<Draft | 'dismissed' | null>(null);

  if (site.isPending) return <Spinner label="טוענים את האתר…" />;
  if (site.isError) {
    return (
      <Alert tone="danger" title="לא הצלחנו לטעון את האתר">
        {errorMessage(site.error)}
      </Alert>
    );
  }
  if (!site.data) {
    if (can(business.role, 'site.edit')) return <TemplatePicker />;
    return (
      <>
        <PageHeader title="האתר שלי" />
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center shadow-card">
          <Globe aria-hidden className="h-8 w-8 text-ink-subtle" />
          <h2 className="text-lg font-semibold text-ink">האתר עדיין לא נבנה</h2>
          <p className="text-sm text-ink-muted">בעל/ת העסק יכול/ה לבחור תבנית ולהתחיל לבנות.</p>
        </section>
      </>
    );
  }

  // A local copy from a failed save, made against the current server revision → offer to restore.
  const backup = restored === null ? readBackup(business.id) : null;
  // A backup made against an older revision is stale (the save went through, or someone saved since).
  if (backup && backup.revision !== site.data.revision) clearBackup(business.id);
  if (backup && backup.revision === site.data.revision && can(business.role, 'site.edit')) {
    return (
      <Alert tone="warning" title="נמצאו שינויים שלא נשמרו">
        <div className="flex flex-col gap-3">
          <p>בפעם הקודמת השמירה נכשלה. לשחזר את השינויים מהמכשיר הזה?</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setRestored(backup.draft)}>
              שחזור השינויים
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearBackup(business.id);
                setRestored('dismissed');
              }}
            >
              התעלמות
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  return (
    <SiteEditor
      key={site.data.id}
      site={site.data}
      initialDraft={restored && restored !== 'dismissed' ? restored : undefined}
    />
  );
}
