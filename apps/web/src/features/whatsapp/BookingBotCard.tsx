import {
  BOT_PLACEHOLDERS,
  botPlaceholderLabels,
  BOT_TEXT_KEYS,
  botDefaultTexts,
  botTextLabels,
  botTextsSchema,
  fillBotText,
  type BotTextKey,
  type WhatsAppBotResponse,
  type WhatsAppBotSettings,
} from '@leadflow/shared';
import { Bot, RotateCcw } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Textarea } from '../../components/ui';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useBotSettings, useUpdateBotSettings } from './api';

/**
 * Booking bot settings (D-102): on/off, and whether WhatsApp bookings are confirmed straight away
 * or wait for the team's approval.
 */
export function BookingBotCard({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  const update = useUpdateBotSettings(businessId);
  // Shown at once; back to the saved settings if saving fails.
  const [draft, setDraft] = useState<WhatsAppBotSettings | null>(null);
  if (bot.isPending) return null;
  if (bot.isError) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  const settings = draft ?? bot.data.settings;
  const save = (patch: Partial<WhatsAppBotSettings>) => {
    const next = { ...settings, ...patch };
    setDraft(next);
    update.mutate(next, { onSettled: () => setDraft(null) });
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Bot aria-hidden className="h-5 w-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">{tr('בוט קביעת תורים')}</h2>
          <p className="text-sm text-ink-muted">
            {tr(
              'לקוח שמבקש תור בוואטסאפ (או מספר חדש שכותב בפעם הראשונה) בוחר שירות, יום ושעה פנויה מתוך רשימה, והתור נקבע ביומן. הבוט לא עונה למספרים פרטיים, ושותק בשיחה שמישהו מהצוות כתב בה או כשהלקוח ביקש לדבר עם הצוות.',
            )}
          </p>
        </div>
      </div>
      {!bot.data.connected && (
        <p className="text-sm text-ink-muted">
          {tr('הבוט יתחיל לענות אחרי חיבור מספר WhatsApp לעסק.')}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
          className="h-4 w-4 accent-brand-600"
        />
        {tr('הבוט פעיל')}
      </label>
      <fieldset disabled={!settings.enabled} className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-ink-muted">{tr('תורים שנקבעים בבוט:')}</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="bot-confirm"
            checked={settings.autoConfirm}
            onChange={() => save({ autoConfirm: true })}
            className="h-4 w-4 accent-brand-600"
          />
          {tr('מאושרים מיד')}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="bot-confirm"
            checked={!settings.autoConfirm}
            onChange={() => save({ autoConfirm: false })}
            className="h-4 w-4 accent-brand-600"
          />
          {tr('ממתינים לאישור שלכם (הזמן נשמר בינתיים)')}
        </label>
      </fieldset>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      <details className="rounded-lg border border-surface-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {tr('עריכת ההודעות של הבוט')}
        </summary>
        <BotTextsForm businessId={businessId} settings={bot.data.settings} />
      </details>
    </Card>
  );
}

type Saved = WhatsAppBotResponse['settings'];
const initialTexts = (saved: Saved) =>
  Object.fromEntries(BOT_TEXT_KEYS.map((k) => [k, saved.texts[k] ?? botDefaultTexts[k]])) as Record<
    BotTextKey,
    string
  >;

/** An example date for the preview: next week at 10:00. */
function exampleWhen() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const day = new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
  return `${day} בשעה 10:00`;
}

/**
 * The business's own wording for the bot's messages, with a live preview. Messages to customers
 * are Hebrew (D-100), so the boxes and previews are right-to-left in either app language.
 */
function BotTextsForm({ businessId, settings }: { businessId: string; settings: Saved }) {
  const business = useCurrentBusiness();
  const update = useUpdateBotSettings(businessId);
  const [texts, setTexts] = useState(() => initialTexts(settings));
  const [errors, setErrors] = useState<Partial<Record<BotTextKey, string>>>({});
  const [saved, setSaved] = useState(false);
  const boxes = useRef<Partial<Record<BotTextKey, HTMLTextAreaElement | null>>>({});
  const edit = (k: BotTextKey, value: string) => {
    setSaved(false);
    setTexts((t) => ({ ...t, [k]: value }));
  };
  /** Puts a placeholder where the cursor is (or at the end) and keeps typing after it. */
  const insert = (k: BotTextKey, token: string) => {
    const box = boxes.current[k];
    const at = box ? box.selectionStart : texts[k].length;
    const end = box ? box.selectionEnd : at;
    edit(k, texts[k].slice(0, at) + token + texts[k].slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const values = { business: business.name, service: 'תספורת נשים', when: exampleWhen() };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    // Unchanged defaults aren't stored, so later improvements to the defaults still reach them.
    const custom = Object.fromEntries(
      BOT_TEXT_KEYS.map((k) => [k, texts[k].trim() === botDefaultTexts[k] ? null : texts[k]]),
    );
    const parsed = botTextsSchema.safeParse(custom);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    update.mutate(
      { enabled: settings.enabled, autoConfirm: settings.autoConfirm, texts: parsed.data },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-5">
      <p className="text-xs text-ink-muted">
        {tr(
          'הלקוחות מקבלים את ההודעות בעברית. {business}, {service} ו־{time} יוחלפו בשם העסק, בשירות ובמועד שנבחרו. הכפתורים והרשימות נשארים קבועים.',
        )}
      </p>
      {BOT_TEXT_KEYS.map((k) => (
        <div key={k} className="flex flex-col gap-2">
          <Textarea
            label={tr(botTextLabels[k])}
            dir="rtl"
            lang="he"
            rows={3}
            ref={(el) => {
              boxes.current[k] = el;
            }}
            value={texts[k]}
            error={errors[k]}
            onChange={(e) => edit(k, e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span>{tr('הוספה:')}</span>
            {BOT_PLACEHOLDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insert(k, p)}
                aria-label={`${tr('הוספה:')} ${tr(botPlaceholderLabels[p])} (${tr(botTextLabels[k])})`}
                className="rounded-full border border-surface-border px-2 py-0.5 text-ink hover:bg-surface-sunken"
              >
                + {tr(botPlaceholderLabels[p])}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-ink-muted">{tr('כך הלקוח יראה את זה:')}</span>
              <p
                dir="rtl"
                lang="he"
                className="max-w-md whitespace-pre-line break-words rounded-2xl rounded-ee-sm bg-success-50 px-3 py-2 text-sm text-ink ring-1 ring-success-600/20"
              >
                {fillBotText(texts[k], values) || '—'}
              </p>
            </div>
            {texts[k] !== botDefaultTexts[k] && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => edit(k, botDefaultTexts[k])}
                aria-label={tr('החזרת ברירת המחדל: {0}', tr(botTextLabels[k]))}
              >
                <RotateCcw aria-hidden className="h-4 w-4" />
                {tr('ברירת מחדל')}
              </Button>
            )}
          </div>
        </div>
      ))}
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {saved && <Alert tone="success">{tr('ההודעות נשמרו.')}</Alert>}
      <div>
        <Button type="submit" loading={update.isPending}>
          {tr('שמירת ההודעות')}
        </Button>
      </div>
    </form>
  );
}
