import {
  replyStatusSchema,
  MAX_STATUSES,
  type ReplyMode,
  type WhatsAppBotResponse,
} from '@leadflow/shared';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, EmojiPicker, Field, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useBotSettings, useSetStatus, useUpdateBotSettings } from './api';
import { toRequest } from './BookingBotCard';
import { ConversationPreview } from './ConversationPreview';
import { useCurrentBusiness } from '../shell/CurrentBusiness';

type Saved = WhatsAppBotResponse['settings'];

/** "{business}" in stored texts ↔ a readable tag while editing (like the bot's messages). */
export const businessTag = () => `[${tr('שם העסק')}]`;
export const toTag = (text: string) => text.replaceAll('{business}', businessTag());
export const toCode = (text: string) => text.replaceAll(businessTag(), '{business}');

export const modeHelp: Record<ReplyMode, string> = {
  off: 'הודעות נכנסות בלי שום מענה אוטומטי.',
  auto_reply:
    'כל הודעה של לקוח מקבלת מענה קצר, והלקוח בוחר מתי נוח לדבר. כשסטטוס פעיל — נשלחת הודעת הסטטוס.',
  booking: 'לקוחות רואים זמנים פנויים וקובעים לבד תור או בקשה לאירוע.',
};

/** Until-when choices for a status, as a time from now (null = until I change it). */
function untilOptions(now = new Date()) {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  return [
    { key: 'none', label: tr('עד שאשנה'), until: null },
    { key: '1h', label: tr('לשעה'), until: new Date(now.getTime() + 3600_000) },
    { key: '3h', label: tr('ל־3 שעות'), until: new Date(now.getTime() + 3 * 3600_000) },
    { key: 'eod', label: tr('עד סוף היום'), until: endOfDay },
    { key: 'tomorrow', label: tr('עד מחר בבוקר'), until: tomorrow },
  ] as const;
}

/**
 * Automatic reply (D-123, simplified in D-146): one idea — pick your status, and see and edit the
 * message customers get now. "Available" sends the general message; any other status sends its
 * own. Picking a status is saved at once; a changed message gets a save button.
 */
export function AutoReplyCard({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  if (bot.isPending) return null;
  if (bot.isError) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  // Editable whether it's on or off: each mode keeps its own settings (D-147).
  return <StatusAndMessage businessId={businessId} saved={bot.data.settings} />;
}

function StatusAndMessage({ businessId, saved }: { businessId: string; saved: Saved }) {
  const business = useCurrentBusiness();
  const setStatus = useSetStatus(businessId);
  const update = useUpdateBotSettings(businessId);
  const [adding, setAdding] = useState(false);
  const uid = useId();
  const active = saved.activeStatus;
  const current = active ? saved.statuses.find((x) => x.id === active.id) : undefined;
  const label = (x: { id: string | null; label: string; preset?: boolean }) =>
    x.id === null || x.preset ? tr(x.label) : x.label;
  const time = new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  /** Saves the general message or one status's message, keeping everything else. */
  const saveMessage = (text: string, onDone: () => void) => {
    const code = toCode(text.trim());
    update.mutate(
      current
        ? {
            ...toRequest(saved),
            statuses: saved.statuses.map((x) => (x.id === current.id ? { ...x, text: code } : x)),
          }
        : {
            ...toRequest(saved),
            autoReplyText: code === saved.autoReplyDefault ? null : code,
          },
      { onSuccess: onDone },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby={`${uid}-status`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`${uid}-status`} className="text-sm font-semibold text-ink">
            {tr('הסטטוס שלך')}
          </h3>
          <p role="status" className="text-sm text-ink-muted">
            {active
              ? active.until
                ? tr('פעיל עד {0}', time.format(new Date(active.until)))
                : tr('פעיל עד שתשנו')
              : tr('זמין — נשלח המענה הכללי')}
          </p>
        </div>
        <div role="group" aria-label={tr('בחירת סטטוס')} className="flex flex-wrap gap-2">
          {[{ id: null, label: 'זמין', preset: true }, ...saved.statuses].map((x) => {
            const on = (active?.id ?? null) === x.id;
            return (
              <button
                key={x.id ?? 'none'}
                type="button"
                aria-pressed={on}
                disabled={setStatus.isPending}
                onClick={() => !on && setStatus.mutate({ id: x.id, until: null })}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                  on
                    ? 'border-brand-600 bg-brand-600 font-medium text-white'
                    : 'border-surface-border bg-surface text-ink hover:border-brand-300',
                )}
              >
                {label(x)}
              </button>
            );
          })}
          {saved.statuses.length < MAX_STATUSES && (
            <button
              type="button"
              aria-expanded={adding}
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-surface-border px-3.5 py-1.5 text-sm text-ink-muted hover:border-brand-300 hover:text-ink"
            >
              <Plus aria-hidden className="h-4 w-4" />
              {tr('סטטוס חדש')}
            </button>
          )}
        </div>
        {/* How long matters only once you're away. */}
        {active && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor={`${uid}-until`} className="text-ink-muted">
              {tr('לכמה זמן:')}
            </label>
            <select
              id={`${uid}-until`}
              defaultValue="none"
              onChange={(e) => {
                const until = untilOptions().find((o) => o.key === e.target.value)?.until;
                setStatus.mutate({ id: active.id, until: until ? until.toISOString() : null });
              }}
              className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-sm text-ink"
            >
              {untilOptions().map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {setStatus.isError && <Alert tone="danger">{errorMessage(setStatus.error)}</Alert>}
      </section>

      {adding && (
        <NewStatus
          saving={update.isPending}
          onCancel={() => setAdding(false)}
          onAdd={(status) =>
            update.mutate(
              { ...toRequest(saved), statuses: [...saved.statuses, status] },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      )}

      <Message
        key={`${current?.id ?? ''}|${current?.text ?? saved.autoReplyText ?? ''}`}
        label={
          current
            ? tr('מה לקוחות מקבלים כשאתם "{0}"', label(current))
            : tr('מה לקוחות מקבלים עכשיו')
        }
        initial={toTag(current ? current.text : (saved.autoReplyText ?? saved.autoReplyDefault))}
        saving={update.isPending}
        onSave={saveMessage}
        preview={(text) => (
          <ConversationPreview
            businessId={businessId}
            saved={saved}
            message={toCode(text).replaceAll('{business}', business.name)}
          />
        )}
      />
      <p className="-mt-3 text-xs text-ink-muted">
        {tr(
          'מתחת להודעה הלקוח בוחר שעה לשיחה (היום או מחר, בין 09:00 ל־20:00) או זמן אחר. שעה שנבחרה נכנסת ליומן התורים, ואתם מקבלים משימה לחזור אליו.',
        )}
      </p>

      {current && !current.preset && (
        <button
          type="button"
          onClick={() =>
            update.mutate({
              ...toRequest(saved),
              statuses: saved.statuses.filter((x) => x.id !== current.id),
            })
          }
          className="inline-flex items-center gap-1 self-start text-sm text-danger-600 hover:underline"
        >
          <Trash2 aria-hidden className="h-4 w-4" />
          {tr('מחיקת הסטטוס {0}', current.label)}
        </button>
      )}
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
    </div>
  );
}

/** The message customers get now; "Save" appears once it's changed. */
function Message({
  label,
  initial,
  saving,
  onSave,
  preview,
}: {
  label: string;
  initial: string;
  saving: boolean;
  onSave: (text: string, onDone: () => void) => void;
  /** The whole conversation with this message, as the customer sees it (D-172). */
  preview: (text: string) => ReactNode;
}) {
  const [text, setText] = useState(initial);
  const [previewing, setPreviewing] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = text !== initial;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={box}
        label={label}
        // Customer messages follow the business's language: direction by content.
        dir="auto"
        hint={tr('{0} מוחלף בשם העסק.', businessTag())}
        value={text}
        rows={3}
        error={error ?? undefined}
        onChange={(e) => {
          setSaved(false);
          setText(e.target.value);
        }}
      />
      <EmojiPicker
        target={box}
        value={text}
        onInsert={(next) => {
          setSaved(false);
          setText(next);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {dirty && (
          <>
            <Button
              size="sm"
              loading={saving}
              onClick={() => {
                if (!text.trim()) return setError(tr('יש לכתוב את ההודעה'));
                setError(null);
                onSave(text, () => setSaved(true));
              }}
            >
              {tr('שמירת ההודעה')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setText(initial)}>
              {tr('ביטול השינויים')}
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={previewing}
          onClick={() => setPreviewing((v) => !v)}
        >
          <Eye aria-hidden className="h-4 w-4" />
          {previewing ? tr('הסתרת התצוגה המקדימה') : tr('תצוגה מקדימה')}
        </Button>
        {!dirty && saved && (
          <p role="status" className="text-sm text-emerald-700">
            {tr('ההודעה נשמרה.')}
          </p>
        )}
      </div>
      {previewing && preview(text)}
    </div>
  );
}

/** "+ New status": a name and its message. */
function NewStatus({
  saving,
  onAdd,
  onCancel,
}: {
  saving: boolean;
  onAdd: (status: { id: string; label: string; text: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = () => {
    const status = { id: `c-${Date.now().toString(36)}`, label: name, text: toCode(text) };
    const r = replyStatusSchema.safeParse(status);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    onAdd(r.data);
  };
  return (
    <section
      aria-label={tr('סטטוס חדש')}
      className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-muted p-4"
    >
      <Field
        label={tr('שם הסטטוס')}
        dir="auto"
        value={name}
        maxLength={40}
        error={errors.label ? tr(errors.label) : undefined}
        onChange={(e) => setName(e.target.value)}
      />
      <Textarea
        label={tr('ההודעה ללקוח')}
        dir="auto"
        value={text}
        rows={2}
        error={errors.text ? tr(errors.text) : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={saving} onClick={add}>
          {tr('הוספה')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {tr('ביטול')}
        </Button>
      </div>
    </section>
  );
}
