import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';

/**
 * Generic guided tour (D-093, D-096): a dialog bubble per step, with a spotlight on the step's
 * element. Steps whose element isn't on the page right now (an empty list, a hidden panel) are
 * skipped; an element without size (phones, where the sidebar is hidden) gets a centred card.
 */

/** A CSS selector, or a function that finds the element when the tour opens. */
export type TourTarget = string | (() => HTMLElement | null);

export interface TourStep {
  target?: TourTarget;
  title: string;
  body: string;
}

const CARD_WIDTH = 320;
const GAP = 14;
const MARGIN = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const outsideDialogs = (el: Element) => !el.closest('[role="dialog"]');
const hasSize = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** The element for a step; a visible one when there are several (sidebar vs. drawer). */
export function resolveTarget(target: TourTarget | undefined): HTMLElement | null {
  if (!target) return null;
  if (typeof target === 'function') return target();
  const all = [...document.querySelectorAll<HTMLElement>(target)].filter(outsideDialogs);
  return all.find(hasSize) ?? all[0] ?? null;
}

/** Where the bubble goes: beside the element if there's room, else below or above, else bottom. */
function cardPosition(rect: Rect, cardHeight: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - MARGIN * 2);
  const clampLeft = (x: number) => Math.min(Math.max(x, MARGIN), vw - width - MARGIN);
  const clampTop = (y: number) => Math.min(Math.max(y, MARGIN), vh - cardHeight - MARGIN);
  const middleY = rect.top + rect.height / 2 - cardHeight / 2;

  if (rect.left - GAP - width >= MARGIN) {
    return { left: rect.left - GAP - width, top: clampTop(middleY) };
  }
  if (rect.left + rect.width + GAP + width <= vw - MARGIN) {
    return { left: rect.left + rect.width + GAP, top: clampTop(middleY) };
  }
  const centredX = clampLeft(rect.left + rect.width / 2 - width / 2);
  if (rect.top + rect.height + GAP + cardHeight <= vh - MARGIN) {
    return { left: centredX, top: rect.top + rect.height + GAP };
  }
  if (rect.top - GAP - cardHeight >= MARGIN) {
    return { left: centredX, top: rect.top - GAP - cardHeight };
  }
  return { left: clampLeft((vw - width) / 2), top: vh - cardHeight - MARGIN };
}

export function Tour({
  steps,
  open,
  onClose,
  startLabel = 'הבא',
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  /** Label of the forward button on the first step. */
  startLabel?: string;
}) {
  // Steps resolved when the tour opens: ones pointing at missing elements are dropped.
  const [active, setActive] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setActive(steps.filter((s) => !s.target || resolveTarget(s.target)));
    setIndex(0);
    // Resolve once per opening; the page doesn't re-render the tour's steps meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const step = active[Math.min(index, active.length - 1)];
  const last = index >= active.length - 1;

  const measure = useCallback(() => {
    const el = step ? resolveTarget(step.target) : null;
    if (!el || !hasSize(el)) return setRect(null);
    const before = el.getBoundingClientRect();
    if (before.top < 0 || before.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center' });
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight || 200);
  }, [index, open, active]);

  if (!step) return null;
  const next = () => (last ? onClose() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));
  const pos = rect ? cardPosition(rect, cardHeight) : null;
  const pad = 4;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {rect ? (
          // Spotlight: a hole around the highlighted element, the rest dimmed.
          <div
            aria-hidden
            className="pointer-events-none fixed z-40 rounded-xl ring-2 ring-brand-500 transition-all duration-200 motion-reduce:transition-none"
            style={{
              top: rect.top - pad,
              left: rect.left - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
              boxShadow: '0 0 0 9999px rgb(15 23 42 / 0.55)',
            }}
          />
        ) : (
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/55" />
        )}
        <Dialog.Content
          ref={cardRef}
          aria-describedby="tour-body"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            nextRef.current?.focus();
          }}
          onKeyDown={(e) => {
            // RTL: the left arrow moves forward.
            if (e.key === 'ArrowLeft') next();
            if (e.key === 'ArrowRight') prev();
          }}
          className={
            pos
              ? 'fixed z-50 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-3 rounded-2xl bg-surface p-5 shadow-lift focus:outline-none'
              : 'fixed start-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-sm -translate-y-1/2 flex-col gap-3 rounded-2xl bg-surface p-6 shadow-lift focus:outline-none rtl:translate-x-1/2 ltr:-translate-x-1/2'
          }
          style={pos ? { top: pos.top, left: pos.left } : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold text-ink">{step.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="סגירת הסיור"
                className="-me-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <p id="tour-body" className="text-sm leading-relaxed text-ink-muted">
            {step.body}
          </p>
          <div aria-hidden className="flex gap-1">
            {active.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-500' : 'bg-surface-sunken'}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-muted">
              {index + 1} מתוך {active.length}
            </span>
            <div className="flex items-center gap-2">
              {index === 0 ? (
                <Button size="sm" variant="ghost" onClick={onClose}>
                  דילוג
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={prev}>
                  הקודם
                </Button>
              )}
              <Button ref={nextRef} size="sm" onClick={next}>
                {last ? 'סיום' : index === 0 ? startLabel : 'הבא'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
