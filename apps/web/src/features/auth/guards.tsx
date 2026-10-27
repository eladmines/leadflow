import { authWebPaths } from '@leadflow/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Alert, Button, FullPageSpinner } from '../../components/ui';
import { loginPathWithNext, sanitizeNext } from '../../lib/safeNext';
import { useMe } from './api';
import { errorMessage } from './serverErrors';

/** `/me` failed with something other than 401 (server down, network). */
function SessionCheckError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <Alert tone="danger" title="לא הצלחנו לבדוק את פרטי ההתחברות">
        {errorMessage(error)}
      </Alert>
      <Button variant="secondary" onClick={onRetry}>
        נסו שוב
      </Button>
    </main>
  );
}

/** Signed-in pages. Anonymous visitors go to `/login?next=<this page>`. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <FullPageSpinner label="בודקים את פרטי ההתחברות…" />;
  if (me.isError) return <SessionCheckError error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) {
    return <Navigate to={loginPathWithNext(location.pathname + location.search)} replace />;
  }
  return <>{children}</>;
}

/** Guest-only pages (login, register, forgot password). Signed-in users go to `next` or `/app`. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const me = useMe();
  const [params] = useSearchParams();

  if (me.isPending) return <FullPageSpinner />;
  if (me.data) return <Navigate to={sanitizeNext(params.get('next'))} replace />;
  // On a /me error the visitor can still use the form; the submit reports any outage.
  return <>{children}</>;
}

/** `/`: there is no public home page yet (D-025). */
export function RootRedirect() {
  const me = useMe();
  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) return <SessionCheckError error={me.error} onRetry={() => void me.refetch()} />;
  return <Navigate to={me.data ? authWebPaths.appHome : authWebPaths.login} replace />;
}
