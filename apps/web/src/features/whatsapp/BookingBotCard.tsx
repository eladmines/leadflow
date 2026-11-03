import type { WhatsAppBotSettings } from '@leadflow/shared';
import { Bot } from 'lucide-react';
import { useState } from 'react';
import { Alert, Card } from '../../components/ui';
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
    </Card>
  );
}
