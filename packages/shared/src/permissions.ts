import { z } from 'zod';

/** Fixed roles in the MVP (D-008). Teams and custom permissions are an open decision (O-003). */
export const ROLES = ['OWNER', 'MANAGER', 'EMPLOYEE'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const roleLabels: Record<Role, string> = {
  OWNER: 'בעל/ת העסק',
  MANAGER: 'מנהל/ת צוות',
  EMPLOYEE: 'עובד/ת',
};

/**
 * Permission matrix, enforced on the server (`requirePermission`). The web uses `can()` only to
 * hide controls; hiding is never the protection. Source: PRD §17.1 and §20.
 */
export const PERMISSIONS = {
  'business.view': ['OWNER', 'MANAGER', 'EMPLOYEE'],
  /** PRD §17.1: the owner manages business details, site, subscription, team and settings. */
  'business.update': ['OWNER'],
  'members.view': ['OWNER', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
