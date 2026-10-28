import {
  PALETTES,
  sectionTypeLabels,
  type PaletteKey,
  type Section,
  type SectionStyle,
} from '@leadflow/shared';
import { ArrowDown, ArrowUp, Copy, EyeOff, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { SectionForm } from './SectionForm';

type Option<T extends string> = { value: T; label: string };

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-lg bg-surface-sunken p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-xs',
              value === o.value ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-muted',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Title colour and size: shared by the section window and the text toolbar (D-082). */
export const titleColorOptions: Option<NonNullable<SectionStyle['titleColor']>>[] = [
  { value: 'ink', label: 'רגיל' },
  { value: 'brand', label: 'צבע המותג' },
  { value: 'accent', label: 'הדגשה' },
];
export const titleSizeOptions: Option<NonNullable<SectionStyle['titleSize']>>[] = [
  { value: 'normal', label: 'רגילה' },
  { value: 'large', label: 'גדולה' },
];
export const buttonStyleOptions: Option<NonNullable<SectionStyle['button']>>[] = [
  { value: 'solid', label: 'מלא' },
  { value: 'outline', label: 'מתאר' },
];

/**
 * The window that opens next to a clicked section (D-082): its look (from the site palette),
 * its settings, and actions. Texts are still typed on the page itself.
 */
export function SectionInspector({
  section: s,
  palette,
  index,
  count,
  onChange,
  onMove,
  onHide,
  onDuplicate,
  onDelete,
  onClose,
}: {
  section: Section;
  palette: PaletteKey;
  index: number;
  count: number;
  onChange: (patch: Partial<Section>) => void;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const st = s.style ?? {};
  const setStyle = (patch: SectionStyle) =>
    onChange({ style: { ...st, ...patch } } as Partial<Section>);
  const p = PALETTES[palette];
  const hasButton = s.type === 'hero' || s.type === 'cta';
  const swatches: { value: NonNullable<SectionStyle['bg']>; label: string; color: string }[] = [
    {
      value: 'auto',
      label: 'אוטומטי',
      color: 'linear-gradient(135deg,#fff 50%,' + p.soft + ' 50%)',
    },
    { value: 'white', label: 'לבן', color: '#fff' },
    { value: 'soft', label: 'רך', color: p.soft },
    { value: 'brand', label: 'צבע המותג', color: p.primary },
    { value: 'dark', label: 'כהה', color: '#14181f' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{sectionTypeLabels[s.type]}</h2>
        <button
          type="button"
          aria-label="סגירה"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <Group title="מראה">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">רקע</span>
          <div role="group" aria-label="רקע" className="flex gap-1.5">
            {swatches.map((w) => (
              <button
                key={w.value}
                type="button"
                title={w.label}
                aria-label={w.label}
                aria-pressed={(st.bg ?? 'auto') === w.value}
                onClick={() => setStyle({ bg: w.value })}
                className={cn(
                  'h-8 w-8 rounded-full border border-surface-border transition-shadow',
                  (st.bg ?? 'auto') === w.value && 'ring-2 ring-brand-500 ring-offset-2',
                )}
                style={{ background: w.color }}
              />
            ))}
          </div>
        </div>
        <Segmented
          label="יישור"
          value={st.align ?? 'start'}
          options={[
            { value: 'start', label: 'לימין' },
            { value: 'center', label: 'למרכז' },
          ]}
          onChange={(align) => setStyle({ align })}
        />
        <Segmented
          label="מרווחים"
          value={st.spacing ?? 'normal'}
          options={[
            { value: 'compact', label: 'צפוף' },
            { value: 'normal', label: 'רגיל' },
            { value: 'airy', label: 'מרווח' },
          ]}
          onChange={(spacing) => setStyle({ spacing })}
        />
        <Segmented
          label="צבע הכותרת"
          value={st.titleColor ?? 'ink'}
          options={titleColorOptions}
          onChange={(titleColor) => setStyle({ titleColor })}
        />
        <Segmented
          label="גודל הכותרת"
          value={st.titleSize ?? 'normal'}
          options={titleSizeOptions}
          onChange={(titleSize) => setStyle({ titleSize })}
        />
        {hasButton && (
          <Segmented
            label="סגנון הכפתור"
            value={st.button ?? 'solid'}
            options={buttonStyleOptions}
            onChange={(button) => setStyle({ button })}
          />
        )}
      </Group>

      <Group title="הגדרות">
        <SectionForm section={s} onChange={onChange} />
      </Group>

      <div className="flex flex-wrap items-center gap-1 border-t border-surface-border pt-3">
        <IconAction label="הזזה למעלה" disabled={index <= 0} onClick={() => onMove(-1)}>
          <ArrowUp aria-hidden className="h-4 w-4" />
        </IconAction>
        <IconAction label="הזזה למטה" disabled={index >= count - 1} onClick={() => onMove(1)}>
          <ArrowDown aria-hidden className="h-4 w-4" />
        </IconAction>
        <IconAction label="הסתרה" onClick={onHide}>
          <EyeOff aria-hidden className="h-4 w-4" />
        </IconAction>
        <IconAction label="שכפול" onClick={onDuplicate}>
          <Copy aria-hidden className="h-4 w-4" />
        </IconAction>
        <span className="ms-auto">
          {confirm ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="danger" onClick={onDelete}>
                מחיקה
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                ביטול
              </Button>
            </span>
          ) : (
            <IconAction label="מחיקת המקטע" onClick={() => setConfirm(true)}>
              <Trash2 aria-hidden className="h-4 w-4 text-danger-600" />
            </IconAction>
          )}
        </span>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{title}</h3>
      {children}
    </section>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}
