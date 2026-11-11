import { Globe, MessageCircle, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from './Logo';
import { tr } from '../../i18n';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Shown under the form, e.g. "already have an account?" links. */
  footer?: ReactNode;
}

const benefits = [
  {
    icon: Globe,
    title: tr('אתר לעסק בכמה דקות'),
    text: tr('בוחרים תבנית, מעדכנים טקסטים ותמונות ומפרסמים.'),
  },
  {
    icon: Users,
    title: tr('כל הפניות במקום אחד'),
    text: tr('כל השארת פרטים באתר נכנסת אוטומטית כליד.'),
  },
  {
    icon: MessageCircle,
    title: tr('כל פנייה מקבלת מענה, גם כשאתם לא זמינים'),
    text: tr('תיבת שיחות אחת לכל הערוצים ולכל הצוות.'),
  },
];

/** Signed-out screens: the form on one side, a warm brand panel on the other (desktop only). */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <header className="flex items-center justify-between gap-4">
          <Logo />
          <LanguageSwitch />
        </header>
        <main className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 flex flex-col gap-2">
              <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
              {description && <div className="text-base text-ink-muted">{description}</div>}
            </div>
            {children}
            {footer && <div className="mt-8 text-sm text-ink-muted">{footer}</div>}
          </div>
        </main>
      </div>

      <aside
        aria-hidden
        className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 p-12 text-white lg:flex lg:flex-col lg:justify-center"
      >
        <div className="absolute -end-24 -top-24 h-72 w-72 rounded-full bg-brand-300/25 blur-3xl" />
        <div className="absolute -bottom-32 -start-20 h-80 w-80 rounded-full bg-brand-400/25 blur-3xl" />
        <div className="relative mx-auto flex max-w-md flex-col gap-10">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-brand-100">{tr('לעסקים מכל סוג')}</p>
            <p className="text-4xl font-semibold leading-tight">
              {tr('מנהלים את כל העסק במקום אחד.')}
            </p>
          </div>
          <ul className="flex flex-col gap-5">
            {benefits.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t}</span>
                  <span className="text-sm text-brand-100/80">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="rounded-2xl bg-white p-4 text-ink shadow-lift">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700">
                {tr('ד')}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium">{tr('פנייה חדשה מהאתר')}</p>
                <p className="text-xs text-ink-muted">{tr('דנה · מעוניינת בתור ליום חמישי')}</p>
              </div>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                {tr('חדש')}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
