import { MailCheck } from 'lucide-react';
import { useId } from 'react';
import { useMe } from './api';
import { ResendVerification } from './ResendVerification';
import { tr } from '../../i18n';

/**
 * Soft email verification (D-002): a banner, not a gate. Renders nothing unless the
 * signed-in user's email is unverified, so it can sit in the app shell (F03) as is. Hidden
 * while the server sends no email (D-122).
 */
export function UnverifiedEmailBanner() {
  const me = useMe();
  const titleId = useId();
  const user = me.data?.user;
  if (!user || user.emailVerified || me.data?.emailVerification === false) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-accent-200 bg-accent-50 px-4 py-4 sm:px-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-accent-600 shadow-sm"
        >
          <MailCheck className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {tr('כדאי לאמת את כתובת האימייל')}
            </h2>
            <p className="text-sm text-ink-muted">
              {tr('שלחנו קישור אימות אל')}{' '}
              <span dir="ltr" className="break-all font-medium text-ink">
                {user.email}
              </span>
              {tr('. לא מצאתם את ההודעה? בדקו בתיקיית הספאם או שלחו אותה שוב.')}
            </p>
          </div>
          <ResendVerification email={user.email} />
        </div>
      </div>
    </section>
  );
}
