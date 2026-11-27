import {
  can,
  createLeadFieldRequestSchema,
  LEAD_FIELD_LABEL_MAX,
  LEAD_FIELD_OPTION_LABEL_MAX,
  LEAD_FIELD_OPTIONS_MAX,
  LEAD_FIELD_TYPES,
  leadFieldMessages,
  MAX_ACTIVE_LEAD_FIELDS,
  updateLeadFieldRequestSchema,
  type LeadFieldDefinition,
  type LeadFieldType,
  type UpdateLeadFieldRequest,
} from '@simplecatch/shared';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type { ZodIssue } from 'zod';
import {
  Alert,
  Button,
  Checkbox,
  DialogShell,
  EmptyState,
  Field,
  SelectMenu,
  Spinner,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import {
  activeFields,
  archivedFields,
  useCreateLeadField,
  useLeadFields,
  useReorderLeadFields,
  useUpdateLeadField,
} from '../leadFields/api';
import { isNumberText, leadFieldTypeLabel, rangeText } from '../leadFields/format';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { Section } from './SettingsPage';

/**
 * Settings → Lead fields (F34): the business's own fields on every lead. Owners and managers
 * (`leadFields.manage`) add, edit, reorder, archive and restore them; the server enforces it.
 */
export function LeadFieldsSection() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'leadFields.manage')) {
    return <NoPermission what={tr('שדות הלידים')} />;
  }
  return <LeadFieldsManager businessId={business.id} />;
}

type DialogState = { mode: 'create' } | { mode: 'edit'; field: LeadFieldDefinition } | null;

/** One line under a field's name: its type, required, options or range. */
function summary(f: LeadFieldDefinition): string {
  const parts = [leadFieldTypeLabel(f.type)];
  if (f.required) parts.push(tr('חובה'));
  if (f.type === 'select') {
    parts.push(tr('אפשרויות: {0}', f.options.filter((o) => !o.archivedAt).length));
  }
  const range = rangeText(f);
  if (range) parts.push(range);
  return parts.join(' · ');
}

function LeadFieldsManager({ businessId }: { businessId: string }) {
  const fields = useLeadFields(businessId);
  const reorder = useReorderLeadFields(businessId);
  const update = useUpdateLeadField(businessId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [archiving, setArchiving] = useState<LeadFieldDefinition | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  // After a keyboard move, focus goes back to the moved field's arrow (the row moved in the DOM).
  const [refocus, setRefocus] = useState<{ id: string; dir: 'up' | 'down'; to: number } | null>(
    null,
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const active = activeFields(fields.data);
  const archived = archivedFields(fields.data);

  useEffect(() => {
    // Wait until the list shows the new order (it's applied right after the click).
    if (!refocus || active.findIndex((f) => f.id === refocus.id) !== refocus.to) return;
    const want = document.getElementById(`lf-${refocus.dir}-${refocus.id}`) as HTMLButtonElement;
    const other = document.getElementById(
      `lf-${refocus.dir === 'up' ? 'down' : 'up'}-${refocus.id}`,
    ) as HTMLButtonElement;
    (want && !want.disabled ? want : other)?.focus();
    setRefocus(null);
  }, [refocus, active]);

  const saveOrder = (ids: string[], moved: LeadFieldDefinition) => {
    setActionError(null);
    reorder.mutate(
      { ids },
      {
        onError: (err) => {
          setRefocus(null);
          setActionError(errorMessage(err));
        },
        onSuccess: () =>
          setAnnounce(tr('השדה {0} הועבר למקום {1}', moved.label, ids.indexOf(moved.id) + 1)),
      },
    );
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= active.length) return;
    const ids = active.map((f) => f.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const moved = active[index]!;
    saveOrder(ids, moved);
    setRefocus({ id: moved.id, dir: delta < 0 ? 'up' : 'down', to: target });
  };

  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    setOverId(null);
    const fromId = dragId ?? e.dataTransfer.getData('text/lead-field-id');
    setDragId(null);
    if (!fromId || fromId === targetId) return;
    const ids = active.map((f) => f.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    const moved = active.find((f) => f.id === fromId);
    if (moved) saveOrder(ids, moved);
  };

  const setArchived = (field: LeadFieldDefinition, archivedFlag: boolean) => {
    setActionError(null);
    update.mutate(
      { fieldId: field.id, body: { archived: archivedFlag } },
      {
        onSuccess: () => {
          setArchiving(null);
          setAnnounce(
            archivedFlag
              ? tr('השדה {0} הועבר לארכיון', field.label)
              : tr('השדה {0} שוחזר', field.label),
          );
        },
        onError: (err) => {
          setArchiving(null);
          setActionError(errorMessage(err));
        },
      },
    );
  };

  return (
    <Section
      title={tr('שדות לידים')}
      description={tr(
        'שדות משלכם בכרטיס של כל ליד, למשל תאריך האירוע, דגם הרכב או סוג הטיפול. אפשר לסנן לפיהם ברשימת הלידים.',
      )}
      icon={ListChecks}
      tone="bg-teal-500"
      id="settings-lead-fields"
    >
      <p role="status" className="sr-only">
        {announce}
      </p>
      {fields.isPending ? (
        <Spinner label={tr('טוענים את השדות…')} />
      ) : fields.isError ? (
        <Alert tone="danger" title={tr('לא הצלחנו לטעון את השדות')}>
          <p>{errorMessage(fields.error)}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => void fields.refetch()}
          >
            {tr('לנסות שוב')}
          </Button>
        </Alert>
      ) : (
        <>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          {active.length === 0 ? (
            <EmptyState
              title={tr('עדיין אין שדות משלכם')}
              description={tr(
                'כל ליד מגיע עם שם, טלפון והודעה. הוסיפו שדות שחשובים לעסק שלכם, ומלאו אותם בכרטיס הליד.',
              )}
              action={
                <Button onClick={() => setDialog({ mode: 'create' })}>
                  <Plus aria-hidden className="h-4 w-4" />
                  {tr('הוספת שדה')}
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-muted">
                  {tr('{0} מתוך {1} שדות פעילים', active.length, MAX_ACTIVE_LEAD_FIELDS)}
                </p>
                <Button onClick={() => setDialog({ mode: 'create' })}>
                  <Plus aria-hidden className="h-4 w-4" />
                  {tr('הוספת שדה')}
                </Button>
              </div>
              {active.length >= MAX_ACTIVE_LEAD_FIELDS && (
                <Alert tone="info">{tr(leadFieldMessages.tooManyFields)}</Alert>
              )}
              <ol
                aria-label={tr('שדות פעילים')}
                className="flex flex-col divide-y divide-surface-border rounded-xl border border-surface-border"
              >
                {active.map((f, i) => (
                  <li
                    key={f.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(f.id);
                      e.dataTransfer.setData('text/lead-field-id', f.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverId(f.id);
                    }}
                    onDrop={(e) => onDrop(e, f.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5',
                      overId === f.id && dragId !== f.id && 'bg-brand-50',
                      dragId === f.id && 'opacity-60',
                    )}
                  >
                    <GripVertical
                      aria-hidden
                      className="hidden h-4 w-4 shrink-0 cursor-grab text-ink-subtle sm:block"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <bdi title={f.label} className="block truncate text-sm font-medium text-ink">
                        {f.label}
                      </bdi>
                      <span className="text-xs text-ink-muted">{summary(f)}</span>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <IconButton
                        id={`lf-up-${f.id}`}
                        label={tr('הזזת {0} למעלה', f.label)}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ChevronUp aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        id={`lf-down-${f.id}`}
                        label={tr('הזזת {0} למטה', f.label)}
                        disabled={i === active.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ChevronDown aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={tr('עריכת {0}', f.label)}
                        onClick={() => setDialog({ mode: 'edit', field: f })}
                      >
                        <Pencil aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={tr('העברת {0} לארכיון', f.label)}
                        onClick={() => setArchiving(f)}
                      >
                        <Archive aria-hidden className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {archived.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">{tr('בארכיון')}</h3>
              <p className="text-xs text-ink-muted">
                {tr(
                  'שדות בארכיון לא מופיעים בטפסים ובסינון. ערכים שכבר מולאו נשארים בכרטיסי הלידים לקריאה בלבד.',
                )}
              </p>
              <ul
                aria-label={tr('שדות בארכיון')}
                className="flex flex-col divide-y divide-surface-border rounded-xl border border-dashed border-surface-border"
              >
                {archived.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <bdi title={f.label} className="block truncate text-sm text-ink-muted">
                        {f.label}
                      </bdi>
                      <span className="text-xs text-ink-subtle">{leadFieldTypeLabel(f.type)}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={tr('שחזור {0}', f.label)}
                      loading={update.isPending && update.variables?.fieldId === f.id}
                      onClick={() => setArchived(f, false)}
                    >
                      <ArchiveRestore aria-hidden className="h-4 w-4" />
                      {tr('שחזור')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {dialog && (
        <FieldDialog
          key={dialog.mode === 'edit' ? dialog.field.id : 'new'}
          businessId={businessId}
          field={dialog.mode === 'edit' ? dialog.field : null}
          onClose={() => setDialog(null)}
          onSaved={(label, created) => {
            setDialog(null);
            setAnnounce(created ? tr('השדה {0} נוסף', label) : tr('השדה {0} נשמר', label));
          }}
        />
      )}
      <DialogShell
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archiving ? tr('להעביר את "{0}" לארכיון?', archiving.label) : ''}
      >
        <p className="text-sm text-ink-muted">
          {tr(
            'השדה לא יופיע יותר בטפסים ובסינון. ערכים שכבר מולאו יישארו בכרטיסי הלידים, ואפשר לשחזר את השדה בכל זמן.',
          )}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setArchiving(null)}>
            {tr('ביטול')}
          </Button>
          <Button
            loading={update.isPending}
            onClick={() => archiving && setArchived(archiving, true)}
          >
            <Archive aria-hidden className="h-4 w-4" />
            {tr('העברה לארכיון')}
          </Button>
        </div>
      </DialogShell>
    </Section>
  );
}

function IconButton({
  id,
  label,
  disabled,
  onClick,
  children,
}: {
  id?: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------

interface OptionRow {
  key: string;
  /** Existing options keep their id (rename/restore); new ones have none. */
  id?: string;
  label: string;
}

let rowSeq = 0;
const newRow = (o: { id?: string; label: string } = { label: '' }): OptionRow => ({
  key: `row-${++rowSeq}`,
  ...o,
});

/** Zod issues → `{ "options.0.label": message }`, the same keys as the API's `fields`. */
function issuesToErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.join('.') || 'form';
    out[key] ??= i.message;
  }
  return out;
}

const KNOWN = /^(label|type|options|min|max|required|options\.\d+\.label)$/;

function parseBound(s: string): number | null | 'invalid' {
  const t = s.trim();
  if (!t) return null;
  return isNumberText(t) ? Number(t) : 'invalid';
}

function FieldDialog({
  businessId,
  field,
  onClose,
  onSaved,
}: {
  businessId: string;
  /** null = a new field. */
  field: LeadFieldDefinition | null;
  onClose: () => void;
  onSaved: (label: string, created: boolean) => void;
}) {
  const create = useCreateLeadField(businessId);
  const update = useUpdateLeadField(businessId);
  const uid = useId();
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<LeadFieldType>(field?.type ?? 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<OptionRow[]>(() =>
    field
      ? field.options.filter((o) => !o.archivedAt).map((o) => newRow({ id: o.id, label: o.label }))
      : [],
  );
  // Removed options of an existing field: archived on save, and can be brought back.
  const [removed, setRemoved] = useState<{ id: string; label: string }[]>(() =>
    field
      ? field.options.filter((o) => o.archivedAt).map((o) => ({ id: o.id, label: o.label }))
      : [],
  );
  const [min, setMin] = useState(field?.min?.toString() ?? '');
  const [max, setMax] = useState(field?.max?.toString() ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`${uid}-opt-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, uid]);

  const changeType = (t: LeadFieldType) => {
    setType(t);
    if (t === 'boolean') setRequired(false);
    if (t === 'select' && options.length === 0) setOptions([newRow(), newRow()]);
  };

  const addOption = () => {
    const row = newRow();
    setOptions((o) => [...o, row]);
    setFocusKey(row.key);
  };
  const removeOption = (row: OptionRow) => {
    setOptions((o) => o.filter((x) => x.key !== row.key));
    if (row.id) setRemoved((r) => [...r, { id: row.id!, label: row.label }]);
  };
  const restoreOption = (opt: { id: string; label: string }) => {
    setRemoved((r) => r.filter((x) => x.id !== opt.id));
    setOptions((o) => [...o, newRow(opt)]);
  };
  const moveOption = (index: number, delta: -1 | 1) => {
    setOptions((o) => {
      const next = [...o];
      const target = index + delta;
      if (target < 0 || target >= next.length) return o;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.fields) {
      const mapped: Record<string, string> = {};
      let unmapped = false;
      for (const [k, v] of Object.entries(err.fields)) {
        if (KNOWN.test(k) && (k !== 'type' || !field)) mapped[k] = v;
        else unmapped = true;
      }
      setErrors(mapped);
      setFormError(unmapped || Object.keys(mapped).length === 0 ? errorMessage(err) : null);
    } else {
      setFormError(errorMessage(err));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const minV = type === 'number' ? parseBound(min) : null;
    const maxV = type === 'number' ? parseBound(max) : null;
    const boundErrors: Record<string, string> = {};
    if (minV === 'invalid') boundErrors.min = leadFieldMessages.numberInvalid;
    if (maxV === 'invalid') boundErrors.max = leadFieldMessages.numberInvalid;
    const minN = minV === 'invalid' ? null : minV;
    const maxN = maxV === 'invalid' ? null : maxV;

    if (!field) {
      const parsed = createLeadFieldRequestSchema.safeParse({
        label,
        type,
        required: type === 'boolean' ? false : required,
        ...(type === 'select' ? { options: options.map((o) => ({ label: o.label })) } : {}),
        ...(type === 'number' ? { min: minN, max: maxN } : {}),
      });
      const errs = {
        ...(parsed.success ? {} : issuesToErrors(parsed.error.issues)),
        ...boundErrors,
      };
      setErrors(errs);
      if (!parsed.success || Object.keys(boundErrors).length) return;
      create.mutate(parsed.data, {
        onSuccess: ({ field: saved }) => onSaved(saved.label, true),
        onError: fail,
      });
      return;
    }

    // Edit: send only what changed. The type never changes (it isn't sent at all).
    const body: UpdateLeadFieldRequest = {};
    if (label.trim() !== field.label) body.label = label;
    if (field.type !== 'boolean' && required !== field.required) body.required = required;
    if (field.type === 'select') {
      const before = field.options
        .filter((o) => !o.archivedAt)
        .map((o) => `${o.id}:${o.label}`)
        .join('|');
      const after = options.map((o) => `${o.id ?? ''}:${o.label.trim()}`).join('|');
      if (before !== after) {
        body.options = options.map((o) =>
          o.id ? { id: o.id, label: o.label } : { label: o.label },
        );
      }
    }
    if (field.type === 'number') {
      if (minN !== field.min) body.min = minN;
      if (maxN !== field.max) body.max = maxN;
    }
    const parsed = updateLeadFieldRequestSchema.safeParse(body);
    const errs = { ...(parsed.success ? {} : issuesToErrors(parsed.error.issues)), ...boundErrors };
    // A range check across an unchanged bound: the schema only sees what was sent.
    if (field.type === 'number' && minN !== null && maxN !== null && minN > maxN) {
      errs.min ??= leadFieldMessages.rangeInvalid;
    }
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) return;
    if (Object.keys(parsed.data).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { fieldId: field.id, body: parsed.data },
      { onSuccess: ({ field: saved }) => onSaved(saved.label, false), onError: fail },
    );
  };

  const optionsError = errors.options;

  return (
    <DialogShell
      open
      onOpenChange={(o) => !o && onClose()}
      title={field ? tr('עריכת שדה') : tr('שדה חדש')}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field
          label={tr('שם השדה')}
          required
          dir="auto"
          maxLength={LEAD_FIELD_LABEL_MAX}
          placeholder={tr('למשל: תאריך האירוע')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={errors.label}
        />
        {field ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">{tr('סוג השדה')}</span>
            <p className="text-sm text-ink">{leadFieldTypeLabel(field.type)}</p>
            <p className="text-xs text-ink-muted">{tr(leadFieldMessages.typeLocked)}</p>
          </div>
        ) : (
          <SelectMenu
            label={tr('סוג השדה')}
            required
            value={type}
            onChange={(v) => changeType(v as LeadFieldType)}
            options={LEAD_FIELD_TYPES.map((t) => ({ value: t, label: leadFieldTypeLabel(t) }))}
            hint={tr('אי אפשר לשנות את הסוג אחרי השמירה.')}
            error={errors.type}
          />
        )}

        {type === 'select' && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-ink">
              {tr('אפשרויות')}
              <span aria-hidden className="ms-0.5 text-danger-600">
                *
              </span>
            </legend>
            <ol className="flex flex-col gap-2">
              {options.map((o, i) => {
                const err = errors[`options.${i}.label`];
                const inputId = `${uid}-opt-${o.key}`;
                return (
                  <li key={o.key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <label htmlFor={inputId} className="sr-only">
                        {tr('אפשרות {0}', i + 1)}
                      </label>
                      <input
                        id={inputId}
                        dir="auto"
                        value={o.label}
                        maxLength={LEAD_FIELD_OPTION_LABEL_MAX}
                        placeholder={tr('אפשרות {0}', i + 1)}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${inputId}-error` : undefined}
                        onChange={(e) =>
                          setOptions((all) =>
                            all.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)),
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (i === options.length - 1 && options.length < LEAD_FIELD_OPTIONS_MAX)
                              addOption();
                          }
                        }}
                        className={cn(inputClasses(Boolean(err)), 'min-w-0 flex-1')}
                      />
                      <IconButton
                        label={tr('הזזת אפשרות {0} למעלה', i + 1)}
                        disabled={i === 0}
                        onClick={() => moveOption(i, -1)}
                      >
                        <ChevronUp aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={tr('הזזת אפשרות {0} למטה', i + 1)}
                        disabled={i === options.length - 1}
                        onClick={() => moveOption(i, 1)}
                      >
                        <ChevronDown aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label={tr('הסרת אפשרות {0}', i + 1)}
                        onClick={() => removeOption(o)}
                      >
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </IconButton>
                    </div>
                    {err && (
                      <p id={`${inputId}-error`} className="text-xs text-danger-600">
                        {tr(err)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            {optionsError && (
              <p role="alert" className="text-xs text-danger-600">
                {tr(optionsError)}
              </p>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={options.length >= LEAD_FIELD_OPTIONS_MAX}
              onClick={addOption}
            >
              <Plus aria-hidden className="h-4 w-4" />
              {tr('הוספת אפשרות')}
            </Button>
            {field && (
              <p className="text-xs text-ink-muted">
                {tr(
                  'אפשרות שמסירים עוברת לארכיון: לידים שכבר בחרו בה ימשיכו להציג אותה, ואי אפשר לבחור בה שוב.',
                )}
              </p>
            )}
            {removed.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-ink-muted">{tr('אפשרויות שהוסרו')}</h3>
                <ul className="flex min-w-0 flex-wrap gap-1.5">
                  {removed.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        disabled={options.length >= LEAD_FIELD_OPTIONS_MAX}
                        onClick={() => restoreOption(o)}
                        aria-label={tr('החזרת האפשרות {0}', o.label)}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-start text-xs text-ink-muted ring-1 ring-inset ring-surface-border hover:text-ink disabled:opacity-50"
                      >
                        <ArchiveRestore aria-hidden className="h-3.5 w-3.5 shrink-0" />
                        <bdi className="min-w-0 [overflow-wrap:anywhere]">{o.label}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>
        )}

        {type === 'number' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={tr('ערך מינימלי')}
              ltr
              inputMode="decimal"
              hint={tr('לא חובה')}
              value={min}
              onChange={(e) => setMin(e.target.value)}
              error={errors.min}
            />
            <Field
              label={tr('ערך מקסימלי')}
              ltr
              inputMode="decimal"
              hint={tr('לא חובה')}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              error={errors.max}
            />
          </div>
        )}

        {type !== 'boolean' ? (
          <div className="flex flex-col gap-1">
            <Checkbox
              label={tr('שדה חובה')}
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              error={errors.required}
            />
            <p className="ps-8 text-xs text-ink-muted">
              {tr(
                'חובה רק בטופס "ליד חדש" ובעריכה בכרטיס הליד. פניות מהאתר ומהערוצים, לידים מייבוא ולקוח שנוסף מהר ממסך הצעת המחיר יתקבלו גם בלי.',
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">{tr(leadFieldMessages.booleanNotRequired)}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr('ביטול')}
          </Button>
          <Button type="submit" loading={saving}>
            {field ? tr('שמירת השדה') : tr('הוספת השדה')}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
