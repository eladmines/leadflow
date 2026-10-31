import { websiteUrlSchema, type Business } from '@leadflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, Info } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Card, Field } from '../../components/ui';
import { applyServerErrors } from '../auth/serverErrors';
import { useUpdateBusiness } from '../businesses/api';

const formSchema = z.object({ websiteUrl: websiteUrlSchema });
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/** "www.x.co.il/path" for display: the address without the scheme or a trailing slash. */
const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '');

/** Saves (or clears) the business's existing website address. */
function WebsiteForm({
  business,
  onDone,
  compact = false,
}: {
  business: Business;
  onDone?: () => void;
  compact?: boolean;
}) {
  const update = useUpdateBusiness(business.id);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { websiteUrl: business.websiteUrl ?? '' },
  });
  const [formError, setFormError] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await update.mutateAsync({ websiteUrl: v.websiteUrl });
      onDone?.();
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['websiteUrl']));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <Field
            label="כתובת האתר הקיים"
            placeholder="www.my-business.co.il"
            ltr
            inputMode="url"
            autoComplete="url"
            error={form.formState.errors.websiteUrl?.message}
            {...form.register('websiteUrl')}
          />
        </div>
        <Button type="submit" size={compact ? 'sm' : 'md'} loading={update.isPending}>
          שמירה
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" size={compact ? 'sm' : 'md'} onClick={onDone}>
            ביטול
          </Button>
        )}
      </div>
      {formError && <Alert tone="danger">{formError}</Alert>}
    </form>
  );
}

/** Invitation shown above the template picker: "already have a site? add its address". */
export function AddExistingWebsite({ business }: { business: Business }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-ink">כבר יש לעסק אתר?</h2>
          <p className="text-sm text-ink-muted">
            הוסיפו את הכתובת כדי לראות אותו כאן. LeadFlow לא ינהל אותו ולא ישנה בו דבר.
          </p>
        </div>
        {!open && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            הוספת האתר הקיים
          </Button>
        )}
      </div>
      {open && <WebsiteForm business={business} onDone={() => setOpen(false)} compact />}
    </Card>
  );
}

/**
 * The business's existing website (D-094): address, live preview and a clear note that LeadFlow
 * does not manage it. Owners can change or remove the address.
 */
export function ExistingWebsite({ business, canEdit }: { business: Business; canEdit: boolean }) {
  const url = business.websiteUrl!;
  const update = useUpdateBusiness(business.id);
  const [editing, setEditing] = useState(false);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-ink">האתר הקיים של העסק</h2>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
          >
            <bdi dir="ltr">{displayUrl(url)}</bdi>
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            <span className="sr-only">(נפתח בחלון חדש)</span>
          </a>
        </div>
        <span className="rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-ink-muted">
          לא מנוהל ב-LeadFlow
        </span>
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-surface-muted p-3 text-sm text-ink">
        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <span>
          האתר הזה לא נבנה ב-LeadFlow ולא מנוהל כאן. אפשר לצפות בו, אבל שינויים בו נעשים אצל מי שבנה
          או מארח אותו. פניות מהאתר הזה לא נכנסות אוטומטית למערכת.
        </span>
      </p>

      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-muted">
        <iframe
          title="תצוגה של האתר הקיים"
          src={url}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="block h-[28rem] w-full bg-white"
        />
      </div>
      <p className="text-xs text-ink-muted">
        לא רואים את האתר? חלק מהאתרים לא מאפשרים הצגה בתוך מערכות אחרות. אפשר לפתוח אותו בחלון חדש
        מהקישור למעלה.
      </p>

      {canEdit &&
        (editing ? (
          <WebsiteForm business={business} onDone={() => setEditing(false)} compact />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              שינוי הכתובת
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={update.isPending}
              onClick={() => update.mutate({ websiteUrl: null })}
            >
              הסרת האתר מהמערכת
            </Button>
          </div>
        ))}
      {update.isError && <Alert tone="danger">שמירת השינוי נכשלה. נסו שוב.</Alert>}
    </Card>
  );
}
