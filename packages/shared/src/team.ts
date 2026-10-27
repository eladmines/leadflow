import { z } from 'zod';
import { AUTH_TOKEN_PATTERN, emailSchema } from './auth';

/**
 * F09 — Team invitations & member management. The owner invites by email with a role; the
 * invitee accepts while signed in with that exact email (the link alone is not enough).
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITES = 50;
/** Roles an owner can give. Ownership transfer is a separate, later flow. */
export const INVITABLE_ROLES = ['MANAGER', 'EMPLOYEE'] as const;
export const invitableRoleSchema = z.enum(INVITABLE_ROLES, {
  errorMap: () => ({ message: 'יש לבחור תפקיד' }),
});

export const teamMessages = {
  alreadyMember: 'האדם הזה כבר חבר בצוות',
  tooManyInvites: 'יש יותר מדי הזמנות פתוחות. בטלו חלק מהן ונסו שוב',
  cannotChangeOwner: 'אי אפשר לשנות או להסיר את בעל/ת העסק',
  inviteInvalid: 'ההזמנה אינה תקפה. בקשו מבעל/ת העסק לשלוח הזמנה חדשה',
  wrongAccount: 'ההזמנה נשלחה לכתובת אימייל אחרת. התחברו עם החשבון שאליו נשלחה ההזמנה',
} as const;

export const inviteRequestSchema = z.object({
  email: emailSchema,
  role: invitableRoleSchema,
});
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

export const invitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: invitableRoleSchema,
  invitedBy: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const invitationResponseSchema = z.object({ invitation: invitationSchema });
export const invitationListResponseSchema = z.object({ invitations: z.array(invitationSchema) });
export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>;

export const updateMemberRequestSchema = z.object({ role: invitableRoleSchema });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

/** Token travels in the body (never in a logged URL). */
export const inviteTokenRequestSchema = z.object({
  token: z.string().regex(AUTH_TOKEN_PATTERN, teamMessages.inviteInvalid),
});
export type InviteTokenRequest = z.infer<typeof inviteTokenRequestSchema>;

export const invitePreviewSchema = z.object({
  status: z.enum(['valid', 'expired', 'used', 'revoked']),
  businessName: z.string(),
  email: z.string(),
  role: invitableRoleSchema,
  invitedBy: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export const invitePreviewResponseSchema = z.object({ invite: invitePreviewSchema });

export const acceptInviteResponseSchema = z.object({ businessId: z.string().uuid() });
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

export const teamAuditActions = [
  'member.invited',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'invitation.revoked',
] as const;

export const teamApiPaths = {
  invitations: (businessId: string) => `/api/v1/businesses/${businessId}/invitations`,
  invitation: (businessId: string, inviteId: string) =>
    `/api/v1/businesses/${businessId}/invitations/${inviteId}`,
  resend: (businessId: string, inviteId: string) =>
    `/api/v1/businesses/${businessId}/invitations/${inviteId}/resend`,
  member: (businessId: string, userId: string) =>
    `/api/v1/businesses/${businessId}/members/${userId}`,
  preview: '/api/v1/invitations/preview',
  accept: '/api/v1/invitations/accept',
} as const;

/** Web page the invitation email links to (APP_URL + path + `?token=`). */
export const INVITE_WEB_PATH = '/invite';
