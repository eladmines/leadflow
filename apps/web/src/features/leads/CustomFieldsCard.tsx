import {
  businessWebPaths,
  can,
  leadUpdatedActivityDataSchema,
  validateCustomFields,
  type Activity,
  type CustomFieldValues,
  type Lead,
  type LeadFieldDefinition,
} from '@simplecatch/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { isRtl, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { CustomFieldInput } from '../leadFields/CustomFieldInput';
import { activeFields, archivedFields, useLeadFields } from '../leadFields/api';
import { formatCustomValue, toRaw, type RawValue } from '../leadFields/format';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useUpdateLead } from './api';
import { ManageFieldsLink } from './CustomFieldFilters';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The lead page's draft of the "Details" custom fields (D-207/D-209): edits stay here until the
 * one "שמירה" sends them together (one PATCH with `customFields`). Owned by the page, so it can warn
 * before leaving with unsaved changes; survives refetches of the lead.
 */
export function useCustomFieldsDraft(lead: Lead) {
  const business = useCurrentBusiness();
  const fields = useLeadFields(business.id);
  const update = useUpdateLead(business.id);
  const [edits, setEdits] = useState<Record<string, RawValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const values: CustomFieldValues = lead.customFields ?? {};
  const active = activeFields(fields.data);

  /** Edited fields whose text differs from the stored value. */
  const changed = active.filter((f) => f.id in edits && edits[f.id] !== toRaw(f, values[f.id]));
  const dirty = changed.length > 0;

  const rawOf = (field: LeadFieldDefinition): RawValue =>
    field.id in edits ? edits[field.id]! : toRaw(field, values[field.id]);

  const setValue = (field: LeadFieldDefinition, raw: RawValue) => {
    setEdits((e) => ({ ...e, [field.id]: raw }));
    setErrors((e) => {
      const next = { ...e };
      delete next[field.id];
      return next;
    });
    setFormError(null);
    if (status !== 'saving') setStatus('idle');
  };

  const discard = () => {
    setEdits({});
    setErrors({});
    setFormError(null);
    setStatus('idle');
  };

  const save = () => {
    if (!dirty || update.isPending) return;
    // The same check as the server: type, range, option, and a required field can't be emptied.
    const checked = validateCustomFields(
      active,
      Object.fromEntries(changed.map((f) => [f.id, edits[f.id]])),
      { mode: 'update', fromApp: true, existing: values },
    );
    if (!checked.ok) {
      setErrors(byField(checked.fields));
      setStatus('error');
      return;
    }
    const body = Object.fromEntries(
      Object.entries(checked.values).filter(([id, v]) => v !== (values[id] ?? null)),
    );
    if (Object.keys(body).length === 0) {
      discard();
      return;
    }
    setStatus('saving');
    update.mutate(
      { leadId: lead.id, body: { customFields: body } },
      {
        onSuccess: () => {
          setEdits({});
          setErrors({});
          setFormError(null);
          setStatus('saved');
        },
        onError: (err) => {
          const perField = err instanceof ApiError && err.fields ? byField(err.fields) : {};
          setErrors(perField);
          setFormError(Object.keys(perField).length > 0 ? null : errorMessage(err));
          setStatus('error');
        },
      },
    );
  };

  return { lead, fields, values, rawOf, setValue, errors, formError, status, dirty, save, discard };
}

export type CustomFieldsDraft = ReturnType<typeof useCustomFieldsDraft>;

/** `{ "customFields.<id>": message }` → `{ <id>: message }`. */
function byField(fields: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fields)) {
    if (path.startsWith('customFields.')) out[path.slice('customFields.'.length)] = message;
  }
  return out;
}

/**
 * "פרטים" in the "מידע" tab (D-220): the custom fields, edited in place and saved together
 * with one "שמירה" (D-207), "ביטול שינויים" to drop the edits; read-only for those who can't edit.
 */
export function CustomFieldsPanel({ draft }: { draft: CustomFieldsDraft }) {
  const business = useCurrentBusiness();
  const { fields, values, lead } = draft;
  const canEdit = can(business.role, 'leads.update');
  const canManage = can(business.role, 'leadFields.manage');
  const active = activeFields(fields.data);
  const saving = draft.status === 'saving';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    draft.save();
  };
  // D-220: no fields defined → no section at all (fields are managed from Leads → More).
  if (fields.isSuccess && active.length === 0) return null;

  return (
    <section aria-labelledby="lead-fields-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lead-fields-title" className="text-base font-semibold text-ink">
          {tr('פרטים')}
        </h2>
        {canManage && (
          <ManageFieldsLink to={businessWebPaths.section(business.id, 'leads/fields')} />
        )}
      </div>
      {fields.isPending ? (
        <Spinner size="sm" label={tr('טוענים את השדות…')} />
      ) : fields.isError ? (
        <Alert tone="danger" title={tr('לא הצלחנו לטעון את השדות')}>
          {errorMessage(fields.error)}
        </Alert>
      ) : active.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {canManage
            ? tr('אפשר להוסיף לכל ליד שדות משלכם, למשל תאריך האירוע או דגם הרכב.')
            : tr('אין שדות נוספים.')}
        </p>
      ) : canEdit ? (
        <form
          noValidate
          onSubmit={submit}
          aria-label={tr('פרטים')}
          aria-busy={saving || undefined}
          className="flex flex-col gap-4"
        >
          {active.map((f) => (
            <CustomFieldInput
              key={f.id}
              id={`cf-${f.id}`}
              field={f}
              value={draft.rawOf(f)}
              error={draft.errors[f.id]}
              onChange={(v) => draft.setValue(f, v)}
            />
          ))}
          {draft.formError && <Alert tone="danger">{draft.formError}</Alert>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p role="status" className="me-auto text-xs text-ink-muted">
              {saving
                ? tr('שומר…')
                : draft.dirty
                  ? tr('יש שינויים שלא נשמרו')
                  : draft.status === 'saved'
                    ? tr('השינויים נשמרו')
                    : ''}
            </p>
            {draft.dirty && !saving && (
              <Button type="button" variant="ghost" size="sm" onClick={draft.discard}>
                {tr('ביטול שינויים')}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!draft.dirty} loading={saving}>
              {tr('שמירה')}
            </Button>
          </div>
        </form>
      ) : (
        <dl aria-label={tr('פרטים')} className="flex flex-col gap-1.5 text-sm">
          {active.map((f) => (
            <div key={f.id} className="flex min-w-0 flex-wrap gap-x-1.5">
              <dt className="min-w-0 text-ink-muted [overflow-wrap:anywhere]">
                <bdi>{f.label}</bdi>:
              </dt>
              <dd className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]" dir="auto">
                {formatCustomValue(f, values[f.id]) ?? <span className="text-ink-subtle">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ArchivedFieldValues lead={lead} />
    </section>
  );
}

/** Values kept from fields since archived, read-only (in "פרטים", D-220); nothing when none. */
export function ArchivedFieldValues({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const fields = useLeadFields(business.id);
  const values: CustomFieldValues = lead.customFields ?? {};
  const archived = archivedFields(fields.data).filter((f) => values[f.id] !== undefined);
  if (archived.length === 0) return null;
  return (
    <section aria-labelledby={`archived-${lead.id}`} className="flex flex-col gap-2">
      <h3 id={`archived-${lead.id}`} className="text-sm font-semibold text-ink-muted">
        {tr('שדות בארכיון')}
      </h3>
      <dl className="flex flex-col gap-1.5 text-sm">
        {archived.map((f) => (
          <div key={f.id} className="flex min-w-0 flex-wrap gap-x-1.5">
            <dt className="min-w-0 text-ink-muted [overflow-wrap:anywhere]">
              <bdi>{f.label}</bdi>:
            </dt>
            <dd className="min-w-0 text-ink [overflow-wrap:anywhere]" dir="auto">
              {formatCustomValue(f, values[f.id])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The custom-field changes of a `lead.updated` history entry: field label, old → new value
 * (option labels for a choice, "Yes" for a ticked box), resolved from the definitions.
 */
export function CustomFieldChanges({ activity }: { activity: Activity }) {
  const business = useCurrentBusiness();
  const fields = useLeadFields(business.id);
  const parsed = leadUpdatedActivityDataSchema.safeParse(activity.data);
  const changes = parsed.success ? (parsed.data.customFields ?? []) : [];
  if (changes.length === 0) return null;
  const empty = tr('ריק');
  return (
    <ul className="flex flex-col gap-0.5 text-sm text-ink">
      {changes.map((c) => {
        const field = fields.data?.find((f) => f.id === c.fieldId);
        return (
          <li
            key={c.fieldId}
            className="flex flex-wrap items-baseline gap-x-1.5 [overflow-wrap:anywhere]"
          >
            <bdi className="font-medium">{field?.label ?? tr('שדה נוסף')}</bdi>:
            <bdi className="text-ink-muted">{formatCustomValue(field, c.from) ?? empty}</bdi>
            <span aria-hidden>{isRtl() ? '←' : '→'}</span>
            <span className="sr-only">{tr('שונה ל')}</span>
            <bdi>{formatCustomValue(field, c.to) ?? empty}</bdi>
          </li>
        );
      })}
    </ul>
  );
}
