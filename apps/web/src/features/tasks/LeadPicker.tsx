import { formatIsraeliPhone, type Lead } from '@leadflow/shared';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { useLeads } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';

export type PickedLead = Pick<Lead, 'id'> & { name: string };

/**
 * Links a task to a customer (their lead): type a name, phone or email and pick from the
 * matches. Optional. Employees only find their own leads, like everywhere else.
 */
export function LeadPicker({
  value,
  onChange,
  floating = false,
}: {
  value: PickedLead | null;
  onChange: (lead: PickedLead | null) => void;
  /** The matches float over what is below (for a form row), instead of pushing it down. */
  floating?: boolean;
}) {
  const business = useCurrentBusiness();
  const uid = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const results = useLeads(business.id, q ? { q } : {});
  const matches = q ? (results.data ?? []).slice(0, 6) : [];

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{tr('שיוך ללקוח')}</span>
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink">
          <span className="truncate" dir="auto">
            <bdi>{value.name}</bdi>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={tr('הסרת השיוך ללקוח')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={uid} className="text-sm font-medium text-ink">
        {tr('שיוך ללקוח (לא חובה)')}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        />
        <input
          id={uid}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr('חיפוש לפי שם, טלפון או אימייל')}
          autoComplete="off"
          className={cn(inputClasses(false), 'ps-9')}
        />
      </div>
      {q && (
        <ul
          aria-label={tr('לקוחות שנמצאו')}
          className={cn(
            'flex flex-col divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface',
            floating && 'absolute inset-x-0 top-full z-20 mt-1 shadow-lift',
          )}
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">
              {results.isFetching ? tr('מחפשים…') : tr('לא נמצאו לקוחות')}
            </li>
          ) : (
            matches.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ id: l.id, name: l.contact.name });
                    setText('');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-muted"
                >
                  <span className="truncate font-medium text-ink" dir="auto">
                    <bdi>{l.contact.name}</bdi>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    <bdi dir="ltr">
                      {l.contact.phone ? formatIsraeliPhone(l.contact.phone) : l.contact.email}
                    </bdi>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
