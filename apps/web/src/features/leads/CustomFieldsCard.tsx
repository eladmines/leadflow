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
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { Link } from 'react-router-dom';
import { Alert, Card, Spinner, buttonClasses } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { isRtl, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { CustomFieldInput } from '../leadFields/CustomFieldInput';
import { activeFields, archivedFields, useLeadFields } from '../leadFields/api';
import { formatCustomValue, toRaw, type RawValue } from '../leadFields/format';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useUpdateLead } from './api';

/**
 * The lead card's "Details" block (F34): each active custom field, editable in place (a PATCH
 * with just that key), and the values of archived fields, read-only.
 */
export function CustomFieldsCard({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const fields = useLeadFields(business.id);
  const canEdit = can(business.role, 'leads.update');
  const values: CustomFieldValues = lead.customFields ?? {};

  const heading = <h2 className="text-lg font-semibold text-ink">{tr('פרטים')}</h2>;

  if (fields.isPending) {
    return (
      <Card className="flex flex-col gap-3">
        {heading}
        <Spinner label={tr('טוענים את השדות…')} />
      </Card>
    );
  }
  if (fields.isError) {
    return (
      <Card className="flex flex-col gap-3">
        {heading}
        <Alert tone="danger" title={tr('לא הצלחנו לטעון את השדות')}>
          {errorMessage(fields.error)}
        </Alert>
      </Card>
    );
  }

  const active = activeFields(fields.data);
  const archived = archivedFields(fields.data).filter((f) => values[f.id] !== undefined);

  if (active.length === 0 && archived.length === 0) {
    // Nothing to fill in: point those who can add fields to the settings; others see nothing.
    if (!can(business.role, 'leadFields.manage')) return null;
    return (
      <Card className="flex flex-col gap-3">
        {heading}
        <p className="text-sm text-ink-muted">
          {tr('אפשר להוסיף לכל ליד שדות משלכם, למשל תאריך האירוע או דגם הרכב.')}
        </p>
        <Link
          to={`${businessWebPaths.section(business.id, 'settings')}?tab=fields`}
          className={buttonClasses('secondary', 'sm', 'self-start')}
        >
          {tr('להגדרת השדות')}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      {heading}
      {active.length > 0 &&
        (canEdit ? (
          <div className="flex flex-col gap-4">
            {active.map((f) => (
              // Re-mounted when its own stored value changes, so a save elsewhere keeps drafts here.
              <InlineField
                key={`${f.id}:${JSON.stringify(values[f.id] ?? null)}`}
                lead={lead}
                field={f}
                values={values}
              />
            ))}
          </div>
        ) : (
          <ReadOnlyValues fields={active} values={values} />
        ))}
      {archived.length > 0 && (
        <section aria-labelledby={`archived-${lead.id}`} className="flex flex-col gap-2">
          <h3 id={`archived-${lead.id}`} className="text-sm font-semibold text-ink-muted">
            {tr('שדות בארכיון')}
          </h3>
          <ReadOnlyValues fields={archived} values={values} muted />
        </section>
      )}
    </Card>
  );
}

function ReadOnlyValues({
  fields,
  values,
  muted = false,
}: {
  fields: LeadFieldDefinition[];
  values: CustomFieldValues;
  muted?: boolean;
}) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {fields.map((f) => (
        <div key={f.id} className="flex flex-wrap justify-between gap-x-3">
          <dt
            className={cn(
              'min-w-0 [overflow-wrap:anywhere]',
              muted ? 'text-ink-muted' : 'font-medium text-ink',
            )}
          >
            <bdi>{f.label}</bdi>
          </dt>
          <dd className="min-w-0 text-ink [overflow-wrap:anywhere]" dir="auto">
            {formatCustomValue(f, values[f.id]) ?? <span className="text-ink-subtle">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function InlineField({
  lead,
  field,
  values,
}: {
  lead: Lead;
  field: LeadFieldDefinition;
  values: CustomFieldValues;
}) {
  const business = useCurrentBusiness();
  const update = useUpdateLead(business.id);
  const stored = values[field.id];
  const [raw, setRaw] = useState<RawValue>(() => toRaw(field, stored));
  const [error, setError] = useState<string | undefined>();
  const path = `customFields.${field.id}`;

  const commit = (next: RawValue) => {
    // The same check as the server: type, range, option, and a required field can't be emptied.
    const checked = validateCustomFields(
      [field],
      { [field.id]: next },
      {
        mode: 'update',
        fromApp: true,
        existing: values,
      },
    );
    if (!checked.ok) {
      setError(checked.fields[path] ?? Object.values(checked.fields)[0]);
      return;
    }
    setError(undefined);
    const value = checked.values[field.id] ?? null;
    if (value === (stored ?? null)) return;
    update.mutate(
      { leadId: lead.id, body: { customFields: { [field.id]: value } } },
      {
        onError: (err) =>
          setError(
            err instanceof ApiError && err.fields?.[path] ? err.fields[path] : errorMessage(err),
          ),
      },
    );
  };

  const immediate = field.type === 'select' || field.type === 'boolean';

  return (
    <div className="flex flex-col gap-1" aria-busy={update.isPending || undefined}>
      <CustomFieldInput
        id={`cf-${field.id}`}
        field={field}
        value={raw}
        error={error}
        onChange={(v) => {
          setRaw(v);
          if (immediate) commit(v);
        }}
        onBlur={immediate ? undefined : () => commit(raw)}
      />
      {update.isPending && (
        <p role="status" className="text-xs text-ink-muted">
          {tr('שומר…')}
        </p>
      )}
    </div>
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
