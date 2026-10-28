import * as Dialog from '@radix-ui/react-dialog';
import { businessWebPaths } from '@leadflow/shared';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Navigate, Outlet, useMatch, useParams } from 'react-router-dom';
import { Alert, Button, FullPageSpinner, Logo } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { UnverifiedEmailBanner } from '../auth/UnverifiedEmailBanner';
import { useBusiness } from '../businesses/api';
import { BusinessNotFound } from '../businesses/BusinessNotFound';
import type { BusinessOutletContext } from './CurrentBusiness';
import { Sidebar } from './Sidebar';

/**
 * App shell for `/b/:businessId/*`: right-side sidebar on desktop, a drawer on mobile.
 * Loads the business once (membership is checked by the API: 404 → "not found").
 */
export function BusinessLayout() {
  const { businessId = '' } = useParams();
  const business = useBusiness(businessId);
  const [menuOpen, setMenuOpen] = useState(false);
  // The site editor needs the full width for its live preview.
  const wide = useMatch('/b/:businessId/site') !== null;

  if (business.isPending) return <FullPageSpinner label="טוענים את העסק…" />;
  if (business.isError) {
    if (business.error instanceof ApiError && business.error.status === 404) {
      return <BusinessNotFound />;
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <Alert tone="danger" title="לא הצלחנו לטעון את העסק">
          {errorMessage(business.error)}
        </Alert>
        <Button variant="secondary" onClick={() => void business.refetch()}>
          נסו שוב
        </Button>
      </main>
    );
  }

  const b = business.data;
  if (b.status === 'ONBOARDING' && b.role === 'OWNER') {
    return <Navigate to={businessWebPaths.onboardingFor(b.id)} replace />;
  }
  const context: BusinessOutletContext = { business: b };
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        דילוג לתוכן הראשי
      </a>

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-e border-surface-border bg-surface-muted lg:block">
        <Sidebar business={b} />
      </aside>

      <div className="min-w-0 flex-1">
        <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-surface-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label="פתיחת תפריט"
                className="-ms-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface-muted"
              >
                <Menu aria-hidden className="h-5 w-5" />
              </button>
            </Dialog.Trigger>
            <Logo />
            <span className="ms-auto truncate text-sm font-medium text-ink-muted">{b.name}</span>
          </header>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm lg:hidden" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 start-0 z-50 w-[85vw] max-w-xs overflow-y-auto rounded-e-3xl bg-surface shadow-lift focus:outline-none lg:hidden"
            >
              <Dialog.Title className="sr-only">תפריט ניווט</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="סגירת התפריט"
                  className="absolute end-3 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted"
                >
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </Dialog.Close>
              <Sidebar business={b} onNavigate={closeMenu} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'mx-auto flex flex-col gap-6 px-4 py-6 focus:outline-none sm:px-6',
            wide ? 'max-w-[1600px] lg:px-8 lg:py-6' : 'max-w-6xl lg:px-10 lg:py-8',
          )}
        >
          <UnverifiedEmailBanner />
          <Outlet context={context} />
        </main>
      </div>
    </div>
  );
}
