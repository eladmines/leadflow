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
        className="hidden bg-brand-700 p-12 text-white lg:flex lg:flex-col lg:justify-center xl:p-20"
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-10">
          <div className="flex flex-col gap-4">
            <p className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              {tr('לא מפספסים לקוח בגלל הודעה שלא נענתה.')}
            </p>
            <p className="text-lg text-brand-100">
              {tr('מקבלים כל פנייה, עוקבים אחריה וסוגרים עסקה.')}
            </p>
          </div>
          {/* Leads from every channel meeting in one place (the same in both languages). */}
          <img src="/auth-pipeline.svg" alt="" className="w-full max-w-sm" />
        </div>
      </aside>
    </div>
  );
}
