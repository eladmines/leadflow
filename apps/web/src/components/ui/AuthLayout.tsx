import type { ReactNode } from 'react';
import { Logo } from './Logo';

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Shown under the card, e.g. "already have an account?" links. */
  footer?: ReactNode;
}

/** Centered, mobile-first card used by every signed-out screen. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 via-surface-muted to-surface-muted">
      <header className="flex justify-center px-4 pb-2 pt-10 sm:pt-14">
        <Logo />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pb-12 pt-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-surface-border bg-surface px-5 py-7 shadow-sm sm:px-8 sm:py-9">
            <div className="mb-6 flex flex-col gap-2 text-center">
              <h1 className="text-2xl font-bold text-ink">{title}</h1>
              {description && <div className="text-sm text-ink-muted">{description}</div>}
            </div>
            {children}
          </div>
          {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
