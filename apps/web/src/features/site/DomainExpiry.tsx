import { CalendarClock } from 'lucide-react';
import { Alert, Button, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { intlLocale, tr } from '../../i18n';
import { useCheckDomain, useDomainExpiry } from './domainApi';

const dateFmt = () => new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'long', timeZone: 'UTC' });

/**
 * F33: when the domain of the existing website expires, read from its registry, so it isn't
 * forgotten. Colours warn from 60 days (amber) and 30 days (red) out; reminders also arrive as
 * notifications and emails.
 */
export function DomainExpiry({ businessId, canEdit }: { businessId: string; canEdit: boolean }) {
  const status = useDomainExpiry(businessId);
  const check = useCheckDomain(businessId);
  if (status.isPending) return <Spinner size="sm" label={tr('טוענים…')} />;
  if (status.isError) return <Alert tone="danger">{errorMessage(status.error)}</Alert>;
  const d = status.data;
  if (!d.domain) return null;

  const left = d.daysLeft;
  const tone =
    left === null
      ? 'bg-surface-muted text-ink'
      : left < 30
        ? 'bg-danger-50 text-danger-700'
        : left <= 60
          ? 'bg-amber-50 text-amber-800'
          : 'bg-success-50 text-success-600';

  let line: string;
  if (d.check === 'ok' && d.expiresAt && left !== null) {
    const when = dateFmt().format(new Date(d.expiresAt));
    line =
      left < 0
        ? tr('הדומיין {0} פג ב-{1}. חדשו אותו מיד.', d.domain, when)
        : left === 0
          ? tr('הדומיין {0} פג היום ({1}).', d.domain, when)
          : tr('הדומיין {0} פג ב-{1}, בעוד {2} ימים.', d.domain, when, left);
  } else if (d.checking && d.check === null) {
    line = tr('בודקים מתי {0} פג…', d.domain);
  } else if (d.check === 'unsupported') {
    line = tr(
      'לא ניתן לקרוא אוטומטית את תאריך הפקיעה של {0}: לסיומת הזו אין בדיקה ציבורית.',
      d.domain,
    );
  } else if (d.check === 'failed') {
    line = tr('לא הצלחנו לבדוק עכשיו מתי {0} פג. ננסה שוב בקרוב.', d.domain);
  } else {
    line = tr('עוד לא בדקנו מתי {0} פג.', d.domain);
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-sm',
        tone,
      )}
    >
      <p className="flex items-start gap-2">
        {d.checking && d.check === null ? (
          <Spinner size="sm" label="" />
        ) : (
          <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <span>{line}</span>
      </p>
      {canEdit && (
        <Button
          size="sm"
          variant="secondary"
          loading={check.isPending}
          onClick={() => check.mutate()}
        >
          {tr('בדיקה עכשיו')}
        </Button>
      )}
      {check.isError && <Alert tone="danger">{errorMessage(check.error)}</Alert>}
    </div>
  );
}
