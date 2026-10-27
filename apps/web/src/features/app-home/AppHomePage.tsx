import { authWebPaths } from '@leadflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Logo } from '../../components/ui';
import { resetSessionCache, useLogout, useMe } from '../auth/api';
import { errorMessage } from '../auth/serverErrors';
import { UnverifiedEmailBanner } from '../auth/UnverifiedEmailBanner';

/**
 * Signed-in landing page (`/app`, behind RequireAuth). A placeholder until F02 adds
 * onboarding and F03 adds the app shell (which will host the banner and logout).
 */
export function AppHomePage() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const user = me.data?.user;

  const onLogout = async () => {
    setLogoutError(null);
    try {
      await logout.mutateAsync();
      // Leave the guarded page first, then forget the session, so RequireAuth doesn't
      // bounce to /login?next=/app on the way out.
      navigate(authWebPaths.login, { replace: true });
      resetSessionCache(queryClient);
    } catch (err) {
      setLogoutError(errorMessage(err));
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-surface-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <Button variant="secondary" size="sm" loading={logout.isPending} onClick={onLogout}>
            התנתקות
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
        {logoutError && (
          <Alert tone="danger" title="ההתנתקות נכשלה">
            {logoutError}
          </Alert>
        )}

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">שלום, {user.fullName}</h1>
          <p className="text-sm text-ink-muted">
            מחובר/ת בתור {user.fullName} (
            <span dir="ltr" className="break-all">
              {user.email}
            </span>
            )
          </p>
        </div>

        <UnverifiedEmailBanner />

        <Card className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-brand-600">מה הלאה?</p>
          <h2 className="text-lg font-semibold text-ink">השלב הבא: הקמת העסק שלך</h2>
          <p className="text-sm text-ink-muted">
            בקרוב תוכלו להגדיר כאן את פרטי העסק, לבנות אתר ולהתחיל לקבל לידים. אנחנו עובדים על זה —
            החשבון שלך כבר מוכן.
          </p>
        </Card>
      </main>
    </div>
  );
}
