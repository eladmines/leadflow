import {
  leadFieldMessages,
  type CustomFieldValues,
  type LeadFieldDefinition,
  type LeadFieldFilter,
  type LeadFieldFilters,
} from '@simplecatch/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SelectMenu } from '../../components/ui';
import { cn } from '../../lib/cn';
import { isRtl, tr } from '../../i18n';
import { formatCustomValue, isNumberText } from '../leadFields/format';

type Part = keyof LeadFieldFilter;
export type SetFieldFilter = (fieldId: string, part: Part, value: string | undefined) => void;

/** Like the compact dropdown: 32px high, for the filter panel. */
const compactInput = (invalid: boolean) =>
  cn(
    'h-8 w-full rounded-lg border bg-surface px-2 text-sm text-ink shadow-card transition-[border-color,box-shadow] placeholder:text-ink-subtle hover:border-accent-300 focus-visible:ring-4 focus-visible:ring-offset-0',
    invalid
      ? 'border-danger-600 focus-visible:ring-danger-600/15'
      : 'border-surface-border focus-visible:border-brand-500 focus-visible:ring-brand-500/15',
  );

const captionClasses = 'text-xs font-medium text-ink-muted [overflow-wrap:anywhere]';

/**
 * One filter per active custom field (F34): text contains, choice and checkbox equal, number and
 * date from–to. Values travel in the page address (`cf[...]`), so a filtered list can be shared.
 */
export function CustomFieldFilters({
  fields,
  filters,
  onChange,
  manageTo,
}: {
  fields: LeadFieldDefinition[];
  filters: LeadFieldFilters;
  onChange: SetFieldFilter;
  /** The lead-fields page, for those who may manage fields (`leadFields.manage`). */
  manageTo?: string;
}) {
  if (fields.length === 0) {
    return manageTo ? (
      <div className="flex basis-full">
        <ManageFieldsLink to={manageTo} />
      </div>
    ) : null;
  }
  return (
    <div
      role="group"
      aria-label={tr('סינון לפי שדות נוספים')}
      className="flex basis-full flex-wrap items-end gap-3"
    >
      {fields.map((f) => (
        <FieldFilter key={f.id} field={f} filter={filters[f.id] ?? {}} onChange={onChange} />
      ))}
      {manageTo && <ManageFieldsLink to={manageTo} />}
    </div>
  );
}

/** "ניהול שדות": a shortcut to the lead-fields page (D-206). */
export function ManageFieldsLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex h-8 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
    >
      <Settings2 aria-hidden className="h-4 w-4" />
      {tr('ניהול שדות')}
    </Link>
  );
}

function FieldFilter({
  field,
  filter,
  onChange,
}: {
  field: LeadFieldDefinition;
  filter: LeadFieldFilter;
  onChange: SetFieldFilter;
}) {
  const set = useCallback(
    (part: Part, value: string | undefined) => onChange(field.id, part, value),
    [field.id, onChange],
  );
  switch (field.type) {
    case 'select':
      return (
        <SelectMenu
          compact
          className="min-w-36"
          labelClassName={captionClasses}
          label={field.label}
          value={filter.value ?? ''}
          onChange={(v) => set('value', v || undefined)}
          options={[
            { value: '', label: tr('הכל') },
            ...field.options.map((o) => ({
              value: o.id,
              // Old values can still be found by an option that was removed since.
              label: o.archivedAt ? `${o.label} (${tr('הוסרה')})` : o.label,
            })),
          ]}
        />
      );
    case 'boolean':
      return (
        <SelectMenu
          compact
          className="min-w-32"
          labelClassName={captionClasses}
          label={field.label}
          value={filter.value ?? ''}
          onChange={(v) => set('value', v || undefined)}
          options={[
            { value: '', label: tr('הכל') },
            { value: 'true', label: tr('מסומן') },
            { value: 'false', label: tr('לא מסומן') },
          ]}
        />
      );
    case 'text':
      return <TextFilter field={field} value={filter.value} set={set} />;
    case 'number':
    case 'date':
      return <RangeFilter field={field} filter={filter} set={set} />;
  }
}

/** Contains: written into the address after a short pause, like the search box. */
function TextFilter({
  field,
  value,
  set,
}: {
  field: LeadFieldDefinition;
  value: string | undefined;
  set: (part: Part, value: string | undefined) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? '');
  // Cleared from outside ("clear filters"): follow it.
  useEffect(() => {
    setText((t) => (t.trim() === (value ?? '') ? t : (value ?? '')));
  }, [value]);
  useEffect(() => {
    const next = text.trim() || undefined;
    if (next === value) return;
    const t = setTimeout(() => set('value', next), 400);
    return () => clearTimeout(t);
  }, [text, value, set]);
  return (
    <div className="flex min-w-36 max-w-full flex-col gap-1.5">
      <label htmlFor={id} className={captionClasses}>
        <bdi>{field.label}</bdi>
      </label>
      <input
        id={id}
        type="search"
        dir="auto"
        maxLength={100}
        value={text}
        placeholder={tr('מכיל…')}
        onChange={(e) => setText(e.target.value)}
        className={compactInput(false)}
      />
    </div>
  );
}

/** From–to (inclusive). Numbers are written into the address once they are numbers. */
function RangeFilter({
  field,
  filter,
  set,
}: {
  field: LeadFieldDefinition;
  filter: LeadFieldFilter;
  set: (part: Part, value: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-caption`}
      className="flex max-w-full flex-col gap-1.5"
    >
      <span id={`${id}-caption`} className={captionClasses}>
        <bdi>{field.label}</bdi>
      </span>
      <div className="flex items-center gap-1.5">
        <Bound
          field={field}
          id={`${id}-from`}
          label={tr('{0}: מ־', field.label)}
          placeholder={tr('מ־')}
          value={filter.from}
          onCommit={(v) => set('from', v)}
        />
        <span aria-hidden className="text-ink-subtle">
          –
        </span>
        <Bound
          field={field}
          id={`${id}-to`}
          label={tr('{0}: עד', field.label)}
          placeholder={tr('עד')}
          value={filter.to}
          onCommit={(v) => set('to', v)}
        />
      </div>
    </div>
  );
}

function Bound({
  field,
  id,
  label,
  placeholder,
  value,
  onCommit,
}: {
  field: LeadFieldDefinition;
  id: string;
  label: string;
  placeholder: string;
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const isNumber = field.type === 'number';
  const invalid = isNumber && text.trim() !== '' && !isNumberText(text);
  const commit = (raw: string) => {
    const v = raw.trim();
    if (isNumber && v && !isNumberText(v)) return;
    if ((v || undefined) !== value) onCommit(v || undefined);
  };
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type={isNumber ? 'text' : 'date'}
        inputMode={isNumber ? 'decimal' : undefined}
        dir="ltr"
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        title={invalid ? tr(leadFieldMessages.numberInvalid) : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (!isNumber) commit(e.target.value);
        }}
        onBlur={(e) => isNumber && commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isNumber) commit(e.currentTarget.value);
        }}
        className={cn(compactInput(invalid), isNumber ? 'w-24' : 'w-36', isRtl() && 'text-end')}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fields shown on the lead cards (per user, in this browser)
// ---------------------------------------------------------------------------

const MAX_CARD_FIELDS = 2;
const cardFieldsKey = (businessId: string) => `simplecatch.leadCardFields.${businessId}`;

/** Up to two custom fields shown on each lead card, chosen per user and kept in this browser. */
export function useCardFields(businessId: string): [string[], (ids: string[]) => void] {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(cardFieldsKey(businessId)) ?? '[]');
      return Array.isArray(saved)
        ? saved.filter((x): x is string => typeof x === 'string').slice(0, MAX_CARD_FIELDS)
        : [];
    } catch {
      return [];
    }
  });
  const save = useCallback(
    (next: string[]) => {
      const clean = [...new Set(next.filter(Boolean))].slice(0, MAX_CARD_FIELDS);
      setIds(clean);
      try {
        localStorage.setItem(cardFieldsKey(businessId), JSON.stringify(clean));
      } catch {
        // Not remembered; the choice lasts for this visit.
      }
    },
    [businessId],
  );
  return [ids, save];
}

/** Two dropdowns: which fields the cards show. */
export function CardFieldsPicker({
  fields,
  value,
  onChange,
}: {
  fields: LeadFieldDefinition[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (fields.length === 0) return null;
  const options = [
    { value: '', label: tr('בלי') },
    ...fields.map((f) => ({ value: f.id, label: f.label })),
  ];
  return (
    <div
      role="group"
      aria-label={tr('שדות שמוצגים בכרטיסי הלידים')}
      className="flex basis-full flex-wrap items-end gap-3 border-t border-surface-border pt-3"
    >
      {Array.from({ length: MAX_CARD_FIELDS }, (_, i) => (
        <SelectMenu
          key={i}
          compact
          className="min-w-36"
          labelClassName={captionClasses}
          label={i === 0 ? tr('שדה בכרטיסים') : tr('שדה נוסף בכרטיסים')}
          value={value[i] ?? ''}
          onChange={(v) => {
            const next = [...value];
            next[i] = v;
            onChange(next);
          }}
          options={options.filter(
            (o) => !o.value || o.value === value[i] || !value.includes(o.value),
          )}
        />
      ))}
    </div>
  );
}

/** The chosen fields' values on a card (nothing when a lead has none). */
export function CardFieldValues({
  fields,
  values,
}: {
  fields: LeadFieldDefinition[];
  values: CustomFieldValues | undefined;
}) {
  const shown = fields
    .map((f) => ({ f, text: formatCustomValue(f, values?.[f.id]) }))
    .filter((x) => x.text !== null);
  if (shown.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {shown.map(({ f, text }) => (
        <div key={f.id} className="flex min-w-0 max-w-full gap-1">
          <dt className="shrink-0 text-ink-muted">
            <bdi>{f.label}</bdi>:
          </dt>
          <dd className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">
            <bdi>{text}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
