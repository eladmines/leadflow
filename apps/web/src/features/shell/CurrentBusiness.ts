import type { Business } from '@leadflow/shared';
import { useOutletContext } from 'react-router-dom';

export interface BusinessOutletContext {
  business: Business;
}

/** The business loaded by BusinessLayout. Only valid inside `/b/:businessId/*` routes. */
export function useCurrentBusiness(): Business {
  return useOutletContext<BusinessOutletContext>().business;
}
