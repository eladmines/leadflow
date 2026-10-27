import { authWebPaths } from '@leadflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resetSessionCache, useLogout } from './api';
import { errorMessage } from './serverErrors';

/** Logout + leave the signed-in area (to `to`, default /login) + forget every cached query. */
export function useSignOut(to: string = authWebPaths.login) {
  const logout = useLogout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setError(null);
    try {
      await logout.mutateAsync();
      // Leave the guarded page first, then forget the session, so RequireAuth doesn't
      // bounce to /login?next=… on the way out.
      navigate(to, { replace: true });
      resetSessionCache(queryClient);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return { signOut, isPending: logout.isPending, error };
}
