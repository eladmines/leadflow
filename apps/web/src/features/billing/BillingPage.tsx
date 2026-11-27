import { can } from '@simplecatch/shared';
import { CreditCard } from 'lucide-react';
import { tr } from '../../i18n';
import { Section } from '../settings/SettingsPage';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';

/**
 * `/b/:businessId/billing` (D-206): the business's plan and billing, from the user menu. Owners
 * only (`business.update`); titled with the business's name, since billing belongs to it.
 */
export function BillingPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'business.update')) {
    return <NoPermission what={tr('מנוי והחיוב')} />;
  }
  return (
    <>
      <PageHeader title={tr('מנוי וחיוב')} description={<bdi>{business.name}</bdi>} />
      <div className="max-w-3xl">
        <Section title={tr('מנוי וחיוב')} icon={CreditCard} tone="bg-violet-500">
          <p className="text-sm text-ink-muted">
            {tr(
              'בחירת מסלול, אמצעי תשלום וחשבוניות יתווספו בהמשך. בינתיים החשבון פעיל בתקופת ניסיון.',
            )}
          </p>
        </Section>
      </div>
    </>
  );
}
