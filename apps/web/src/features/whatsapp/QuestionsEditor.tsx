import { botQuestionSchema, MAX_QUESTIONS, type BotQuestion } from '@simplecatch/shared';
import { ArrowDown, ArrowUp, ListOrdered, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, DialogShell, Textarea } from '../../components/ui';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useUpdateBotSettings } from './api';
import { toRequest } from './BookingBotCard';
import type { WhatsAppBotResponse } from '@simplecatch/shared';

type Saved = WhatsAppBotResponse['settings'];

const newId = () => `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * "Your own questions" for an event request: the bot sends them one after another, waiting for
 * each answer, and the team gets all the answers as a task and a note on the lead.
 */
export function QuestionsCard({ businessId, saved }: { businessId: string; saved: Saved }) {
  const [open, setOpen] = useState(false);
  const count = saved.questions.length;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-surface-border p-4">
      <div className="flex items-start gap-3">
        <ListOrdered aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-ink">{tr('השאלות שלכם ללקוח')}</h4>
          <p className="text-sm text-ink-muted">
            {count
              ? tr('הבוט שואל {0} שאלות, אחת אחרי השנייה, ומחכה לתשובה לפני הבאה.', String(count))
              : tr(
                  'כתבו רשימת שאלות משלכם (תאריך, שעה, מקום, מספר מוזמנים…). הבוט ישאל אותן אחת אחרי השנייה כשלקוח מבקש לקבוע. בלי רשימה, הבוט שואל את השאלות הרגילות.',
                )}
          </p>
        </div>
      </div>
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        {count ? tr('עריכת השאלות') : tr('הוספת שאלות')}
      </Button>
      <DialogShell open={open} onOpenChange={setOpen} title={tr('השאלות שלכם ללקוח')} wide>
        <QuestionsForm businessId={businessId} saved={saved} onDone={() => setOpen(false)} />
      </DialogShell>
    </div>
  );
}

function QuestionsForm({
  businessId,
  saved,
  onDone,
}: {
  businessId: string;
  saved: Saved;
  onDone: () => void;
}) {
  const update = useUpdateBotSettings(businessId);
  const [items, setItems] = useState<BotQuestion[]>(
    saved.questions.length ? saved.questions : [{ id: newId(), text: '' }],
  );
  const [errors, setErrors] = useState<Record<number, string>>({});

  const move = (i: number, by: -1 | 1) =>
    setItems((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });

  const save = () => {
    // Empty rows are dropped; the rest must be valid.
    const filled = items.filter((q) => q.text.trim());
    const found: Record<number, string> = {};
    const parsed: BotQuestion[] = [];
    filled.forEach((q, i) => {
      const r = botQuestionSchema.safeParse(q);
      if (r.success) parsed.push(r.data);
      else found[items.indexOf(q)] = r.error.issues[0]?.message ?? '';
      void i;
    });
    setErrors(found);
    if (Object.keys(found).length) return;
    update.mutate({ ...toRequest(saved), questions: parsed }, { onSuccess: onDone });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        {tr(
          'הבוט שולח שאלה אחת, מחכה לתשובת הלקוח, ואז שולח את הבאה. בסוף אתם מקבלים את כל התשובות במשימה ובהערה בכרטיס הליד.',
        )}
      </p>
      <ol className="flex flex-col gap-3">
        {items.map((q, i) => (
          <li key={q.id} className="flex items-start gap-2">
            <span className="mt-2 w-6 shrink-0 text-center text-sm font-semibold text-ink-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <Textarea
                label={tr('שאלה {0}', String(i + 1))}
                dir="auto"
                rows={2}
                maxLength={300}
                value={q.text}
                error={errors[i] ? tr(errors[i]!) : undefined}
                onChange={(e) =>
                  setItems((list) =>
                    list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                  )
                }
              />
            </div>
            <div className="mt-6 flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={tr('הזזה למעלה')}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp aria-hidden className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={tr('הזזה למטה')}
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={tr('מחיקת שאלה {0}', String(i + 1))}
                onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {items.length < MAX_QUESTIONS && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setItems((list) => [...list, { id: newId(), text: '' }])}
        >
          <Plus aria-hidden className="h-4 w-4" />
          {tr('שאלה נוספת')}
        </Button>
      )}
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button loading={update.isPending} onClick={save}>
          {tr('שמירת השאלות')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {tr('ביטול')}
        </Button>
      </div>
    </div>
  );
}
