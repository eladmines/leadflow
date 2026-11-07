import type { Business } from '@leadflow/shared';
import { ArrowRight, Globe, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { PageHeader } from '../shell/PageHeader';
import { WebsiteForm } from './ExistingWebsite';
import { TemplatePicker } from './TemplatePicker';
import { tr } from '../../i18n';

/**
 * "My website" before there is one (D-130): two clear choices — the business already has a
 * website (add its address) or wants to build one here (pick a template).
 */
export function SiteStart({ business }: { business: Business }) {
  const [choice, setChoice] = useState<'existing' | 'build' | null>(null);

  if (choice === 'build') {
    return (
      <TemplatePicker
        intro={
          <button
            type="button"
            onClick={() => setChoice(null)}
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
          >
            {/* Back points to the start side: right in Hebrew, left in English. */}
            <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
            {tr('חזרה לבחירה')}
          </button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader title={tr('האתר שלי')} description={tr('יש לכם כבר אתר, או שנבנה אחד חדש?')} />
      <div className="grid gap-4 md:grid-cols-2">
        <Option
          icon={<Globe aria-hidden className="h-6 w-6" />}
          tone="bg-sky-500"
          title={tr('יש לי כבר אתר')}
          text={tr('מוסיפים את הכתובת ורואים את האתר כאן. LeadFlow לא משנה בו כלום.')}
          active={choice === 'existing'}
        >
          {choice === 'existing' ? (
            <WebsiteForm business={business} onDone={() => setChoice(null)} compact />
          ) : (
            <Button variant="secondary" onClick={() => setChoice('existing')}>
              {tr('הוספת האתר הקיים')}
            </Button>
          )}
        </Option>
        <Option
          icon={<Sparkles aria-hidden className="h-6 w-6" />}
          tone="bg-brand-600"
          title={tr('אני רוצה לבנות אתר')}
          text={tr(
            'בוחרים תבנית מוכנה, והיא מתמלאת בפרטי העסק. משנים טקסטים ותמונות ומפרסמים — וכל פנייה מהאתר נכנסת ישר למערכת.',
          )}
          active={false}
        >
          <Button onClick={() => setChoice('build')}>{tr('לבחירת תבנית')}</Button>
        </Option>
      </div>
    </>
  );
}

function Option({
  icon,
  tone,
  title,
  text,
  active,
  children,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  text: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border bg-surface p-6 shadow-card',
        active ? 'border-brand-300' : 'border-surface-border',
      )}
    >
      <span
        className={cn('flex h-12 w-12 items-center justify-center rounded-xl text-white', tone)}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{text}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </section>
  );
}
