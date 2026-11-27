import { businessWebPaths } from '@simplecatch/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { tr } from '../../i18n';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { LeadFieldsSection } from './LeadFieldsSection';

/**
 * `/b/:businessId/leads/fields` (D-206): the business's own lead fields, set up where they're used.
 * Owners and managers (`leadFields.manage`); others get the no-permission state from the section.
 */
export function LeadFieldsPage() {
  const business = useCurrentBusiness();
  return (
    <>
      <Link
        to={businessWebPaths.section(business.id, 'leads')}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
        {tr('כל הלידים')}
      </Link>
      <PageHeader title={tr('שדות לידים')} />
      <div className="max-w-3xl">
        <LeadFieldsSection />
      </div>
    </>
  );
}
