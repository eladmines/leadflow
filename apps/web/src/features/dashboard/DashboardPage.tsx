import {
  businessWebPaths,
  can,
  formatIsraeliPhone,
  industryLabels,
  roleLabels,
  weekdayLabels,
  WEEKDAYS,
} from '@leadflow/shared';
import { CircleCheck, Circle, Clock, Inbox } from 'lucide-react';
import { Card, TextLink } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';

type ItemState = 'done' | 'todo' | 'soon';

/** Business home: setup checklist (real state only), recent leads (empty until F07), profile. */
export function DashboardPage() {
  const business = useCurrentBusiness();
  const user = useMe().data?.user;
  const firstName = user?.fullName.split(' ')[0] ?? '';

  const checklist: { label: string; hint: string; state: ItemState }[] = [
    {
      label: 'הקמת פרופיל העסק',
      hint: 'שם, תחום, טלפון ושעות פעילות',
      state: business.status === 'ACTIVE' ? 'done' : 'todo',
    },
    {
      label: 'אימות כתובת האימייל',
      hint: 'כדי שנוכל לשלוח לך התראות על פניות',
      state: user?.emailVerified ? 'done' : 'todo',
    },
    { label: 'בניית אתר העסק', hint: 'בחירת תבנית ועריכת התוכן', state: 'soon' },
    { label: 'פרסום האתר וקבלת פניות', hint: 'כל פנייה מהטופס תיכנס כליד', state: 'soon' },
    { label: 'חיבור WhatsApp עסקי', hint: 'מענה ללקוחות מתוך המערכת', state: 'soon' },
  ];
  const done = checklist.filter((i) => i.state === 'done').length;
  const openDays = business.openingHours
    ? WEEKDAYS.filter((d) => business.openingHours?.[d].open)
    : [];

  return (
    <>
      <PageHeader
        title={`שלום, ${firstName}`}
        description={`${business.name} · ${roleLabels[business.role]}`}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="flex flex-col gap-4 lg:col-span-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">הצעדים להפעלת העסק</h2>
            <span className="text-sm text-ink-muted">
              הושלמו {done} מתוך {checklist.length}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="התקדמות ההקמה"
            aria-valuemin={0}
            aria-valuemax={checklist.length}
            aria-valuenow={done}
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
          >
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${(done / checklist.length) * 100}%` }}
            />
          </div>
          <ul className="flex flex-col divide-y divide-surface-border">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-start gap-3 py-3">
                {item.state === 'done' ? (
                  <CircleCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
                ) : item.state === 'soon' ? (
                  <Clock aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-subtle" />
                ) : (
                  <Circle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-subtle" />
                )}
                <div className="flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      item.state === 'soon' ? 'text-ink-muted' : 'text-ink',
                    )}
                  >
                    {item.label}
                    <span className="sr-only">
                      {item.state === 'done'
                        ? ' — הושלם'
                        : item.state === 'soon'
                          ? ' — בקרוב'
                          : ' — טרם הושלם'}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">{item.hint}</p>
                </div>
                {item.state === 'soon' && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                    בקרוב
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-3 lg:col-span-2">
          <h2 className="text-lg font-semibold text-ink">פניות אחרונות</h2>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <Inbox aria-hidden className="h-8 w-8 text-ink-subtle" />
            <p className="text-sm font-medium text-ink">עדיין אין פניות</p>
            <p className="max-w-xs text-xs text-ink-muted">
              אחרי שהאתר יפורסם, כל פנייה מהטופס תופיע כאן ותקבלו עליה התראה.
            </p>
          </div>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">פרופיל העסק</h2>
          {can(business.role, 'business.update') && (
            <TextLink to={businessWebPaths.section(business.id, 'settings')}>עריכה</TextLink>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-ink-muted">תחום</dt>
          <dd>{industryLabels[business.industry]}</dd>
          <dt className="text-ink-muted">טלפון</dt>
          <dd>
            {business.phone ? <bdi dir="ltr">{formatIsraeliPhone(business.phone)}</bdi> : 'לא הוזן'}
          </dd>
          <dt className="text-ink-muted">כתובת</dt>
          <dd>{business.address ?? 'לא הוזנה'}</dd>
          <dt className="text-ink-muted">אזורי שירות</dt>
          <dd>{business.serviceAreas.length ? business.serviceAreas.join(', ') : 'לא הוגדרו'}</dd>
          <dt className="text-ink-muted">ימי פעילות</dt>
          <dd>
            {openDays.length ? openDays.map((d) => weekdayLabels[d]).join(', ') : 'לא הוגדרו'}
          </dd>
        </dl>
      </Card>
    </>
  );
}
