import { formatIsraeliPhone } from '@simplecatch/shared';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { errorMessage } from '../auth/serverErrors';
import { useLeads } from '../leads/api';
import { NewLeadDialog } from '../leads/NewLeadDialog';
import { tr } from '../../i18n';

const SHOWN = 6;

/**
 * The customer a new quote is for, chosen inside the quote form: search the business's leads by
 * name, phone or email, or add a new customer. (A quote belongs to a lead.)
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
        <>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={tr('חיפוש לקוח')}
              placeholder={tr('חיפוש לפי שם, טלפון או מייל')}
              className={`${inputClasses(Boolean(error))} min-w-0 flex-1`}
            />
            <Button variant="secondary" onClick={() => setNewLead(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              {tr('לקוח חדש')}
            </Button>
          </div>
          {leads.isError ? (
            <Alert tone="danger">{errorMessage(leads.error)}</Alert>
          ) : leads.isPending ? (
            <Spinner label={tr('טוענים…')} />
          ) : leads.data.length === 0 ? (
            <p className="text-sm text-ink-muted">{tr('לא נמצא לקוח. אפשר להוסיף לקוח חדש.')}</p>
          ) : (
            <ul aria-label={tr('לקוחות')} className="flex flex-col gap-1">
              {leads.data.slice(0, SHOWN).map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onSelect({ id: l.id, name: l.contact.name })}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2 text-start text-sm hover:bg-surface-muted"
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
        </>
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
