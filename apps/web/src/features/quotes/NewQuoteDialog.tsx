import { businessWebPaths, formatIsraeliPhone } from '@simplecatch/shared';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, DialogShell, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { errorMessage } from '../auth/serverErrors';
import { useLeads } from '../leads/api';
import { NewLeadDialog } from '../leads/NewLeadDialog';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';

const SHOWN = 8;

/**
 * A quote belongs to a lead, so a new one starts by picking the lead (search by name, phone or
 * email) or adding a new customer; then the quote editor opens for it.
 */
export function NewQuoteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [newLead, setNewLead] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const leads = useLeads(business.id, { q: q || undefined });
  const toQuote = (leadId: string) => {
    onOpenChange(false);
    setText('');
    navigate(`${businessWebPaths.section(business.id, 'quotes')}/new?leadId=${leadId}`);
  };

  return (
    <>
      <DialogShell open={open && !newLead} onOpenChange={onOpenChange} title={tr('הצעת מחיר חדשה')}>
        <p className="text-sm text-ink-muted">{tr('בחרו את הלקוח שההצעה מיועדת לו.')}</p>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={tr('חיפוש לקוח')}
          placeholder={tr('חיפוש לפי שם, טלפון או מייל')}
          className={inputClasses(false)}
        />
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
                  onClick={() => toQuote(l.id)}
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
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setNewLead(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            {tr('לקוח חדש')}
          </Button>
        </div>
      </DialogShell>
      <NewLeadDialog
        open={open && newLead}
        onOpenChange={(o) => {
          setNewLead(o);
          if (!o) onOpenChange(false);
        }}
        onCreated={(lead) => toQuote(lead.id)}
      />
    </>
  );
}
