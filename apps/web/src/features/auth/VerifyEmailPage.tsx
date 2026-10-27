import { authWebPaths } from '@leadflow/shared';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AuthLayout, Button, buttonClasses, Spinner } from '../../components/ui';
import { loginPathWithNext } from '../../lib/safeNext';
import { ApiError } from '../../lib/api';
import { useMe, useVerifyEmail } from './api';
import { InvalidLinkState } from './InvalidLinkState';
import { ResendVerification } from './ResendVerification';
import { errorMessage } from './serverErrors';
import { useOneTimeToken } from './useOneTimeToken';

function VerifiedState() {
  return (
    <AuthLayout title="האימייל אומת">
      <div className="flex flex-col items-center gap-5 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-success-50 text-success-600"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p role="status" className="text-sm text-ink">
          תודה! כתובת האימייל שלך אומתה בהצלחה.
        </p>
        <Link to={authWebPaths.appHome} className={buttonClasses('primary', 'lg', 'w-full')}>
          המשך ל-LeadFlow
        </Link>
      </div>
    </AuthLayout>
  );
}

/**
 * Landing page of the verification email. Works signed in or not. The token is posted
 * exactly once: StrictMode re-runs effects, and a second POST of a used token gets 400.
 */
export function VerifyEmailPage() {
  const token = useOneTimeToken();
  const me = useMe();
  const verify = useVerifyEmail();
  const { mutate } = verify;
  const posted = useRef(false);

  useEffect(() => {
    if (!token || posted.current) return;
    posted.current = true;
    mutate({ token });
  }, [token, mutate]);

  const user = me.data?.user;

  if (verify.isSuccess) return <VerifiedState />;

  const tokenRejected = verify.error instanceof ApiError && verify.error.status === 400;
  if (!token || tokenRejected) {
    // A second click on an already-used link: if this browser shows the email as verified,
    // there is nothing to fix.
    if (user?.emailVerified) return <VerifiedState />;
    return (
      <InvalidLinkState>
        {user ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-ink-muted">
              אפשר לשלוח קישור אימות חדש אל{' '}
              <span dir="ltr" className="font-medium text-ink">
                {user.email}
              </span>
            </p>
            <ResendVerification email={user.email} variant="primary" />
            <Link to={authWebPaths.appHome} className={buttonClasses('ghost', 'md', 'w-full')}>
              המשך ל-LeadFlow
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-ink-muted">
              התחברו לחשבון כדי לשלוח לעצמכם קישור אימות חדש.
            </p>
            <Link
              to={loginPathWithNext(authWebPaths.appHome)}
              className={buttonClasses('primary', 'lg', 'w-full')}
            >
              כניסה לחשבון
            </Link>
          </div>
        )}
      </InvalidLinkState>
    );
  }

  if (verify.isError) {
    return (
      <AuthLayout title="אימות כתובת האימייל">
        <div className="flex flex-col gap-4">
          <Alert tone="danger" title="לא הצלחנו לאמת את הכתובת">
            {errorMessage(verify.error)}
          </Alert>
          <Button size="lg" className="w-full" onClick={() => mutate({ token })}>
            נסו שוב
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="אימות כתובת האימייל">
      <div role="status" className="flex flex-col items-center gap-3 py-6 text-brand-600">
        <Spinner label="" />
        <p className="text-sm text-ink-muted">מאמתים את כתובת האימייל…</p>
      </div>
    </AuthLayout>
  );
}
