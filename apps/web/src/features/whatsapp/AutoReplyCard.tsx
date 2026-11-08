import {
  apiPaths,
  REPLY_MODES,
  replyModeLabels,
  replyStatusSchema,
  STATUS_VIDEOS_TOTAL_BYTES,
  MAX_STATUSES,
  type ReplyMode,
  type WhatsAppBotResponse,
} from '@leadflow/shared';
import { Plus, Trash2, Video, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Alert, Button, Field, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useBotSettings, useSetStatus, useStatusVideo, useUpdateBotSettings } from './api';
import { toRequest } from './BookingBotCard';

type Saved = WhatsAppBotResponse['settings'];
type DraftStatus = { id: string; label: string; text: string };

/** "{business}" in stored texts ↔ a readable tag while editing (like the bot's messages). */
export const businessTag = () => `[${tr('שם העסק')}]`;
export const toTag = (text: string) => text.replaceAll('{business}', businessTag());
export const toCode = (text: string) => text.replaceAll(businessTag(), '{business}');

export const modeHelp: Record<ReplyMode, string> = {
  off: 'הודעות נכנסות בלי שום מענה אוטומטי.',
  auto_reply:
    'כל לקוח שכותב מקבל הודעה קצרה אחת (לכל היותר פעם ב־12 שעות). כשסטטוס פעיל — נשלחת הודעת הסטטוס, עם הסרטון שלו אם יש.',
  booking: 'הבוט מציע ללקוחות זמנים פנויים וקובע תורים או בקשות לאירוע.',
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

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

/**
 * Automatic replies (D-123): what happens when a customer writes — nothing, a short general
 * reply (default), or the booking bot — plus the business's status ("at an event", …), switched
 * with one click and sent instead of the general reply, with an optional video.
 */
export function AutoReplyCard({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  // Kept here: the form below starts over from the saved settings after each save.
  const [justSaved, setJustSaved] = useState(false);
  if (bot.isPending) return null;
  if (bot.isError) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  return (
    <div className="flex flex-col gap-5">
      {!bot.data.connected && (
        <p className="text-sm text-ink-muted">
          {tr('המענה יתחיל לפעול אחרי חיבור מספר WhatsApp לעסק.')}
        </p>
      )}
      {/* The status is what the automatic reply sends; other modes don't use it (D-129). */}
      {bot.data.settings.mode === 'auto_reply' && (
        <StatusNow businessId={businessId} settings={bot.data.settings} />
      )}
      <ReplySettings
        key={settingsKey(bot.data.settings)}
        businessId={businessId}
        saved={bot.data.settings}
        justSaved={justSaved}
        onSaved={setJustSaved}
      />
    </div>
  );
}

/** Resets the form when the saved settings change (after a save or a video upload). */
const settingsKey = (s: Saved) =>
  JSON.stringify([s.mode, s.autoReplyText, s.statuses.map((x) => [x.id, x.label, x.text])]);

/** One click to switch the status; saved at once. */
function StatusNow({ businessId, settings }: { businessId: string; settings: Saved }) {
  const setStatus = useSetStatus(businessId);
  const [untilKey, setUntilKey] = useState<string>('none');
  const untilId = useId();
  const active = settings.activeStatus;
  const pick = (id: string | null) => {
    const until = untilOptions().find((o) => o.key === untilKey)?.until ?? null;
    setStatus.mutate({ id, until: id && until ? until.toISOString() : null });
  };
  const time = new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <section
      aria-labelledby={`${untilId}-title`}
      className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-muted p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${untilId}-title`} className="text-sm font-semibold text-ink">
          {tr('הסטטוס שלך עכשיו')}
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
        {[{ id: null, label: 'זמין', preset: true }, ...settings.statuses].map((s) => {
          const on = (active?.id ?? null) === s.id;
          return (
            <button
              key={s.id ?? 'none'}
              type="button"
              aria-pressed={on}
              disabled={setStatus.isPending}
              onClick={() => !on && pick(s.id)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                on
                  ? 'border-brand-600 bg-brand-600 font-medium text-white'
                  : 'border-surface-border bg-surface text-ink hover:border-brand-300',
              )}
            >
              {/* Ready-made names show in the app's language; the business's own as written. */}
              {s.id === null || s.preset ? tr(s.label) : s.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={untilId} className="text-ink-muted">
          {tr('לכמה זמן:')}
        </label>
        <select
          id={untilId}
          value={untilKey}
          onChange={(e) => setUntilKey(e.target.value)}
          className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-sm text-ink"
        >
          {untilOptions().map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {setStatus.isError && <Alert tone="danger">{errorMessage(setStatus.error)}</Alert>}
    </section>
  );
}

/** Mode, general message and statuses — a draft saved with "Save settings" (D-109). */
function ReplySettings({
  businessId,
  saved,
  justSaved,
  onSaved,
}: {
  businessId: string;
  saved: Saved;
  justSaved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const update = useUpdateBotSettings(businessId);
  const initial = {
    mode: saved.mode,
    text: toTag(saved.autoReplyText ?? saved.autoReplyDefault),
    statuses: saved.statuses.map((s) => ({ id: s.id, label: s.label, text: toTag(s.text) })),
  };
  const [mode, setMode] = useState<ReplyMode>(initial.mode);
  const [text, setText] = useState(initial.text);
  const [statuses, setStatuses] = useState<DraftStatus[]>(initial.statuses);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** The status whose fields are open (one at a time keeps the list short). */
  const [editing, setEditing] = useState<string | null>(null);
  const done = justSaved;
  const setDone = onSaved;
  const dirty = JSON.stringify({ mode, text, statuses }) !== JSON.stringify(initial);

  const save = () => {
    const next: Record<string, string> = {};
    statuses.forEach((s, i) => {
      const r = replyStatusSchema.safeParse({ ...s, text: toCode(s.text) });
      if (!r.success) {
        for (const issue of r.error.issues) next[`${i}.${String(issue.path[0])}`] = issue.message;
      }
    });
    if (!text.trim()) next.text = 'יש לכתוב את ההודעה';
    setErrors(next);
    if (Object.keys(next).length) return;
    const general = toCode(text.trim());
    update.mutate(
      {
        ...toRequest(saved),
        mode,
        enabled: mode === 'booking',
        autoReplyText: general === saved.autoReplyDefault ? null : general,
        statuses: statuses.map((s) => ({ ...s, text: toCode(s.text) })),
      },
      { onSuccess: () => setDone(true) },
    );
  };
  const edit = (i: number, patch: Partial<DraftStatus>) => {
    setDone(false);
    setStatuses((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">{tr('מה קורה כשלקוח כותב:')}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {REPLY_MODES.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="radio"
                name="reply-mode"
                checked={mode === m}
                aria-describedby="reply-mode-help"
                onChange={() => {
                  setDone(false);
                  setMode(m);
                }}
                className="h-4 w-4 accent-brand-600"
              />
              {tr(replyModeLabels[m])}
            </label>
          ))}
        </div>
        <p id="reply-mode-help" className="text-xs text-ink-muted">
          {tr(modeHelp[mode])}
        </p>
      </fieldset>

      {mode === 'auto_reply' && (
        <>
          <Textarea
            label={tr('ההודעה הכללית')}
            // Customer messages are in Hebrew whatever the app's language: direction by content.
            dir="auto"
            hint={tr('{0} מוחלף בשם העסק.', businessTag())}
            value={text}
            rows={3}
            error={errors.text}
            onChange={(e) => {
              setDone(false);
              setText(e.target.value);
            }}
          />
          <section className="flex flex-col gap-3" aria-labelledby="statuses-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="statuses-title" className="text-sm font-semibold text-ink">
                {tr('הסטטוסים שלך')}
              </h3>
              <span className="text-xs text-ink-muted">
                {tr(
                  'מקום לסרטונים: {0} מתוך {1}',
                  mb(saved.videoBytesUsed),
                  mb(STATUS_VIDEOS_TOTAL_BYTES),
                )}
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-surface-border rounded-xl border border-surface-border">
              {statuses.map((s, i) => {
                const stored = saved.statuses.find((x) => x.id === s.id);
                const open =
                  editing === s.id || Boolean(errors[`${i}.label`] || errors[`${i}.text`]);
                return (
                  <li key={s.id} className="flex flex-col gap-3 p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink" dir="auto">
                          {s.label || tr('סטטוס חדש')}
                        </p>
                        {!open && (
                          <p className="truncate text-xs text-ink-muted" dir="auto">
                            {s.text || tr('עוד אין הודעה')}
                          </p>
                        )}
                      </div>
                      {stored?.video && (
                        <span className="flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">
                          <Video aria-hidden className="h-3.5 w-3.5" />
                          {tr('סרטון')}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={open}
                        aria-label={tr('עריכת הסטטוס {0}', s.label || tr('חדש'))}
                        onClick={() => setEditing(open ? null : s.id)}
                      >
                        {open ? tr('סגירה') : tr('עריכה')}
                      </Button>
                      {!stored?.preset && (
                        <button
                          type="button"
                          aria-label={tr('מחיקת הסטטוס {0}', s.label || tr('חדש'))}
                          onClick={() => setStatuses((list) => list.filter((_, j) => j !== i))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-danger-50 hover:text-danger-600"
                        >
                          <Trash2 aria-hidden className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {open && (
                      <div className="flex flex-col gap-3">
                        <Field
                          label={tr('שם הסטטוס')}
                          dir="auto"
                          value={s.label}
                          maxLength={40}
                          error={errors[`${i}.label`]}
                          onChange={(e) => edit(i, { label: e.target.value })}
                        />
                        <Textarea
                          label={tr('ההודעה ללקוח')}
                          dir="auto"
                          value={s.text}
                          rows={2}
                          error={errors[`${i}.text`]}
                          onChange={(e) => edit(i, { text: e.target.value })}
                        />
                        <StatusVideo businessId={businessId} statusId={s.id} stored={stored} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {statuses.length < MAX_STATUSES && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => {
                  setDone(false);
                  const id = `c-${Date.now().toString(36)}`;
                  setStatuses((list) => [...list, { id, label: '', text: '' }]);
                  setEditing(id);
                }}
              >
                <Plus aria-hidden className="h-4 w-4" />
                {tr('הוספת סטטוס')}
              </Button>
            )}
          </section>
        </>
      )}

      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {done && !dirty && <Alert tone="success">{tr('ההגדרות נשמרו.')}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty} loading={update.isPending}>
          {tr('שמירת ההגדרות')}
        </Button>
        {dirty && (
          <>
            <span role="status" className="text-sm text-warning-600">
              {tr('יש שינויים שעוד לא נשמרו')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode(initial.mode);
                setText(initial.text);
                setStatuses(initial.statuses);
                setErrors({});
              }}
            >
              {tr('ביטול השינויים')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** A status's video: preview, replace or remove; added once the status is saved. */
function StatusVideo({
  businessId,
  statusId,
  stored,
}: {
  businessId: string;
  statusId: string;
  stored: Saved['statuses'][number] | undefined;
}) {
  const { upload, remove } = useStatusVideo(businessId);
  const input = useRef<HTMLInputElement>(null);
  if (!stored) {
    return <p className="text-xs text-ink-muted">{tr('אחרי השמירה אפשר להוסיף לסטטוס סרטון.')}</p>;
  }
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="flex flex-col gap-2">
      {stored.video ? (
        <div className="flex flex-wrap items-end gap-3">
          <video
            controls
            preload="metadata"
            src={`${apiPaths.whatsapp.statusVideo(businessId, statusId)}?s=${stored.video.sizeBytes}`}
            className="h-36 max-w-full rounded-lg bg-ink/90"
          />
          <div className="flex flex-col gap-1 text-xs text-ink-muted">
            <span>{tr('סרטון · {0}', mb(stored.video.sizeBytes))}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove.mutate(statusId)}
              className="inline-flex items-center gap-1 text-danger-600 hover:underline"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
              {tr('הסרת הסרטון')}
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="video/mp4"
          className="sr-only"
          aria-label={tr('סרטון לסטטוס')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate({ statusId, file });
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          loading={upload.isPending}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Video aria-hidden className="h-4 w-4" />
          {stored.video ? tr('החלפת הסרטון') : tr('הוספת סרטון')}
        </Button>
        <span className="text-xs text-ink-muted">
          {tr('MP4 עד 16MB. סרטון קצר נשלח מהר יותר.')}
        </span>
      </div>
      {(upload.isError || remove.isError) && (
        <Alert tone="danger">{errorMessage(upload.error ?? remove.error)}</Alert>
      )}
    </div>
  );
}
