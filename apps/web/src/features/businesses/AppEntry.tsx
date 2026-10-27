import { businessWebPaths } from '@leadflow/shared';
import { Navigate } from 'react-router-dom';
import { Alert, Button, FullPageSpinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useBusinesses } from './api';

/**
 * `/app`: sends a signed-in user to the right place (F02).
 * No business → create one · first business still onboarding (owner) → resume · else → its home.
 */
export function AppEntry() {
  const businesses = useBusinesses();

  if (businesses.isPending) return <FullPageSpinner label="טוענים את העסקים שלך…" />;
  if (businesses.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <Alert tone="danger" title="לא הצלחנו לטעון את העסקים שלך">
          {errorMessage(businesses.error)}
        </Alert>
        <Button variant="secondary" onClick={() => void businesses.refetch()}>
          נסו שוב
        </Button>
      </main>
    );
  }

  const first = businesses.data[0];
  if (!first) return <Navigate to={businessWebPaths.onboarding} replace />;
  if (first.status === 'ONBOARDING' && first.role === 'OWNER') {
    return <Navigate to={businessWebPaths.onboardingFor(first.id)} replace />;
  }
  return <Navigate to={businessWebPaths.home(first.id)} replace />;
}
