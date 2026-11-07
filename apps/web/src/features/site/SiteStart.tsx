import type { Business } from '@leadflow/shared';
import { ArrowRight, Globe, Sparkles, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { PageHeader } from '../shell/PageHeader';
import { WebsiteForm } from './ExistingWebsite';
import { TemplatePicker } from './TemplatePicker';
import { tr } from '../../i18n';

type Choice = 'existing' | 'build';

/**
 * "My website" before there is one (D-130, D-136): "please choose" and two separate cards — build
 * a new website here, or link the one the business already has. Each opens its own screen, with
 * the way back.
 */
export function SiteStart({ business }: { business: Business }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const back = <BackLink onClick={() => setChoice(null)} />;

  if (choice === 'build') return <TemplatePicker intro={back} />;

  if (choice === 'existing') {
    return (
      <>
        <PageHeader title={tr('חיבור אתר קיים')} />
        <section className="flex max-w-2xl flex-col gap-5 rounded-2xl border border-surface-border bg-surface p-6 shadow-card">
          {back}
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm"
            >
              <Globe className="h-5 w-5" />
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold text-ink">{tr('מה הכתובת של האתר שלכם?')}</h2>
              <p className="text-sm text-ink-muted">
                {tr('אחרי השמירה תראו את האתר כאן. אפשר לשנות את הכתובת בכל זמן.')}
              </p>
            </div>
          </div>
          <WebsiteForm business={business} compact />
        </section>
      </>
    );
  }

  const options: { value: Choice; title: string; text: string; icon: LucideIcon; tile: string }[] =
    [
      {
        value: 'build',
        icon: Sparkles,
        tile: 'bg-violet-500',
        title: tr('בניית אתר חדש'),
        text: tr('בוחרים תבנית מוכנה, והיא מתמלאת בפרטי העסק. משנים טקסטים ותמונות ומפרסמים.'),
      },
      {
        value: 'existing',
        icon: Globe,
        tile: 'bg-sky-500',
        title: tr('חיבור אתר קיים'),
        text: tr('יש לכם כבר אתר? מוסיפים את הכתובת ורואים אותו כאן. LeadFlow לא משנה בו כלום.'),
      },
    ];

  return (
    <>
      <PageHeader
        title={tr('האתר שלי')}
        description={tr(
          'האתר הוא הכרטיס של העסק באינטרנט: לקוחות רואים מה אתם מציעים, איך להגיע ואיך ליצור קשר. כל מי שממלא בו את הטופס מגיע ישר ל"לקוחות ולידים", כך שאף פנייה לא הולכת לאיבוד.',
        )}
      />
      <section id="site-start" aria-labelledby="site-start-title" className="flex flex-col gap-4">
        <h2 id="site-start-title" className="text-lg font-semibold text-ink">
          {tr('בחרו איך להתחיל')}
        </h2>
        <ul className="grid max-w-4xl gap-4 md:grid-cols-2">
          {options.map(({ value, title, text, icon: Icon, tile }) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => setChoice(value)}
                className="group flex h-full w-full flex-col items-start gap-4 rounded-2xl border border-surface-border bg-surface p-6 text-start shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift"
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-sm',
                    tile,
                  )}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold text-ink group-hover:text-brand-700">
                    {title}
                  </span>
                  <span className="text-sm text-ink-muted">{text}</span>
                </span>
                <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  {tr('בחירה')}
                  <ArrowRight aria-hidden className="h-4 w-4 rtl:rotate-180" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Back to the two choices; points to the start side (right in Hebrew, left in English). */
function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
    >
      <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
      {tr('חזרה לבחירה')}
    </button>
  );
}
