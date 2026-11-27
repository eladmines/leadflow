import {
  isValidIsoDate,
  LEAD_FIELD_FILTER_VALUE_MAX,
  type CustomFieldValue,
  type LeadFieldDefinition,
  type LeadFieldFilters,
  type LeadFieldType,
} from '@simplecatch/shared';
import { intlLocale, tr } from '../../i18n';

/** The type names, in the app's language. */
export function leadFieldTypeLabel(type: LeadFieldType): string {
  switch (type) {
    case 'text':
      return tr('טקסט');
    case 'number':
      return tr('מספר');
    case 'date':
      return tr('תאריך');
    case 'select':
      return tr('בחירה מרשימה');
    case 'boolean':
      return tr('תיבת סימון');
  }
}

/** A number field's optional bounds in words, or null when it has none. */
export function rangeText(field: Pick<LeadFieldDefinition, 'type' | 'min' | 'max'>): string | null {
  if (field.type !== 'number' || (field.min === null && field.max === null)) return null;
  if (field.min !== null && field.max !== null)
    return tr('ערך בין {0} ל־{1}', field.min, field.max);
  return field.min !== null ? tr('ערך מ־{0} ומעלה', field.min) : tr('ערך עד {0}', field.max);
}

/** The value as an input holds it: text for text/number/date/select, a flag for a checkbox. */
export type RawValue = string | boolean;

export function toRaw(field: Pick<LeadFieldDefinition, 'type'>, stored: unknown): RawValue {
  if (field.type === 'boolean') return stored === true;
  if (stored === null || stored === undefined) return '';
  return String(stored);
}

/** An option's label, archived options included (old values keep their label). */
export function optionLabel(field: LeadFieldDefinition, optionId: string): string | null {
  return field.options.find((o) => o.id === optionId)?.label ?? null;
}

const numberFmt = () => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 6 });
const dateFmt = () =>
  new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeZone: 'UTC' });

/** A stored value for reading (lead card, history, list). `null` = no value. */
export function formatCustomValue(
  field: LeadFieldDefinition | undefined,
  value: CustomFieldValue | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!field) return String(value);
  switch (field.type) {
    case 'boolean':
      return value === true ? tr('כן') : null;
    case 'number':
      return typeof value === 'number' ? numberFmt().format(value) : String(value);
    case 'date':
      return typeof value === 'string' && isValidIsoDate(value)
        ? dateFmt().format(new Date(`${value}T00:00:00Z`))
        : String(value);
    case 'select':
      return optionLabel(field, String(value)) ?? tr('אפשרות שנמחקה');
    case 'text':
      return String(value);
  }
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Keeps the list filters the API will accept: only active fields, the right parts for each type
 * and well-formed values. Stale filters (a field archived since the link was made) are dropped
 * here instead of failing the whole list (D-204 (6)).
 */
export function usableFilters(
  filters: LeadFieldFilters,
  fields: readonly LeadFieldDefinition[],
): LeadFieldFilters {
  const out: LeadFieldFilters = {};
  for (const [id, f] of Object.entries(filters)) {
    const field = fields.find((d) => d.id === id && !d.archivedAt);
    if (!field) continue;
    const ok = (v: string | undefined) => v && v.length <= LEAD_FIELD_FILTER_VALUE_MAX;
    switch (field.type) {
      case 'text':
        if (ok(f.value)) out[id] = { value: f.value };
        break;
      case 'select':
        if (ok(f.value) && field.options.some((o) => o.id === f.value))
          out[id] = { value: f.value };
        break;
      case 'boolean':
        if (f.value === 'true' || f.value === 'false') out[id] = { value: f.value };
        break;
      case 'number':
      case 'date': {
        const valid = (v: string | undefined) =>
          ok(v) && (field.type === 'number' ? NUMBER_RE.test(v!) : isValidIsoDate(v!));
        const part = {
          ...(valid(f.from) ? { from: f.from } : {}),
          ...(valid(f.to) ? { to: f.to } : {}),
        };
        if (part.from || part.to) out[id] = part;
        break;
      }
    }
  }
  return out;
}

export const isNumberText = (s: string) => NUMBER_RE.test(s.trim());
