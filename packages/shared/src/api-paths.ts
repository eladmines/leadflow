import { authApiPaths } from './auth';

export const API_PREFIX = '/api/v1';

/**
 * Every API path, grouped by feature. Neither the API nor the web hardcodes path strings.
 * Tenant-scoped paths (F02+) will be functions of `businessId`.
 */
export const apiPaths = {
  auth: authApiPaths,
} as const;
