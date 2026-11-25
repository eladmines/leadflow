import { formatIsraeliPhone } from '@simplecatch/shared';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { errorMessage } from '../auth/serverErrors';
import { useLeads } from '../leads/api';
import { NewLeadDialog } from '../leads/NewLeadDialog';
import { tr } from '../../i18n';

/**
 * The customer a new quote is for, chosen inside the quote form: type to search the business's
 * leads by name, phone or email, open the whole list with "All customers", or add a new customer.
 * Nothing is listed until one of those, so a new quote starts from an empty form. (A quote
 * belongs to a lead.)
 */
export function CustomerPicker({
  businessId,
  selected,
  onSelect,
  error,
}: {
  businessId: string;
  selected: { id: string; name: string } | null;
  onSelect: (lead: { id: string; name: string } | null) => void;
  error?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [newLead, setNewLead] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [listOpen]);
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const leads = useLeads(businessId, { q: q || undefined });

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
            <div className="relative min-w-0 flex-1">
              <input
                type="search"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls="customer-list"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  // Nothing is listed until something is typed (or "All customers" is pressed).
                  setListOpen(e.target.value.trim() !== '');
                }}
                onKeyDown={(e) => e.key === 'Escape' && setListOpen(false)}
                aria-label={tr('חיפוש לקוח')}
                placeholder={tr('הקלידו שם, טלפון או מייל')}
                className={`${inputClasses(Boolean(error))} w-full`}
              />
            </div>
            <Button
              variant="secondary"
              aria-expanded={listOpen}
              onClick={() => {
                setText('');
                setListOpen((o) => !o);
              }}
            >
              <ChevronDown aria-hidden className="h-4 w-4" />
              {tr('כל הלקוחות')}
            </Button>
            <Button variant="secondary" onClick={() => setNewLead(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              {tr('לקוח חדש')}
            </Button>
          </div>
          {listOpen && (
            <div
              id="customer-list"
              className="max-h-64 overflow-y-auto rounded-lg border border-surface-border bg-surface shadow-card"
            >
              {leads.isError ? (
                <Alert tone="danger">{errorMessage(leads.error)}</Alert>
              ) : leads.isPending ? (
                <div className="p-3">
                  <Spinner label={tr('טוענים…')} />
                </div>
              ) : leads.data.length === 0 ? (
                <p className="p-3 text-sm text-ink-muted">
                  {tr('לא נמצא לקוח. אפשר להוסיף לקוח חדש.')}
                </p>
              ) : (
                <ul aria-label={tr('לקוחות')} className="flex flex-col">
                  {leads.data.map((l) => (
                    <li key={l.id} className="border-t border-surface-border first:border-t-0">
                      <button
                        type="button"
                        onClick={() => {
                          onSelect({ id: l.id, name: l.contact.name });
                          setListOpen(false);
                          setText('');
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-muted"
                      >
                        <span className="truncate font-medium text-ink">{l.contact.name}</span>
                        <span className="shrink-0 text-xs text-ink-muted">
                          <bdi dir="ltr">
                            {l.contact.phone
                              ? formatIsraeliPhone(l.contact.phone)
                              : (l.contact.email ?? '')}
                          </bdi>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <NewLeadDialog
        open={newLead}
        onOpenChange={setNewLead}
        onCreated={(lead) => onSelect({ id: lead.id, name: lead.contact.name })}
      />
    </div>
  );
}
