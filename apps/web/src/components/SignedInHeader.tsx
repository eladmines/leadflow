import type { ReactNode } from 'react';
import { useSignOut } from '../features/auth/useSignOut';
import { Alert, Button, Logo } from './ui';

/** Minimal top bar for signed-in pages until the app shell (F03) replaces it. */
export function SignedInHeader({ children }: { children?: ReactNode }) {
  const { signOut, isPending, error } = useSignOut();
  return (
    <header className="border-b border-surface-border bg-surface">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {children}
        </div>
        <Button variant="secondary" size="sm" loading={isPending} onClick={() => void signOut()}>
          התנתקות
        </Button>
      </div>
      {error && (
        <div className="mx-auto max-w-3xl px-4 pb-3">
          <Alert tone="danger" title="ההתנתקות נכשלה">
            {error}
          </Alert>
        </div>
      )}
    </header>
  );
}
