import { formatIsraeliPhone, type Lead } from '@simplecatch/shared';
import { Plus, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DialogShell, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { errorMessage } from '../auth/serverErrors';
import { useLeads } from '../leads/api';
import { NewLeadDialog } from '../leads/NewLeadDialog';
import { tr } from '../../i18n';

type Picked = { id: string; name: string };

const useDebounced = (value: string, ms = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
};

/** Customers as rows of a fixed height, so a scroller can be sized to a number of rows. */
function Rows({ leads, onPick }: { leads: Lead[]; onPick: (lead: Picked) => void }) {
  return (
    <ul aria-label={tr('לקוחות')} className="flex flex-col">
      {leads.map((l) => (
        <li key={l.id} className="border-t border-surface-border first:border-t-0">
          <button
            type="button"
            onClick={() => onPick({ id: l.id, name: l.contact.name })}
            className="flex h-10 w-full items-center justify-between gap-3 px-3 text-start text-sm hover:bg-surface-muted"
          >
            <span className="truncate font-medium text-ink">{l.contact.name}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              <bdi dir="ltr">
                {l.contact.phone ? formatIsraeliPhone(l.contact.phone) : (l.contact.email ?? '')}
              </bdi>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Results({
  state,
  onPick,
}: {
  state: ReturnType<typeof useLeads>;
  onPick: (lead: Picked) => void;
}) {
  if (state.isError) return <Alert tone="danger">{errorMessage(state.error)}</Alert>;
  if (state.isPending)
    return (
      <div className="p-3">
        <Spinner label={tr('טוענים…')} />
      </div>
    );
  if (state.data.length === 0)
    return (
      <p className="p-3 text-sm text-ink-muted">{tr('לא נמצא לקוח. אפשר להוסיף לקוח חדש.')}</p>
    );
  return <Rows leads={state.data} onPick={onPick} />;
}

/** The window's content: mounted only while it is open, so the list is fetched when asked for. */
function AllList({ businessId, onPick }: { businessId: string; onPick: (lead: Picked) => void }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const leads = useLeads(businessId, { q: q || undefined });
  return (
    <>
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={tr('חיפוש ברשימת הלקוחות')}
        placeholder={tr('הקלידו שם, טלפון או מייל')}
        className={`${inputClasses(false)} w-full`}
      />
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-surface-border">
        <Results state={leads} onPick={onPick} />
      </div>
    </>
  );
}

/** Typing in the field: a list of five rows that scrolls (h-10 per row). */
function Suggestions({
  businessId,
  q,
  onPick,
}: {
  businessId: string;
  q: string;
  onPick: (lead: Picked) => void;
}) {
  const leads = useLeads(businessId, { q });
  return (
    <div className="max-h-[12.5rem] overflow-y-auto rounded-lg border border-surface-border bg-surface shadow-card">
      <Results state={leads} onPick={onPick} />
    </div>
  );
}

/**
 * The customer a new quote is for, chosen inside the quote form: type to search (a list of five
 * rows that scrolls), open every customer in a window with "All customers", or add a new one.
 * Nothing is listed until one of those. (A quote belongs to a lead.)
 */
export function CustomerPicker({
  businessId,
  selected,
  onSelect,
  error,
}: {
  businessId: string;
  selected: Picked | null;
  onSelect: (lead: Picked | null) => void;
  error?: string;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const [listOpen, setListOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [newLead, setNewLead] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [listOpen]);

  const pick = (lead: Picked) => {
    onSelect(lead);
    setListOpen(false);
    setAll(false);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{tr('לקוח')}</span>
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface-muted px-3 py-2">
          <span className="truncate text-sm font-medium text-ink">{selected.name}</span>
          <Button variant="ghost" onClick={() => onSelect(null)}>
            {tr('החלפה')}
          </Button>
        </div>
      ) : (
        <div ref={box} className="relative flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Nothing is listed until something is typed.
                setListOpen(e.target.value.trim() !== '');
              }}
              onKeyDown={(e) => e.key === 'Escape' && setListOpen(false)}
              aria-label={tr('חיפוש לקוח')}
              placeholder={tr('הקלידו שם, טלפון או מייל')}
              className={`${inputClasses(Boolean(error))} min-w-0 flex-1`}
            />
            <Button variant="secondary" onClick={() => setAll(true)}>
              <Users aria-hidden className="h-4 w-4" />
              {tr('כל הלקוחות')}
            </Button>
            <Button variant="secondary" onClick={() => setNewLead(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              {tr('לקוח חדש')}
            </Button>
          </div>
          {listOpen && q !== '' && <Suggestions businessId={businessId} q={q} onPick={pick} />}
        </div>
      )}
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <DialogShell open={all} onOpenChange={setAll} title={tr('כל הלקוחות')}>
        <AllList businessId={businessId} onPick={pick} />
      </DialogShell>
      <NewLeadDialog
        open={newLead}
        onOpenChange={setNewLead}
        onCreated={(lead) => pick({ id: lead.id, name: lead.contact.name })}
      />
    </div>
  );
}
