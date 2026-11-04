import * as Dialog from '@radix-ui/react-dialog';
import { businessWebPaths } from '@leadflow/shared';
import { Menu, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useMatch, useParams } from 'react-router-dom';
import { Alert, Button, FullPageSpinner, Logo } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { errorMessage } from '../auth/serverErrors';
import { UnverifiedEmailBanner } from '../auth/UnverifiedEmailBanner';
import { useBusiness } from '../businesses/api';
import { BusinessNotFound } from '../businesses/BusinessNotFound';
import type { BusinessOutletContext } from './CurrentBusiness';
import { CommandPalette, useCommandPaletteShortcut } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { markTourSeen, ProductTour, tourSeen } from '../tour/ProductTour';
import { pageTours, type PageKey } from '../tour/pageTours';
import { Tour } from '../tour/Tour';
import { HelpMenu } from '../tour/HelpMenu';
import { usePageKey } from '../tour/pageTours';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationToasts } from '../notifications/NotificationToasts';
import { tr } from '../../i18n';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';

/**
 * App shell for `/b/:businessId/*`: right-side sidebar on desktop, a drawer on mobile.
 * Loads the business once (membership is checked by the API: 404 → "not found").
 */
export function BusinessLayout() {
  const { businessId = '' } = useParams();
  const business = useBusiness(businessId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);
  const user = useMe().data?.user;
  const userId = user?.id;
  const [tourOpen, setTourOpen] = useState(false);
  const ready = business.data?.status === 'ACTIVE';
  // First entry to a working business: show the tour once (D-093).
  useEffect(() => {
    if (ready && userId && !tourSeen(userId)) setTourOpen(true);
  }, [ready, userId]);
  const closeTour = () => {
    setTourOpen(false);
    if (userId) markTourSeen(userId);
  };
  // The page tour that is running (D-096), started from the help button (D-104).
  const [pageTour, setPageTour] = useState<PageKey | null>(null);
  // The site editor needs the full width for its live preview.
  const wide = useMatch('/b/:businessId/site') !== null;
  const page = usePageKey();

  if (business.isPending) return <FullPageSpinner label={tr('טוענים את העסק…')} />;
  if (business.isError) {
    if (business.error instanceof ApiError && business.error.status === 404) {
      return <BusinessNotFound />;
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <Alert tone="danger" title={tr('לא הצלחנו לטעון את העסק')}>
          {errorMessage(business.error)}
        </Alert>
        <Button variant="secondary" onClick={() => void business.refetch()}>
          {tr('נסו שוב')}
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
        {tr('דילוג לתוכן הראשי')}
      </a>

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-e border-brand-100 bg-brand-50 lg:block">
        <Sidebar business={b} onSearch={openPalette} />
      </aside>
      <CommandPalette business={b} open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ProductTour role={b.role} open={tourOpen} onClose={closeTour} />
      <NotificationToasts businessId={b.id} userId={userId} />
      {pageTour && <Tour steps={pageTours[pageTour]} open onClose={() => setPageTour(null)} />}
      <HelpMenu
        name={user?.fullName.trim().split(/\s+/)[0]}
        busy={tourOpen || pageTour !== null}
        onPageTour={page && pageTours[page].length > 0 ? () => setPageTour(page) : null}
        onProductTour={() => setTourOpen(true)}
        onSearch={openPalette}
      />

      <div className="min-w-0 flex-1">
        <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-surface-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label={tr('פתיחת תפריט')}
                className="-ms-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface-muted"
              >
                <Menu aria-hidden className="h-5 w-5" />
              </button>
            </Dialog.Trigger>
            <Logo />
            <span className="ms-auto truncate text-sm font-medium text-ink-muted">{b.name}</span>
            <NotificationBell businessId={b.id} />
            <button
              type="button"
              aria-label={tr('חיפוש מהיר')}
              onClick={openPalette}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface-muted"
            >
              <Search aria-hidden className="h-5 w-5" />
            </button>
          </header>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm lg:hidden" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 start-0 z-50 w-[85vw] max-w-xs overflow-y-auto rounded-e-3xl bg-brand-50 shadow-lift focus:outline-none lg:hidden"
            >
              <Dialog.Title className="sr-only">{tr('תפריט ניווט')}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={tr('סגירת התפריט')}
                  className="absolute end-3 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted"
                >
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </Dialog.Close>
              <Sidebar
                business={b}
                onNavigate={closeMenu}
                inDrawer
                onSearch={() => {
                  closeMenu();
                  openPalette();
                }}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Desktop: the language flags at the top, opposite the sidebar (D-110). */}
        <div
          className={cn(
            'mx-auto hidden justify-end lg:flex',
            wide ? 'max-w-[1600px] px-8 pt-3' : 'max-w-6xl px-10 pt-3',
          )}
        >
          <LanguageSwitch />
        </div>

        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'mx-auto flex flex-col gap-6 px-4 py-6 focus:outline-none sm:px-6',
            // Room at the bottom so the help button never covers the last item.
            wide
              ? 'max-w-[1600px] pb-24 lg:px-8 lg:pb-24 lg:pt-1'
              : 'max-w-6xl pb-24 lg:px-10 lg:pb-24 lg:pt-3',
          )}
        >
          <UnverifiedEmailBanner />
          <Outlet context={context} />
        </main>
      </div>
    </div>
  );
}
