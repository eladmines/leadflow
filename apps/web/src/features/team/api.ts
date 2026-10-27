import {
  apiPaths,
  type AcceptInviteResponse,
  type InvitationListResponse,
  type InvitePreview,
  type InviteRequest,
  type UpdateMemberRequest,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { meQueryKey } from '../auth/api';
import { businessesQueryKey, businessQueryKey } from '../businesses/api';

const tp = apiPaths.team;
const invitationsKey = (businessId: string) =>
  [...businessQueryKey(businessId), 'invitations'] as const;
const membersKey = (businessId: string) => [...businessQueryKey(businessId), 'members'] as const;

export function useInvitations(businessId: string, enabled: boolean) {
  return useQuery({
    queryKey: invitationsKey(businessId),
    queryFn: () => apiFetch<InvitationListResponse>(tp.invitations(businessId)),
    select: (d) => d.invitations,
    enabled,
  });
}

/** Mutations on the team refresh both the members and the invitations lists. */
function useTeamMutation<T>(businessId: string, fn: (vars: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationsKey(businessId) });
      void queryClient.invalidateQueries({ queryKey: membersKey(businessId) });
    },
  });
}

const json = (method: string, body?: unknown) => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const useInvite = (businessId: string) =>
  useTeamMutation(businessId, (body: InviteRequest) =>
    apiFetch(tp.invitations(businessId), json('POST', body)),
  );
export const useResendInvite = (businessId: string) =>
  useTeamMutation(businessId, (id: string) => apiFetch(tp.resend(businessId, id), json('POST')));
export const useRevokeInvite = (businessId: string) =>
  useTeamMutation(businessId, (id: string) =>
    apiFetch(tp.invitation(businessId, id), json('DELETE')),
  );
export const useChangeRole = (businessId: string) =>
  useTeamMutation(businessId, ({ userId, ...body }: UpdateMemberRequest & { userId: string }) =>
    apiFetch(tp.member(businessId, userId), json('PATCH', body)),
  );
export const useRemoveMember = (businessId: string) =>
  useTeamMutation(businessId, (userId: string) =>
    apiFetch(tp.member(businessId, userId), json('DELETE')),
  );

export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => apiFetch<{ invite: InvitePreview }>(tp.preview, json('POST', { token })),
    select: (d) => d.invite,
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<AcceptInviteResponse>(tp.accept, json('POST', { token })),
    // Joining also verifies the email (the link proved the inbox), so refresh the user too.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: businessesQueryKey }),
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
      ]);
    },
  });
}
