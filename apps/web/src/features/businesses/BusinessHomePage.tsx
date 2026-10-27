import {
  businessWebPaths,
  formatIsraeliPhone,
  industryLabels,
  roleLabels,
  weekdayLabels,
  WEEKDAYS,
} from '@leadflow/shared';
import { Navigate, useParams } from 'react-router-dom';
import { SignedInHeader } from '../../components/SignedInHeader';
import { Alert, Card, FullPageSpinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useMe } from '../auth/api';
import { errorMessage } from '../auth/serverErrors';
import { UnverifiedEmailBanner } from '../auth/UnverifiedEmailBanner';
import { useBusiness } from './api';
import { BusinessNotFound } from './BusinessNotFound';

/**
 * `/b/:businessId`: the business's home. A simple page until the app shell and dashboard
 * arrive in F03; it shows the saved profile so the onboarding result is visible.
 */
export function BusinessHomePage() {
  const { businessId = '' } = useParams();
  const me = useMe();
  const business = useBusiness(businessId);

  if (business.isPending) return <FullPageSpinner label="טוענים את העסק…" />;
  if (business.isError) {
    if (business.error instanceof ApiError && business.error.status === 404) {
      return <BusinessNotFound />;
    }
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert tone="danger" title="לא הצלחנו לטעון את העסק">
          {errorMessage(business.error)}
        </Alert>
      </main>
    );
  }

  const b = business.data;
  if (b.status === 'ONBOARDING' && b.role === 'OWNER') {
    return <Navigate to={businessWebPaths.onboardingFor(b.id)} replace />;
  }

  const openDays = b.openingHours ? WEEKDAYS.filter((d) => b.openingHours?.[d].open) : [];

  return (
    <div className="min-h-screen">
      <SignedInHeader>
        <span className="truncate text-sm font-medium text-ink-muted">{b.name}</span>
      </SignedInHeader>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">
            שלום, {me.data?.user.fullName}
          </h1>
          <p className="text-sm text-ink-muted">
            {b.name} · {roleLabels[b.role]}
          </p>
        </div>

        <UnverifiedEmailBanner />

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">פרופיל העסק</h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-ink-muted">תחום</dt>
            <dd>{industryLabels[b.industry]}</dd>
            <dt className="text-ink-muted">טלפון</dt>
            <dd>{b.phone ? <bdi dir="ltr">{formatIsraeliPhone(b.phone)}</bdi> : 'לא הוזן'}</dd>
            <dt className="text-ink-muted">כתובת</dt>
            <dd>{b.address ?? 'לא הוזנה'}</dd>
            <dt className="text-ink-muted">אזורי שירות</dt>
            <dd>{b.serviceAreas.length ? b.serviceAreas.join(', ') : 'לא הוגדרו'}</dd>
            <dt className="text-ink-muted">ימי פעילות</dt>
            <dd>
              {openDays.length ? openDays.map((d) => weekdayLabels[d]).join(', ') : 'לא הוגדרו'}
            </dd>
          </dl>
        </Card>

        <Card className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-brand-600">מה הלאה?</p>
          <h2 className="text-lg font-semibold text-ink">בניית האתר של העסק</h2>
          <p className="text-sm text-ink-muted">
            העסק מוגדר. בשלבים הבאים נוסיף את סביבת העבודה המלאה ואת בונה האתרים, כדי שתוכלו לפרסם
            אתר ולהתחיל לקבל פניות.
          </p>
        </Card>
      </main>
    </div>
  );
}
