import { replyModeLabels, type ReplyMode, type WhatsAppBotResponse } from '@leadflow/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Card, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useUpdateBotSettings } from './api';
import { businessTag, modeHelp, toCode, toTag } from './AutoReplyCard';
import { toRequest } from './BookingBotCard';

type Saved = WhatsAppBotResponse['settings'];

const doneKey = (businessId: string) => `leadflow.whatsapp.setup.${businessId}`;

/** Whether to open the guide by itself: nothing set up yet, and not finished or closed before. */
export function shouldOfferSetup(businessId: string, s: Saved) {
  try {
    if (localStorage.getItem(doneKey(businessId))) return false;
  } catch {
    // Storage blocked: decide from the settings alone.
  }
  return s.mode === 'auto_reply' && s.autoReplyText === null && s.activeStatus === null;
}

export function markSetupDone(businessId: string) {
  try {
    localStorage.setItem(doneKey(businessId), '1');
  } catch {
    // Storage blocked: the guide may open again next time.
  }
}

/**
 * First setup of automatic replies in three steps (D-144): what happens when a customer writes,
 * the message (or, for the bot, whether bookings wait for approval), and done. The full settings
 * page stays for everyday changes.
 */
export function SetupGuide({
  businessId,
  saved,
  onClose,
}: {
  businessId: string;
  saved: Saved;
  onClose: () => void;
}) {
  const update = useUpdateBotSettings(businessId);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<ReplyMode>(saved.mode);
  const [text, setText] = useState(toTag(saved.autoReplyText ?? saved.autoReplyDefault));
  const [autoConfirm, setAutoConfirm] = useState(saved.autoConfirm);
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    if (mode === 'auto_reply' && !text.trim()) {
      setError(tr('יש לכתוב את ההודעה'));
      return;
    }
    setError(null);
    const general = toCode(text.trim());
    update.mutate(
      {
        ...toRequest(saved),
        mode,
        enabled: mode === 'booking',
        autoConfirm,
        autoReplyText:
          mode === 'auto_reply' && general !== saved.autoReplyDefault
            ? general
            : saved.autoReplyText,
      },
      {
        onSuccess: () => {
          markSetupDone(businessId);
          setStep(3);
        },
      },
    );
  };
  const close = () => {
    markSetupDone(businessId);
    onClose();
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-brand-700">{tr('שלב {0} מתוך {1}', step, 3)}</p>
        {step < 3 && (
          <button
            type="button"
            onClick={close}
            className="text-sm text-ink-muted underline-offset-2 hover:underline"
          >
            {tr('דילוג')}
          </button>
        )}
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              n <= step ? 'bg-brand-600' : 'bg-surface-muted',
            )}
          />
        ))}
      </div>

      {step === 1 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-lg font-semibold text-ink">
            {tr('מה קורה כשלקוח כותב לכם בוואטסאפ?')}
          </legend>
          {(['auto_reply', 'booking', 'off'] as const satisfies readonly ReplyMode[]).map((m) => (
            <label
              key={m}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                mode === m
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-surface-border hover:border-brand-300',
              )}
            >
              <input
                type="radio"
                name="setup-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1 h-4 w-4 accent-brand-600"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">{tr(replyModeLabels[m])}</span>
                <span className="text-sm text-ink-muted">{tr(modeHelp[m])}</span>
              </span>
            </label>
          ))}
          <div className="flex justify-end">
            <Button
              onClick={() => (mode === 'off' ? finish() : setStep(2))}
              loading={update.isPending}
            >
              {mode === 'off' ? tr('שמירה') : tr('המשך')}
            </Button>
          </div>
        </fieldset>
      )}

      {step === 2 && mode === 'auto_reply' && (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold text-ink">{tr('מה הלקוח יקבל?')}</h3>
          <Textarea
            label={tr('ההודעה הכללית')}
            dir="auto"
            hint={tr('{0} מוחלף בשם העסק.', businessTag())}
            value={text}
            rows={3}
            error={error ?? undefined}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}

      {step === 2 && mode === 'booking' && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-lg font-semibold text-ink">
            {tr('תורים שנקבעים בבוט:')}
          </legend>
          {[
            { value: true, label: tr('מאושרים מיד') },
            { value: false, label: tr('ממתינים לאישור שלכם (הזמן נשמר בינתיים)') },
          ].map((o) => (
            <label
              key={String(o.value)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors',
                autoConfirm === o.value
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-surface-border hover:border-brand-300',
              )}
            >
              <input
                type="radio"
                name="setup-confirm"
                checked={autoConfirm === o.value}
                onChange={() => setAutoConfirm(o.value)}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="font-medium text-ink">{o.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 2 && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(1)}>
            {tr('חזרה')}
          </Button>
          <Button onClick={finish} loading={update.isPending}>
            {tr('שמירה')}
          </Button>
        </div>
      )}

      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}

      {step === 3 && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden />
          <h3 className="text-lg font-semibold text-ink">{tr('הכול מוכן!')}</h3>
          <p className="max-w-md text-sm text-ink-muted">
            {mode === 'off'
              ? tr('הודעות נכנסות בלי מענה אוטומטי. אפשר לשנות את זה כאן בכל זמן.')
              : tr(
                  'מעכשיו לקוחות שכותבים מקבלים מענה לבד. כל השאר, כמו סטטוסים והודעות הבוט, נמצא כאן בהמשך העמוד.',
                )}
          </p>
          <Button onClick={onClose}>{tr('סיום')}</Button>
        </div>
      )}
    </Card>
  );
}
