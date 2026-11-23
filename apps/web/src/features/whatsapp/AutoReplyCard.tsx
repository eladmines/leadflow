import {
  dateInZone,
  MAX_STATUSES,
  nextDate,
  replyStatusSchema,
  zonedTimeToUtc,
  type WhatsAppBotResponse,
} from '@simplecatch/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Alert, Button, DialogShell, EmojiTextarea, Field } from '../../components/ui';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useBotSettings, useSetStatus, useUpdateBotSettings } from './api';
import { toRequest } from './BookingBotCard';
import { useCurrentBusiness } from '../shell/CurrentBusiness';

type Saved = WhatsAppBotResponse['settings'];

/**
 * "{business}" in stored texts ↔ the business's real name while editing: the owner writes the
 * name like any other word. On saving, the name (or an older "[שם העסק]" tag) goes back to
 * `{business}`, so a renamed business keeps its messages right.
 */
const toTag = (text: string, name: string) => text.replaceAll('{business}', name);
const toCode = (text: string, name: string) => {
  const t = text.replaceAll('[שם העסק]', '{business}').replaceAll('[Business name]', '{business}');
  return name.trim().length >= 2 ? t.replaceAll(name.trim(), '{business}') : t;
};

/**
 * Until-when choices for a status, as a time from now (null = until I change it). "End of the day" and
 * "tomorrow morning" are the business's own day (its time zone), not the browser's: an owner abroad
 * still means the day the business is open (D-199).
 */
export function untilOptions(timeZone: string, now = new Date()) {
  const today = dateInZone(now, timeZone);
  return [
    { key: 'none', label: tr('עד שאשנה'), until: null },
    { key: '1h', label: tr('לשעה'), until: new Date(now.getTime() + 3600_000) },
    { key: '3h', label: tr('ל־3 שעות'), until: new Date(now.getTime() + 3 * 3600_000) },
    { key: 'eod', label: tr('עד סוף היום'), until: zonedTimeToUtc(today, '23:59', timeZone) },
    {
      key: 'tomorrow',
      label: tr('עד מחר בבוקר'),
      until: zonedTimeToUtc(nextDate(today), '08:00', timeZone),
    },
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
  // Shown in the business's time zone, the one the end times are counted in (D-199).
  const time = new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: business.timezone,
  });

  /** Saves the general message or one status's message, keeping everything else. */
  const saveMessage = (text: string, onDone: () => void) => {
    const code = toCode(text.trim(), business.name);
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
            {active ? (
              active.until ? (
                <>
                  {tr('פעיל עד {0}', time.format(new Date(active.until)))}{' '}
                  <span className="font-semibold text-ink">{tr('(לפי שעון העסק)')}</span>
                </>
              ) : (
                tr('פעיל עד שתשנו')
              )
            ) : (
              tr('זמין — נשלח המענה הכללי')
            )}
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
              aria-haspopup="dialog"
              onClick={() => setAdding(true)}
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
                const until = untilOptions(business.timezone).find(
                  (o) => o.key === e.target.value,
                )?.until;
                setStatus.mutate({ id: active.id, until: until ? until.toISOString() : null });
              }}
              className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-sm text-ink"
            >
              {untilOptions(business.timezone).map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="w-full text-xs text-ink-muted">
              {tr(
                '"סוף היום" ו"מחר בבוקר" לפי שעון העסק ({0}), לא לפי המכשיר שלכם.',
                business.timezone,
              )}
            </span>
          </div>
        )}
        {setStatus.isError && <Alert tone="danger">{errorMessage(setStatus.error)}</Alert>}
      </section>

      <DialogShell open={adding} onOpenChange={setAdding} title={tr('סטטוס חדש')}>
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
      </DialogShell>

      <Message
        key={`${current?.id ?? ''}|${current?.text ?? saved.autoReplyText ?? ''}`}
        label={
          current
            ? tr('מה לקוחות מקבלים כשאתם "{0}"', label(current))
            : tr('מה לקוחות מקבלים עכשיו')
        }
        initial={toTag(
          current ? current.text : (saved.autoReplyText ?? saved.autoReplyDefault),
          business.name,
        )}
        saving={update.isPending}
        onSave={saveMessage}
      />
      <p className="-mt-3 text-xs text-ink-muted">
        {tr(
          'מתחת להודעה הלקוח בוחר שעה לשיחה (היום או מחר, בין 09:00 ל־20:00) או זמן אחר. שעה שנבחרה נכנסת ליומן, ואתם מקבלים משימה לחזור אליו.',
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
}: {
  label: string;
  initial: string;
  saving: boolean;
  onSave: (text: string, onDone: () => void) => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = text !== initial;
  return (
    <div className="flex flex-col gap-2">
      <EmojiTextarea
        label={label}
        // Customer messages follow the business's language: direction by content.
        dir="auto"
        value={text}
        rows={3}
        error={error ?? undefined}
        onValueChange={(next) => {
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
        {!dirty && saved && (
          <p role="status" className="text-sm text-emerald-700">
            {tr('ההודעה נשמרה.')}
          </p>
        )}
      </div>
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
  const business = useCurrentBusiness();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = () => {
    const status = {
      id: `c-${Date.now().toString(36)}`,
      label: name,
      text: toCode(text, business.name),
    };
    const r = replyStatusSchema.safeParse(status);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    onAdd(r.data);
  };
  return (
    <div className="flex flex-col gap-3">
      <Field
        label={tr('שם הסטטוס')}
        dir="auto"
        value={name}
        maxLength={40}
        error={errors.label ? tr(errors.label) : undefined}
        onChange={(e) => setName(e.target.value)}
      />
      <EmojiTextarea
        label={tr('ההודעה ללקוח')}
        dir="auto"
        value={text}
        rows={2}
        error={errors.text ? tr(errors.text) : undefined}
        onValueChange={setText}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={saving} onClick={add}>
          {tr('הוספה')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {tr('ביטול')}
        </Button>
      </div>
    </div>
  );
}
