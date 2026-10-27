import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { SITE_LIMITS } from '@leadflow/shared';
import { Button, Field, Textarea } from '../../components/ui';

export interface ItemField<T> {
  key: keyof T & string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}

const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';

/** Editable list of small records (services, prices, testimonials, FAQ). */
export function ItemsEditor<T extends Record<string, string>>({
  items,
  fields,
  onChange,
  newItem,
  itemName,
  addLabel,
}: {
  items: T[];
  fields: ItemField<T>[];
  onChange: (items: T[]) => void;
  newItem: () => T;
  /** Accessible name for item n (1-based), e.g. "שירות 2". */
  itemName: (n: number) => string;
  addLabel: string;
}) {
  const set = (i: number, patch: Partial<T>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-2xl border border-surface-border bg-surface-muted/60 p-3">
            <fieldset className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium text-ink">{itemName(i + 1)}</legend>
                <div className="flex items-center">
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`הזזת ${itemName(i + 1)} למעלה`}
                  >
                    <ArrowUp aria-hidden className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`הזזת ${itemName(i + 1)} למטה`}
                  >
                    <ArrowDown aria-hidden className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    onClick={() => onChange(items.filter((_, j) => j !== i))}
                    aria-label={`מחיקת ${itemName(i + 1)}`}
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {fields.map((f) =>
                f.multiline ? (
                  <Textarea
                    key={f.key}
                    label={f.label}
                    rows={2}
                    maxLength={f.maxLength ?? SITE_LIMITS.shortText}
                    placeholder={f.placeholder}
                    value={item[f.key]}
                    onChange={(e) => set(i, { [f.key]: e.target.value } as Partial<T>)}
                  />
                ) : (
                  <Field
                    key={f.key}
                    label={f.label}
                    maxLength={f.maxLength ?? SITE_LIMITS.title}
                    placeholder={f.placeholder}
                    value={item[f.key]}
                    onChange={(e) => set(i, { [f.key]: e.target.value } as Partial<T>)}
                  />
                ),
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      {items.length < SITE_LIMITS.items && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...items, newItem()])}
          className="self-start"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
