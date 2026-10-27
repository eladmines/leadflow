import { authMessages } from '@leadflow/shared';
import type { ReactNode } from 'react';
import { AuthLayout } from '../../components/ui';

/** Missing, malformed, used or expired email link, with a way forward. */
export function InvalidLinkState({ children }: { children: ReactNode }) {
  return (
    <AuthLayout title="הקישור אינו תקף">
      <div className="flex flex-col gap-5">
        <div role="alert" className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-50 text-2xl text-warning-600"
          >
            !
          </span>
          <p className="text-sm text-ink">{authMessages.tokenInvalid}</p>
        </div>
        {children}
      </div>
    </AuthLayout>
  );
}
