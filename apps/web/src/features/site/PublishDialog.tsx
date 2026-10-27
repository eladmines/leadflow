import { zodResolver } from '@hookform/resolvers/zod';
import { setSubdomainRequestSchema, type SetSubdomainRequest, type Site } from '@leadflow/shared';
import { ExternalLink, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, DialogShell } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { applyServerErrors, errorMessage } from '../auth/serverErrors';
import { usePublish, useSetSubdomain } from './api';
import type { SaveState } from './useDraftAutosave';

/** Address field with the platform domain as a fixed suffix (always LTR). */
function SubdomainForm({
  site,
  businessId,
  onDone,
}: {
  site: Site;
  businessId: string;
  onDone: () => void;
}) {
  const setSubdomain = useSetSubdomain(businessId);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SetSubdomainRequest>({
    resolver: zodResolver(setSubdomainRequestSchema),
    mode: 'onTouched',
    defaultValues: { subdomain: site.subdomain ?? '' },
  });
  const error = form.formState.errors.subdomain?.message;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await setSubdomain.mutateAsync(values);
      onDone();
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['subdomain']));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="subdomain" className="text-sm font-medium text-ink">
          כתובת האתר
        </label>
        <div dir="ltr" className="flex items-stretch">
          <input
            id="subdomain"
            autoComplete="off"
            spellCheck={false}
            placeholder="my-business"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'subdomain-error' : 'subdomain-hint'}
            className={cn(inputClasses(!!error), 'rounded-e-none text-start')}
            {...form.register('subdomain')}
          />
          <span className="flex items-center whitespace-nowrap rounded-e-xl border border-s-0 border-surface-border bg-surface-muted px-3 text-sm text-ink-muted">
            .{site.publicDomain}
          </span>
        </div>
        {error ? (
          <p id="subdomain-error" className="text-xs text-danger-600">
            {error}
          </p>
        ) : (
          <p id="subdomain-hint" className="text-xs text-ink-muted">
            אותיות באנגלית, ספרות ומקף. אפשר לשנות בהמשך. דומיין פרטי יתווסף בהמשך.
          </p>
        )}
      </div>
      <Button type="submit" loading={setSubdomain.isPending}>
        שמירת הכתובת והמשך
      </Button>
    </form>
  );
}

/**
 * Publish flow: choose an address (first time) → publish the saved draft → link to the live site.
 * Publishing is disabled until autosave has stored the latest edits.
 */
export function PublishDialog({
  open,
  onOpenChange,
  site,
  businessId,
  saveState,
  revision,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site;
  businessId: string;
  saveState: SaveState;
  revision: () => number;
}) {
  const publish = usePublish(businessId);
  const [editingAddress, setEditingAddress] = useState(false);
  const [done, setDone] = useState(false);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setDone(false);
      setEditingAddress(false);
      publish.reset();
    }
  };

  const needsAddress = !site.subdomain || editingAddress;
  const saved = saveState === 'saved';

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title={done ? 'האתר באוויר!' : needsAddress ? 'בחירת כתובת לאתר' : 'פרסום האתר'}
    >
      {done && site.publicUrl ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-100 text-accent-600">
            <PartyPopper aria-hidden className="h-7 w-7" />
          </span>
          <p className="text-ink-muted">כל מי שייכנס לכתובת הזו יראה את הגרסה שפרסמתם עכשיו.</p>
          <a
            href={site.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-2 font-medium text-brand-800 hover:underline"
          >
            {site.publicUrl.replace(/^https?:\/\//, '')}
            <ExternalLink aria-hidden className="h-4 w-4" />
          </a>
          <Button variant="secondary" onClick={() => close(false)}>
            חזרה לעריכה
          </Button>
        </div>
      ) : needsAddress ? (
        <SubdomainForm
          site={site}
          businessId={businessId}
          onDone={() => setEditingAddress(false)}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1 rounded-2xl bg-surface-muted p-4">
            <span className="text-xs text-ink-muted">האתר יתפרסם בכתובת</span>
            <div className="flex items-center justify-between gap-3">
              <bdi dir="ltr" className="truncate font-medium text-ink">
                {site.publicUrl?.replace(/^https?:\/\//, '')}
              </bdi>
              <button
                type="button"
                className="text-sm font-medium text-brand-700 hover:underline"
                onClick={() => setEditingAddress(true)}
              >
                שינוי
              </button>
            </div>
          </div>
          <p className="text-sm text-ink-muted">
            הגרסה הנוכחית של הטיוטה תעלה לאוויר, כולל פרטי העסק העדכניים. אפשר לחזור לגרסה קודמת בכל
            זמן.
          </p>
          {publish.isError && <Alert tone="danger">{errorMessage(publish.error)}</Alert>}
          {!saved && (
            <p role="status" className="text-sm text-ink-muted">
              {saveState === 'error' || saveState === 'conflict'
                ? 'יש שינויים שלא נשמרו. יש לשמור אותם לפני הפרסום.'
                : 'שומרים את השינויים האחרונים…'}
            </p>
          )}
          <Button
            size="lg"
            loading={publish.isPending}
            disabled={!saved}
            onClick={async () => {
              await publish.mutateAsync({ revision: revision() }).then(
                () => setDone(true),
                () => undefined,
              );
            }}
          >
            {site.published ? 'פרסום השינויים' : 'פרסום האתר'}
          </Button>
        </div>
      )}
    </DialogShell>
  );
}
