import { authApiPaths } from './auth';
import { businessApiPaths } from './business';
import { siteApiPaths } from './site';
import { leadsApiPaths } from './leads';
import { teamApiPaths } from './team';
import { mediaApiPaths } from './media';

export const API_PREFIX = '/api/v1';

/**
 * Every API path, grouped by feature. Neither the API nor the web hardcodes path strings.
 * Tenant-scoped paths (F02+) will be functions of `businessId`.
 */
export const apiPaths = {
  auth: authApiPaths,
  businesses: businessApiPaths,
  site: siteApiPaths,
  leads: leadsApiPaths,
  team: teamApiPaths,
  media: mediaApiPaths,
} as const;
