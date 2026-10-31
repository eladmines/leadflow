import { TEMPLATE_KEYS, templateInfo, type Site, type TemplateKey } from '@leadflow/shared';
import { useState } from 'react';
import { Alert, Button, Checkbox, DialogShell } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useChangeTemplate, useDeleteSite } from './api';
import { clearBackup } from './useDraftAutosave';

/**
 * D-095: switch the site to another template, or delete the LeadFlow site (for example to go back
 * to a website the business already has). Owner only; both ask for confirmation first.
 */
export function SiteOptionsDialog({
  open,
  onOpenChange,
  site,
  businessId,
  saving,
  revision,
  onReplaced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site;
  businessId: string;
  /** True while the editor still has changes on their way to the server. */
  saving: boolean;
  revision: () => number;
  /** Called after the template changed, so the editor reloads the new draft. */
  onReplaced: () => void;
}) {
  const change = useChangeTemplate(businessId);
  const remove = useDeleteSite(businessId);
  const [chosen, setChosen] = useState<TemplateKey | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const close = (o: boolean) => {
    if (!o) {
      setChosen(null);
      setConfirmDelete(false);
      setUnderstood(false);
      change.reset();
      remove.reset();
    }
    onOpenChange(o);
  };

  const applyTemplate = () => {
    if (!chosen) return;
    change.mutate(
      { templateKey: chosen, revision: revision() },
      {
        onSuccess: () => {
          clearBackup(businessId);
          close(false);
          onReplaced();
        },
      },
    );
  };

  return (
    <DialogShell open={open} onOpenChange={close} title="אפשרויות האתר">
      <section aria-labelledby="change-template" className="flex flex-col gap-3">
        <h3 id="change-template" className="text-base font-semibold text-ink">
          החלפת תבנית
        </h3>
        <p className="text-sm text-ink-muted">
          התבנית החדשה תחליף את התוכן, העיצוב והתמונות של עמוד הבית. הלוגו, העמודים הנוספים וכתובת
          האתר נשמרים. האתר באוויר לא משתנה עד שתפרסמו.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="תבניות">
          {TEMPLATE_KEYS.map((key) => {
            const current = key === site.templateKey;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={chosen === key}
                  onClick={() => setChosen(key)}
                  className={cn(
                    'flex h-full w-full flex-col items-start gap-0.5 rounded-xl border p-3 text-start transition-colors',
                    chosen === key
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20'
                      : 'border-surface-border hover:border-accent-300',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {templateInfo[key].label}
                    {current && (
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                        התבנית הנוכחית
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-ink-muted">{templateInfo[key].description}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {chosen && (
          <Alert tone="warning">
            <div className="flex flex-col gap-2">
              <p>
                {chosen === site.templateKey
                  ? 'עמוד הבית יחזור לתוכן ההתחלתי של התבנית. השינויים שעשיתם בו יימחקו.'
                  : `עמוד הבית יוחלף בתבנית "${templateInfo[chosen].label}". השינויים שעשיתם בעמוד הבית יימחקו.`}
              </p>
              {saving && <p>שומרים עדיין את השינויים האחרונים. רגע אחד ונסו שוב.</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={applyTemplate}
                  loading={change.isPending}
                  disabled={saving}
                >
                  החלפת התבנית
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
                  ביטול
                </Button>
              </div>
            </div>
          </Alert>
        )}
        {change.isError && <Alert tone="danger">{errorMessage(change.error)}</Alert>}
      </section>

      <section
        aria-labelledby="delete-site"
        className="flex flex-col gap-3 border-t border-surface-border pt-5"
      >
        <h3 id="delete-site" className="text-base font-semibold text-ink">
          מחיקת האתר מ-LeadFlow
        </h3>
        <p className="text-sm text-ink-muted">
          למשל כדי לחזור לאתר שכבר יש לעסק. האתר יורד מהאוויר מיד, הכתובת מתפנה, והטיוטה והגרסאות
          נמחקות. הלידים שכבר הגיעו נשארים במערכת, והתמונות נשארות בספריית התמונות.
        </p>
        {!confirmDelete ? (
          <Button variant="secondary" className="self-start" onClick={() => setConfirmDelete(true)}>
            מחיקת האתר…
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-danger-600/30 bg-danger-50 p-4">
            <Checkbox
              label="הבנתי שאי אפשר לשחזר את האתר אחרי המחיקה"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            {saving && (
              <p className="text-sm text-danger-700">שומרים עדיין שינויים. רגע אחד ונסו שוב.</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                // A save still on its way would recreate a local backup of the deleted site.
                disabled={!understood || saving}
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      clearBackup(businessId);
                      close(false);
                    },
                  })
                }
              >
                מחיקה סופית
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                ביטול
              </Button>
            </div>
          </div>
        )}
        {remove.isError && <Alert tone="danger">{errorMessage(remove.error)}</Alert>}
      </section>
    </DialogShell>
  );
}
