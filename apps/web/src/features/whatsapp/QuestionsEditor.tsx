import { botQuestionSchema, MAX_QUESTIONS, type BotQuestion } from '@simplecatch/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, EmojiTextarea } from '../../components/ui';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useUpdateBotSettings } from './api';
import { toRequest } from './BookingBotCard';
import type { WhatsAppBotResponse } from '@simplecatch/shared';

type Saved = WhatsAppBotResponse['settings'];

const newId = () => `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * "Your own questions": the editor under the questions step of the Automations flow (D-198). The bot
 * sends them one after another, waiting for each answer, and the team gets all the answers as a task
 * and a note on the lead.
 */
export function QuestionsForm({ businessId, saved }: { businessId: string; saved: Saved }) {
  const update = useUpdateBotSettings(businessId);
  const [items, setItems] = useState<BotQuestion[]>(
    saved.questions.length ? saved.questions : [{ id: newId(), text: '' }],
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);

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
    setDone(false);
    update.mutate({ ...toRequest(saved), questions: parsed }, { onSuccess: () => setDone(true) });
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
          <li key={q.id} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-center text-sm font-semibold text-ink-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <QuestionBox
                index={i}
                value={q.text}
                error={errors[i] ? tr(errors[i]!) : undefined}
                onChange={(text) =>
                  setItems((list) => list.map((x, j) => (j === i ? { ...x, text } : x)))
                }
              />
            </div>
            <div className="flex shrink-0 gap-1">
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
      <div className="flex flex-wrap items-center gap-2">
        <Button loading={update.isPending} onClick={save}>
          {tr('שמירת השאלות')}
        </Button>
        {done && (
          <p role="status" className="text-sm text-emerald-700">
            {tr('השאלות נשמרו.')}
          </p>
        )}
      </div>
    </div>
  );
}

/** One question's text box with its emoji picker. */
function QuestionBox({
  index,
  value,
  error,
  onChange,
}: {
  index: number;
  value: string;
  error?: string;
  onChange: (text: string) => void;
}) {
  return (
    <EmojiTextarea
      label={tr('שאלה {0}', String(index + 1))}
      dir="auto"
      rows={2}
      maxLength={300}
      value={value}
      error={error}
      onValueChange={onChange}
    />
  );
}
