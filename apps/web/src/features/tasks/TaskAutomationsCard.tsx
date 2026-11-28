import { can, type TaskAutomations } from '@simplecatch/shared';
import { ListTodo } from 'lucide-react';
import { Alert, Button, Spinner, Switch } from '../../components/ui';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useTaskAutomations, useUpdateTaskAutomations } from './api';

const items: { key: keyof TaskAutomations; title: string; when: string }[] = [
  {
    key: 'quoteFollowUp',
    title: tr('משימת מעקב אחרי הצעה'),
    when: tr(
      'כשנשלחת הצעה נוצרת משימה "לחזור לגבי הצעה", יומיים אחרי השליחה ב־09:00 (שישי ושבת עוברים ליום ראשון). נסגרת מעצמה כשההצעה מאושרת או נדחית.',
    ),
  },
  {
    key: 'appointmentConfirm',
    title: tr('משימת אישור תור'),
    when: tr(
      'כשנקבע תור נוצרת משימה "לאשר את התור", יום לפני התור ב־09:00 (שישי ושבת עוברים ליום ראשון, או ליום חמישי אם התור לפני כן). נסגרת מעצמה כשהתור מבוטל, מתקיים או מסומן שלא הגיעו.',
    ),
  },
];

/**
 * F35 (D-213, D-216): the two automatic follow-up tasks, each with a switch. Owners and managers
 * (`automations.manage`) change them; others see them read-only, with the reason. Not tied to
 * WhatsApp being connected.
 */
export function TaskAutomationsCard() {
  const business = useCurrentBusiness();
  const canManage = can(business.role, 'automations.manage');
  const settings = useTaskAutomations(business.id);
  const update = useUpdateTaskAutomations(business.id);

  return (
    <section
      aria-labelledby="task-automations-title"
      className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white"
        >
          <ListTodo className="h-5 w-5" />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id="task-automations-title" className="text-base font-semibold text-ink">
            {tr('משימות אוטומטיות')}
          </h2>
          <p className="text-sm text-ink-muted">
            {tr('משימות מעקב שהמערכת כותבת וסוגרת בשבילך. משימות שהוספתם בעצמכם לא נסגרות מעצמן.')}
          </p>
        </div>
      </div>
      {settings.isPending ? (
        <Spinner size="sm" label={tr('טוענים את ההגדרות…')} />
      ) : settings.isError ? (
        <div className="flex flex-col gap-2">
          <Alert tone="danger">{errorMessage(settings.error)}</Alert>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => void settings.refetch()}
          >
            {tr('נסו שוב')}
          </Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-surface-border">
            {items.map(({ key, title, when }) => {
              const on = (update.isPending ? update.variables : settings.data)?.[key] ?? false;
              return (
                <li key={key} className="flex items-start justify-between gap-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-medium text-ink">
                      {title}{' '}
                      <span className="text-sm font-normal text-ink-muted">
                        · {on ? tr('פועל') : tr('כבוי')}
                      </span>
                    </p>
                    <p className="text-sm text-ink-muted">{when}</p>
                  </div>
                  <Switch
                    label={title}
                    checked={on}
                    disabled={!canManage || update.isPending}
                    onChange={(checked) => update.mutate({ ...settings.data, [key]: checked })}
                  />
                </li>
              );
            })}
          </ul>
          {!canManage && (
            <p className="text-sm text-ink-muted">
              {tr('רק בעלי העסק ומנהלים יכולים לשנות את ההגדרות האלה.')}
            </p>
          )}
          {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
        </>
      )}
    </section>
  );
}
