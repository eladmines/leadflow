import {
  apiPaths,
  type LoginRequest,
  type MeResponse,
  type PasswordResetConfirm,
  type PasswordResetRequest,
  type RegisterRequest,
  type VerifyEmailRequest,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../lib/api';

export const meQueryKey = ['auth', 'me'] as const;

const paths = apiPaths.auth;

const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** GET /me. A 401 means "anonymous" and resolves to `null`, never an error screen. */
async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await apiFetch<MeResponse>(paths.me);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, retry: false });
}

/**
 * Drops every cached query (other users' data must never survive a sign-out) and marks
 * the visitor as anonymous, so guards redirect without refetching `/me`.
 */
export function resetSessionCache(queryClient: QueryClient) {
  queryClient.clear();
  queryClient.setQueryData<MeResponse | null>(meQueryKey, null);
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => post<MeResponse>(paths.register, body),
    onSuccess: (data) => queryClient.setQueryData(meQueryKey, data),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => post<MeResponse>(paths.login, body),
    onSuccess: (data) => queryClient.setQueryData(meQueryKey, data),
  });
}

/** Callers navigate first, then call `resetSessionCache` (see AppHomePage). */
export function useLogout() {
  return useMutation({ mutationFn: () => post<void>(paths.logout) });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyEmailRequest) => post<void>(paths.verifyEmail, body),
    onSuccess: async () => {
      // A /me request that started before the verification would come back stale
      // (and an in-flight first fetch is deduped, not restarted), so cancel it first.
      await queryClient.cancelQueries({ queryKey: meQueryKey });
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: () => post<void>(paths.resendVerification) });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (body: PasswordResetRequest) => post<void>(paths.passwordResetRequest, body),
  });
}

/** Reset confirm revokes every session server-side; the caller resets the cache. */
export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (body: PasswordResetConfirm) => post<void>(paths.passwordResetConfirm, body),
  });
}
