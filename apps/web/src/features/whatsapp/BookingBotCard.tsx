import {
  BOT_PLACEHOLDERS,
  botShowcaseSchema,
  SHOWCASE_MAX_IMAGES,
  botPlaceholderLabels,
  BOT_FLOWS,
  BOT_TEXT_KEYS,
  botFlowLabels,
  botTextKeysFor,
  type BotFlow,
  botTextLabels,
  botTextsSchema,
  fillBotText,
  type BotTextKey,
  type WhatsAppBotResponse,
  type WhatsAppBotSettings,
} from '@leadflow/shared';
import { ImagePlus, RotateCcw, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Textarea } from '../../components/ui';
import { useAssets } from '../media/api';
import { MediaPicker } from '../media/MediaPicker';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useBotSettings, useUpdateBotSettings } from './api';

/**
 * Booking bot settings (D-102): on/off, how customers book, and whether bookings are confirmed
 * straight away or wait for the team's approval — saved together with "Save settings".
 */
export function BookingBotCard({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  const update = useUpdateBotSettings(businessId);
  // Changes wait here until "Save settings" (D-109).
  const [draft, setDraft] = useState<{
    autoConfirm: boolean;
    holdDate: boolean;
    flow: BotFlow;
    /** The owner picked a flow (otherwise it keeps following the industry). */
    flowChosen: boolean;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  if (bot.isPending) return null;
  if (bot.isError) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  const stored = bot.data.settings;
  // Its settings matter only when the booking bot is the reply mode (D-123).
  if (stored.mode !== 'booking') return null;
  const settings = { ...stored, ...draft };
  const dirty =
    draft !== null &&
    (draft.autoConfirm !== stored.autoConfirm ||
      draft.holdDate !== stored.holdDate ||
      draft.flow !== stored.flow);
  const change = (patch: { autoConfirm: boolean } | { holdDate: boolean } | { flow: BotFlow }) => {
    setSaved(false);
    setDraft({
      autoConfirm: settings.autoConfirm,
      holdDate: settings.holdDate,
      flow: settings.flow,
      flowChosen: (draft?.flowChosen ?? false) || 'flow' in patch,
      ...patch,
    });
  };
  const saveSettings = () => {
    if (!draft) return;
    update.mutate(
      {
        ...toRequest(stored),
        autoConfirm: draft.autoConfirm,
        holdDate: draft.holdDate,
        flow: draft.flowChosen ? draft.flow : toRequest(stored).flow,
      },
      {
        onSuccess: () => {
          setDraft(null);
          setSaved(true);
        },
      },
    );
  };
  const industryFlow = bot.data.settings.flowIsDefault ? bot.data.settings.flow : null;

  return (
    <section
      aria-labelledby="bot-settings-title"
      className="flex flex-col gap-3 border-t border-surface-border pt-5"
    >
      <h3 id="bot-settings-title" className="text-sm font-semibold text-ink">
        {tr('הגדרות הבוט')}
      </h3>
      <fieldset disabled={!settings.enabled} className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-ink-muted">{tr('איך לקוחות מזמינים:')}</legend>
        {BOT_FLOWS.map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="bot-flow"
              checked={settings.flow === f}
              onChange={() => change({ flow: f })}
              className="h-4 w-4 accent-brand-600"
            />
            {tr(botFlowLabels[f])}
            {industryFlow === f && (
              <span className="text-xs text-ink-muted">{tr('(מתאים לתחום שלכם)')}</span>
            )}
          </label>
        ))}
      </fieldset>
      {settings.flow === 'event' ? (
        <>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.holdDate}
              disabled={!settings.enabled}
              onChange={(e) => change({ holdDate: e.target.checked })}
              className="h-4 w-4 accent-brand-600"
            />
            {tr('לשמור את התאריך כתפוס עד שאחליט')}
          </label>
          <p className="text-sm text-ink-muted">
            {tr(
              'הבוט שואל על האירוע (סוג, תאריך, אורחים ואזור), והבקשה מחכה לאישור שלכם בעמוד התורים.',
            )}
          </p>
        </>
      ) : (
        <fieldset disabled={!settings.enabled} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-ink-muted">{tr('תורים שנקבעים בבוט:')}</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="bot-confirm"
              checked={settings.autoConfirm}
              onChange={() => change({ autoConfirm: true })}
              className="h-4 w-4 accent-brand-600"
            />
            {tr('מאושרים מיד')}
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="bot-confirm"
              checked={!settings.autoConfirm}
              onChange={() => change({ autoConfirm: false })}
              className="h-4 w-4 accent-brand-600"
            />
            {tr('ממתינים לאישור שלכם (הזמן נשמר בינתיים)')}
          </label>
        </fieldset>
      )}
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {saved && !dirty && <Alert tone="success">{tr('ההגדרות נשמרו.')}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={saveSettings} disabled={!dirty} loading={update.isPending}>
          {tr('שמירת הגדרות הבוט')}
        </Button>
        {dirty && (
          <>
            <span role="status" className="text-sm text-warning-600">
              {tr('יש שינויים שעוד לא נשמרו')}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              {tr('ביטול השינויים')}
            </Button>
          </>
        )}
      </div>
      <details className="rounded-lg border border-surface-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {tr('עריכת ההודעות של הבוט')}
        </summary>
        <BotTextsForm
          key={bot.data.settings.flow}
          businessId={businessId}
          settings={bot.data.settings}
        />
      </details>
      <details className="rounded-lg border border-surface-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {tr('בינתיים, הצצה לעבודות שלנו')}
          <span className="ms-2 text-xs font-normal text-ink-muted">
            {bot.data.settings.showcase.enabled ? tr('פעיל') : tr('כבוי')}
          </span>
        </summary>
        <ShowcaseForm businessId={businessId} settings={bot.data.settings} />
      </details>
    </section>
  );
}

type Saved = WhatsAppBotResponse['settings'];

/** The saved settings as a full update, so saving one part never resets another. */
export const toRequest = (saved: Saved): WhatsAppBotSettings => ({
  mode: saved.mode,
  autoReplyText: saved.autoReplyText,
  enabled: saved.enabled,
  autoConfirm: saved.autoConfirm,
  holdDate: saved.holdDate,
  flow: saved.flowIsDefault ? null : saved.flow,
  texts: saved.texts,
  showcase: {
    enabled: saved.showcase.enabled,
    text: saved.showcase.text ?? null,
    link: saved.showcase.link,
    assetIds: saved.showcase.assetIds,
  },
});

type Placeholder = (typeof BOT_PLACEHOLDERS)[number];
/** Hebrew names of the placeholders; in event requests the service is the event type. */
const placeholderName = (flow: BotFlow, p: Placeholder) =>
  flow === 'event' && p === '{service}'
    ? 'סוג האירוע'
    : flow === 'event' && p === '{time}'
      ? 'תאריך האירוע'
      : botPlaceholderLabels[p];
const chipLabel = (flow: BotFlow, p: Placeholder) => tr(placeholderName(flow, p));

/**
 * In the editor, placeholders read as tags in the owner's language — "[שם העסק]" or
 * "[Business name]" — instead of codes; they become `{business}` etc. again when saved. Every
 * variant (either language, either flow) is understood, so switching never breaks a message.
 */
const tagOf = (flow: BotFlow, p: Placeholder) => `[${chipLabel(flow, p)}]`;
const toTags = (text: string, flow: BotFlow) =>
  BOT_PLACEHOLDERS.reduce((t, p) => t.replaceAll(p, tagOf(flow, p)), text);
const toCodes = (text: string) =>
  BOT_PLACEHOLDERS.reduce(
    (t, p) =>
      BOT_FLOWS.reduce(
        (u, f) => u.replaceAll(tagOf(f, p), p).replaceAll(`[${placeholderName(f, p)}]`, p),
        t,
      ),
    text,
  );

const initialTexts = (saved: Saved) =>
  Object.fromEntries(
    BOT_TEXT_KEYS.map((k) => [k, toTags(saved.texts[k] ?? saved.defaults[k], saved.flow)]),
  ) as Record<BotTextKey, string>;

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
      BOT_TEXT_KEYS.map((k) => {
        const text = toCodes(texts[k]);
        return [k, text.trim() === settings.defaults[k] ? null : text];
      }),
    );
    const parsed = botTextsSchema.safeParse(custom);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    update.mutate(
      { ...toRequest(settings), texts: parsed.data },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-5">
      <p className="text-xs text-ink-muted">
        {tr(
          'הלקוחות מקבלים את ההודעות בעברית. פרטים בסוגריים, כמו [שם העסק], מתמלאים אוטומטית בפרטים האמיתיים. מוסיפים אותם בכפתורים שמתחת לכל הודעה. הכפתורים והרשימות בוואטסאפ נשארים קבועים.',
        )}
      </p>
      {botTextKeysFor(settings.flow).map((k) => (
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
                onClick={() => insert(k, tagOf(settings.flow, p))}
                aria-label={`${tr('הוספה:')} ${chipLabel(settings.flow, p)} (${tr(botTextLabels[k])})`}
                className="rounded-full border border-surface-border px-2 py-0.5 text-ink hover:bg-surface-sunken"
              >
                + {chipLabel(settings.flow, p)}
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
                {fillBotText(toCodes(texts[k]), values) || '—'}
              </p>
            </div>
            {toCodes(texts[k]) !== settings.defaults[k] && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => edit(k, toTags(settings.defaults[k], settings.flow))}
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

/**
 * "In the meantime, take a look" (D-106): what a customer who doesn't book gets — a message, a
 * link (Instagram, a video, the website) and up to 3 photos from the media library.
 */
function ShowcaseForm({ businessId, settings }: { businessId: string; settings: Saved }) {
  const business = useCurrentBusiness();
  const update = useUpdateBotSettings(businessId);
  const assets = useAssets(businessId);
  const saved = settings.showcase;
  const [enabled, setEnabled] = useState(saved.enabled);
  const [text, setText] = useState(toTags(saved.text ?? saved.defaultText, settings.flow));
  const [link, setLink] = useState(saved.link ?? '');
  const [assetIds, setAssetIds] = useState(saved.assetIds);
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const urlOf = (id: string) => assets.data?.assets.find((a) => a.id === id)?.url;
  const changed = () => setDone(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    const own = toCodes(text).trim();
    const parsed = botShowcaseSchema.safeParse({
      enabled,
      // The industry default isn't stored, so it can improve later.
      text: own === saved.defaultText ? null : own,
      link,
      assetIds,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    update.mutate(
      { ...toRequest(settings), showcase: { ...parsed.data, text: parsed.data.text ?? null } },
      { onSuccess: () => setDone(true) },
    );
  };

  const filled = fillBotText(toCodes(text), {
    business: business.name,
    service: 'תור',
    when: '',
  });

  return (
    <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        {tr(
          'לקוח שלא קבע תור — ביטל, ביקש לדבר עם הצוות, לא מצא זמן פנוי או הפסיק לענות חצי שעה — מקבל את ההצצה הזו, לכל היותר פעם ביום, ואחריה כפתור לקביעת תור. בנוסף מופיעה ברשימה של הבוט האפשרות "📸 העבודות שלנו".',
        )}
      </p>
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            changed();
            setEnabled(e.target.checked);
          }}
          className="h-4 w-4 accent-brand-600"
        />
        {tr('שליחת הצצה ללקוחות שלא קבעו')}
      </label>
      <fieldset disabled={!enabled} className="flex flex-col gap-4 disabled:opacity-60">
        <Textarea
          label={tr('ההודעה')}
          dir="rtl"
          lang="he"
          rows={2}
          value={text}
          error={errors.text}
          onChange={(e) => {
            changed();
            setText(e.target.value);
          }}
        />
        <Field
          label={tr('קישור (לא חובה)')}
          hint={tr(
            'אינסטגרם, יוטיוב, טיקטוק או האתר שלכם. בקישור לסרטון, וואטסאפ מציג תצוגה מקדימה.',
          )}
          ltr
          type="url"
          inputMode="url"
          placeholder="https://instagram.com/…"
          value={link}
          error={errors.link}
          onChange={(e) => {
            changed();
            setLink(e.target.value);
          }}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">
            {tr('תמונות (עד {0})', SHOWCASE_MAX_IMAGES)}
          </span>
          <ul aria-label={tr('תמונות בהצצה')} className="flex flex-wrap gap-2">
            {assetIds.map((id, i) => (
              <li
                key={id}
                className="relative h-20 w-20 overflow-hidden rounded-lg bg-surface-sunken"
              >
                {urlOf(id) && <img src={urlOf(id)} alt="" className="h-full w-full object-cover" />}
                <button
                  type="button"
                  aria-label={tr('הסרת תמונה {0}', i + 1)}
                  onClick={() => {
                    changed();
                    setAssetIds((ids) => ids.filter((x) => x !== id));
                  }}
                  className="absolute end-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-ink shadow"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {assetIds.length < SHOWCASE_MAX_IMAGES && (
              <li>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-surface-border text-xs text-ink-muted hover:bg-surface-sunken"
                >
                  <ImagePlus aria-hidden className="h-5 w-5" />
                  {tr('הוספת תמונה')}
                </button>
              </li>
            )}
          </ul>
          {errors.assetIds && <p className="text-xs text-danger-600">{tr(errors.assetIds)}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">{tr('כך הלקוח יראה את זה:')}</span>
          <div dir="rtl" lang="he" className="flex max-w-md flex-col gap-1.5">
            <p className="whitespace-pre-line break-words rounded-2xl rounded-ee-sm bg-success-50 px-3 py-2 text-sm text-ink ring-1 ring-success-600/20">
              {filled || '—'}
              {link && (
                <>
                  {'\n'}
                  <bdi dir="ltr" className="text-brand-700 underline">
                    {link}
                  </bdi>
                </>
              )}
            </p>
            {assetIds.length > 0 && (
              <div className="flex gap-1.5">
                {assetIds.map((id) =>
                  urlOf(id) ? (
                    <img
                      key={id}
                      src={urlOf(id)}
                      alt=""
                      className="h-16 w-16 rounded-xl object-cover"
                    />
                  ) : null,
                )}
              </div>
            )}
            <p className="rounded-2xl rounded-ee-sm bg-success-50 px-3 py-2 text-sm text-ink ring-1 ring-success-600/20">
              כשתרצו, אפשר לקבוע תור כאן 👇
              <span className="mt-1.5 block rounded-lg bg-surface px-2 py-1 text-center text-xs font-medium text-brand-700">
                📅 לקביעת תור
              </span>
            </p>
          </div>
        </div>
      </fieldset>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {done && <Alert tone="success">{tr('ההצצה נשמרה.')}</Alert>}
      <div>
        <Button type="submit" loading={update.isPending}>
          {tr('שמירה')}
        </Button>
      </div>
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        title={tr('בחירת תמונה להצצה')}
        onSelect={(asset) => {
          changed();
          setAssetIds((ids) => (ids.includes(asset.id) ? ids : [...ids, asset.id]));
          setPicking(false);
        }}
      />
    </form>
  );
}
