import { can } from '@leadflow/shared';
import { Globe } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { useSite } from './api';
import { ExistingWebsite } from './ExistingWebsite';
import { SiteStart } from './SiteStart';
import { SiteEditor } from './SiteEditor';
import { TemplatePicker } from './TemplatePicker';
import { clearBackup, readBackup, type Draft } from './useDraftAutosave';
import { tr } from '../../i18n';

/** `/b/:businessId/site`: two choices on first visit (D-130), then the editor. */
export function SitePage() {
  const business = useCurrentBusiness();
  const site = useSite(business.id);
  const [restored, setRestored] = useState<Draft | 'dismissed' | null>(null);
  // Bumped when the server replaces the draft (template change), so the editor starts over.
  const [reloads, setReloads] = useState(0);
  // The templates stay out of the way for a business that already has a website; one click opens them.
  const [showTemplates, setShowTemplates] = useState(false);

  if (site.isPending) return <Spinner label={tr('טוענים את האתר…')} />;
  if (site.isError) {
    return (
      <Alert tone="danger" title={tr('לא הצלחנו לטעון את האתר')}>
        {errorMessage(site.error)}
      </Alert>
    );
  }
  if (!site.data) {
    const canEdit = can(business.role, 'site.edit');
    // The business already has a website elsewhere (D-094): show it, and keep the option open.
    if (business.websiteUrl) {
      return (
        <>
          <PageHeader
            title={tr('האתר שלי')}
            description={tr('האתר הקיים של העסק, לצפייה בלבד. אפשר גם לבנות אתר חדש ב-LeadFlow.')}
          />
          <ExistingWebsite business={business} canEdit={canEdit} />
          {canEdit &&
            (showTemplates ? (
              <TemplatePicker secondary />
            ) : (
              <div>
                <Button variant="secondary" onClick={() => setShowTemplates(true)}>
                  {tr('בניית אתר חדש ב-LeadFlow')}
                </Button>
              </div>
            ))}
        </>
      );
    }
    if (canEdit) return <SiteStart business={business} />;
    return (
      <>
        <PageHeader title={tr('האתר שלי')} />
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center shadow-card">
          <Globe aria-hidden className="h-8 w-8 text-ink-subtle" />
          <h2 className="text-lg font-semibold text-ink">{tr('האתר עדיין לא נבנה')}</h2>
          <p className="text-sm text-ink-muted">
            {tr('בעל/ת העסק יכול/ה לבחור תבנית ולהתחיל לבנות.')}
          </p>
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
      <Alert tone="warning" title={tr('נמצאו שינויים שלא נשמרו')}>
        <div className="flex flex-col gap-3">
          <p>{tr('בפעם הקודמת השמירה נכשלה. לשחזר את השינויים מהמכשיר הזה?')}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setRestored(backup.draft)}>
              {tr('שחזור השינויים')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearBackup(business.id);
                setRestored('dismissed');
              }}
            >
              {tr('התעלמות')}
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  return (
    <SiteEditor
      key={`${site.data.id}:${reloads}`}
      site={site.data}
      initialDraft={restored && restored !== 'dismissed' ? restored : undefined}
      onReplaced={() => setReloads((n) => n + 1)}
    />
  );
}
