import {
  apiPaths,
  BOT_PLACEHOLDERS,
  botShowcaseSchema,
  SHOWCASE_MAX_IMAGES,
  botPlaceholderLabels,
  BOT_FLOWS,
  BOT_TEXT_KEYS,
  botTextKeysFor,
  type BotFlow,
  botTextLabels,
  botTextsSchema,
  fillBotText,
  type BotTextKey,
  type WhatsAppBotResponse,
  type WhatsAppBotSettings,
} from '@leadflow/shared';
import { Eye, ImagePlus, MessageSquareText, RotateCcw, Video, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, DialogShell, EmojiPicker, Field, Textarea } from '../../components/ui';
import { useAssets } from '../media/api';
import { MediaPicker } from '../media/MediaPicker';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useBotSettings, useShowcaseVideo, useUpdateBotSettings } from './api';

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
  const [editor, setEditor] = useState<'texts' | null>(null);
  if (bot.isPending) return null;
  if (bot.isError) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  const stored = bot.data.settings;
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
    <section aria-labelledby="bot-settings-title" className="flex flex-col gap-3">
      {/* The card around it carries the visible title and the on/off switch (D-147). */}
      <h3 id="bot-settings-title" className="sr-only">
        {tr('הגדרות קביעת התורים')}
      </h3>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">
          {tr('מה לקוחות יכולים להזמין?')}
        </legend>
        {BOT_FLOWS.map((f) => (
          <Choice
            key={f}
            name="bot-flow"
            checked={settings.flow === f}
            onChange={() => change({ flow: f })}
            label={tr(FLOW_CHOICES[f].label)}
            hint={`${tr(FLOW_CHOICES[f].hint)}${industryFlow === f ? ` · ${tr('מתאים לתחום שלכם')}` : ''}`}
          />
        ))}
      </fieldset>
      {settings.flow === 'event' ? (
        <>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.holdDate}
              onChange={(e) => change({ holdDate: e.target.checked })}
              className="h-4 w-4 accent-brand-600"
            />
            {tr('לשמור את התאריך כתפוס עד שאחליט')}
          </label>
          <p className="text-sm text-ink-muted">
            {tr(
              'הלקוח עונה על כמה שאלות על האירוע (סוג, תאריך, אורחים ואזור), והבקשה מחכה לאישור שלכם בעמוד התורים.',
            )}
          </p>
        </>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">{tr('כשלקוח קובע תור:')}</legend>
          <Choice
            name="bot-confirm"
            checked={settings.autoConfirm}
            onChange={() => change({ autoConfirm: true })}
            label={tr('התור מאושר מיד')}
            hint={tr('הלקוח מקבל אישור, והתור נכנס ליומן.')}
          />
          <Choice
            name="bot-confirm"
            checked={!settings.autoConfirm}
            onChange={() => change({ autoConfirm: false })}
            label={tr('התור מחכה לאישור שלי')}
            hint={tr('השעה שמורה בינתיים. מאשרים בעמוד התורים.')}
          />
        </fieldset>
      )}
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {saved && !dirty && <Alert tone="success">{tr('ההגדרות נשמרו.')}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={saveSettings} disabled={!dirty} loading={update.isPending}>
          {tr('שמירת ההגדרות')}
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
      {/* The longer editors open in a pop-up, so the card stays short (D-148). */}
      <div className="flex flex-wrap gap-2 border-t border-surface-border pt-4">
        <Button variant="secondary" onClick={() => setEditor('texts')}>
          <MessageSquareText aria-hidden className="h-4 w-4" />
          {tr('עריכת ההודעות ללקוחות')}
        </Button>
      </div>
      <DialogShell
        open={editor === 'texts'}
        onOpenChange={(o) => !o && setEditor(null)}
        title={tr('עריכת ההודעות ללקוחות')}
        wide
      >
        <BotTextsForm
          key={bot.data.settings.flow}
          businessId={businessId}
          settings={bot.data.settings}
        />
      </DialogShell>
    </section>
  );
}

/** What customers can book, said plainly (D-149). */
const FLOW_CHOICES: Record<BotFlow, { label: string; hint: string }> = {
  appointment: { label: 'תור בשעה פנויה', hint: 'הלקוח רואה ימים ושעות פנויים מהיומן.' },
  event: { label: 'בקשה לאירוע', hint: 'הלקוח כותב תאריך, מספר אורחים ואזור, ואתם מאשרים.' },
};

/** A radio answer with a short explanation under it. */
function Choice({
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-brand-600"
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

/** The "meanwhile" video (D-151): preview, replace or remove; saved as soon as it's chosen. */
function ShowcaseVideo({
  businessId,
  video,
}: {
  businessId: string;
  video: { sizeBytes: number } | null;
}) {
  const { upload, remove } = useShowcaseVideo(businessId);
  const src = apiPaths.whatsapp.showcaseVideo(businessId);
  const input = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{tr('סרטון (לא חובה)')}</span>
      {video && (
        <div className="flex flex-wrap items-end gap-3">
          <video
            controls
            preload="metadata"
            src={`${src}?s=${video.sizeBytes}`}
            className="h-36 max-w-full rounded-lg bg-ink/90"
          />
          <div className="flex flex-col gap-1 text-xs text-ink-muted">
            <span>{tr('סרטון · {0}', mb(video.sizeBytes))}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove.mutate()}
              className="inline-flex items-center gap-1 text-danger-600 hover:underline"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
              {tr('הסרת הסרטון')}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="video/mp4"
          className="sr-only"
          aria-label={tr('סרטון להצצה')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={upload.isPending}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Video aria-hidden className="h-4 w-4" />
          {video ? tr('החלפת הסרטון') : tr('הוספת סרטון')}
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
/** "Meanwhile, a look at our work" (D-106, for both modes since D-149); on/off is on its card. */
export function ShowcaseForm({ businessId, settings }: { businessId: string; settings: Saved }) {
  const business = useCurrentBusiness();
  const update = useUpdateBotSettings(businessId);
  const assets = useAssets(businessId);
  const saved = settings.showcase;
  const [text, setText] = useState(toTags(saved.text ?? saved.defaultText, settings.flow));
  const textBox = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState(saved.link ?? '');
  const [assetIds, setAssetIds] = useState(saved.assetIds);
  const [picking, setPicking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const urlOf = (id: string) => assets.data?.assets.find((a) => a.id === id)?.url;
  const changed = () => setDone(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    const own = toCodes(text).trim();
    const parsed = botShowcaseSchema.safeParse({
      enabled: saved.enabled,
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

  const filled = fillBotText(toCodes(text), { business: business.name, service: 'תור', when: '' });

  return (
    <form noValidate onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        {tr(
          'נשלחת מיד אחרי שהלקוח מחליט (זמן לשיחה, תור או אירוע): ההודעה עם הקישור, אחריה הסרטון והתמונות.',
        )}
      </p>
      <fieldset className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Textarea
            ref={textBox}
            label={tr('ההודעה')}
            dir="auto"
            rows={2}
            value={text}
            error={errors.text}
            onChange={(e) => {
              changed();
              setText(e.target.value);
            }}
          />
          <EmojiPicker
            target={textBox}
            value={text}
            onInsert={(next) => {
              changed();
              setText(next);
            }}
          />
        </div>
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
        <ShowcaseVideo businessId={businessId} video={saved.video ?? null} />
        {previewing && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">{tr('כך הלקוח יראה את זה:')}</span>
            <div dir="auto" className="flex max-w-md flex-col gap-1.5">
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
              {saved.video && (
                <p className="flex items-center gap-1.5 rounded-2xl rounded-ee-sm bg-success-50 px-3 py-2 text-sm text-ink ring-1 ring-success-600/20">
                  <Video aria-hidden className="h-4 w-4" />
                  {tr('סרטון')}
                </p>
              )}
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
            </div>
          </div>
        )}
      </fieldset>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {done && <Alert tone="success">{tr('ההצצה נשמרה.')}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={update.isPending}>
          {tr('שמירה')}
        </Button>
        {/* The customer's view, on request (D-155); it opens above. */}
        <Button
          type="button"
          variant="secondary"
          aria-expanded={previewing}
          onClick={() => setPreviewing((v) => !v)}
        >
          <Eye aria-hidden className="h-4 w-4" />
          {previewing ? tr('הסתרת התצוגה המקדימה') : tr('תצוגה מקדימה')}
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
