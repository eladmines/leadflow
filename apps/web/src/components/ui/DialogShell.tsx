import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Centered modal with a title and close button (focus trap, Escape, focus return via Radix). */
export function DialogShell({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-3xl bg-surface p-6 shadow-lift focus:outline-none rtl:translate-x-1/2 ltr:-translate-x-1/2 sm:p-8"
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-xl font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="סגירה"
                className="-me-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
