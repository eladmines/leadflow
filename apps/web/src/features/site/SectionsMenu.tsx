import {
  SECTION_TYPES,
  sectionTypeLabels,
  SITE_LIMITS,
  type Section,
  type SectionType,
} from '@leadflow/shared';
import { EyeOff, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A small dropdown above the preview (closes on outside click or Escape). */
function Dropdown({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink hover:bg-surface-sunken disabled:opacity-50"
      >
        {icon}
        {label}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-surface-border bg-surface p-1.5 shadow-lift">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * Desktop tools above the preview (D-084): add a section to the page (also on an empty page),
 * and show hidden sections again — what used to need the side panel.
 */
export function SectionsMenu({
  sections,
  onAdd,
  onShow,
}: {
  sections: Section[];
  onAdd: (type: SectionType) => void;
  onShow: (id: string) => void;
}) {
  const hidden = sections.filter((s) => !s.visible);
  const item =
    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-sm text-ink hover:bg-surface-sunken';
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Dropdown
        label="הוספת מקטע"
        icon={<Plus aria-hidden className="h-4 w-4" />}
        disabled={sections.length >= SITE_LIMITS.sections}
      >
        {(close) => (
          <ul aria-label="הוספת מקטע לעמוד" className="grid grid-cols-2 gap-0.5">
            {SECTION_TYPES.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    onAdd(t);
                    close();
                  }}
                >
                  {sectionTypeLabels[t]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dropdown>
      {hidden.length > 0 && (
        <Dropdown
          label={`מוסתרים (${hidden.length})`}
          icon={<EyeOff aria-hidden className="h-4 w-4" />}
        >
          {(close) => (
            <ul aria-label="מקטעים מוסתרים" className="flex flex-col gap-0.5">
              {hidden.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={cn(item)}
                    aria-label={`הצגת ${sectionTypeLabels[s.type]}`}
                    onClick={() => {
                      onShow(s.id);
                      if (hidden.length === 1) close();
                    }}
                  >
                    <span className="truncate">
                      {sectionTypeLabels[s.type]}
                      <span className="text-ink-muted"> · {s.title || 'ללא כותרת'}</span>
                    </span>
                    <span className="text-xs text-brand-700">הצגה</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dropdown>
      )}
    </div>
  );
}
