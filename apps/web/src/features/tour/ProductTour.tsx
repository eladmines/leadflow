import * as Dialog from '@radix-ui/react-dialog';
import { can, type Business, type Permission } from '@leadflow/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import { shortcutLabel } from '../shell/CommandPalette';
import { navItems } from '../shell/nav';

/**
 * Product tour (D-093): a few bubbles over the main menu, shown once per user on first entry and
 * replayable from "סיור במערכת". Steps follow the menu, so a role only sees screens it can open.
 */

interface TourStep {
  /** `data-tour` value of the element to highlight; none = a centred card. */
  target?: string;
  title: string;
  body: string;
  permission?: Permission;
}

const STEPS: TourStep[] = [
  {
    title: 'ברוכים הבאים ל-LeadFlow',
    body: 'סיור קצר של דקה: נראה איפה כל דבר נמצא. הכול נמצא בתפריט (בטלפון: כפתור התפריט למעלה). אפשר לדלג בכל רגע.',
  },
  {
    target: 'dashboard',
    title: 'דשבורד',
    body: 'התמונה הכללית של העסק: פניות חדשות, משימות להיום והצעד הבא שכדאי לעשות.',
  },
  {
    target: 'site',
    title: 'האתר שלי',
    body: 'בונים ועורכים את אתר העסק ישירות על העמוד ומפרסמים בלחיצה. כל פנייה מהאתר נכנסת למערכת.',
  },
  {
    target: 'leads',
    title: 'לקוחות ולידים',
    body: 'כל הפניות במקום אחד: מהאתר, מוואטסאפ ומה שהוספתם ידנית. גוררים בין שלבים, משייכים לעובד ומוסיפים הערות.',
  },
  {
    target: 'conversations',
    title: 'שיחות',
    body: 'מספרים חדשים שכתבו בוואטסאפ מחכים כאן. "עסקי" יוצר ליד, "פרטי" משאיר אותם מחוץ למערכת.',
  },
  {
    target: 'tasks',
    title: 'משימות',
    body: 'תזכורות למעקב, למשל מתי לחזור ללקוח. מקבלים מייל כשמגיע הזמן.',
  },
  {
    target: 'appointments',
    title: 'תורים',
    body: 'יומן התורים, ובקשות לתור שהגיעו מהאתר ומחכות לאישור.',
  },
  {
    target: 'quotes',
    title: 'הצעות מחיר',
    body: 'הצעת מחיר מסודרת מתוך ליד, שליחה בקישור או בוואטסאפ, והלקוח מאשר אונליין.',
  },
  {
    target: 'reports',
    title: 'דוחות',
    body: 'כמה פניות הגיעו, מאיפה, כמה מהר עניתם ומה נסגר.',
  },
  {
    target: 'search',
    title: 'חיפוש מהיר',
    body: `מחפשים לקוח או קופצים לכל מסך. אפשר גם בקיצור ${shortcutLabel}.`,
  },
  {
    title: 'זהו, אפשר להתחיל!',
    body: 'אפשר לחזור לסיור בכל זמן מהכפתור "סיור במערכת" בתחתית התפריט.',
  },
];

/** Steps this role can see: a menu step shows only when its menu item does. */
export function tourSteps(role: Business['role']): TourStep[] {
  return STEPS.filter((s) => {
    const item = navItems.find((i) => (i.segment || 'dashboard') === s.target);
    const permission = s.permission ?? item?.permission;
    return !permission || can(role, permission);
  });
}

// --- "Seen" flag: a per-viewer convenience in local storage (D-093). ------------------------

const seenKey = (userId: string) => `leadflow.tour.v1:${userId}`;
/** Set by automated tests so the tour never covers the screen they drive. */
export const TOUR_OFF_KEY = 'leadflow.tour.off';

export function tourSeen(userId: string): boolean {
  try {
    return (
      localStorage.getItem(TOUR_OFF_KEY) === '1' || localStorage.getItem(seenKey(userId)) === '1'
    );
  } catch {
    // Storage blocked (private mode): don't nag on every visit.
    return true;
  }
}

export function markTourSeen(userId: string) {
  try {
    localStorage.setItem(seenKey(userId), '1');
  } catch {
    // Storage blocked: nothing to remember.
  }
}

// --- Positioning --------------------------------------------------------------------------

const CARD_WIDTH = 320;
const GAP = 14;
const MARGIN = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The visible element for a step (the desktop sidebar; the mobile drawer is closed). */
function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function cardPosition(rect: Rect | null, cardHeight: number) {
  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Beside the target, on whichever side has room (the sidebar sits on the right in RTL).
  const leftSide = rect.left - GAP - CARD_WIDTH;
  const rightSide = rect.left + rect.width + GAP;
  const left = leftSide >= MARGIN ? leftSide : Math.min(rightSide, vw - CARD_WIDTH - MARGIN);
  const top = Math.min(
    Math.max(rect.top + rect.height / 2 - cardHeight / 2, MARGIN),
    vh - cardHeight - MARGIN,
  );
  return { left, top };
}

export function ProductTour({
  role,
  open,
  onClose,
}: {
  role: Business['role'];
  open: boolean;
  onClose: () => void;
}) {
  const steps = tourSteps(role);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const last = index >= steps.length - 1;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const measure = useCallback(() => {
    const el = findTarget(step.target);
    if (!el) return setRect(null);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.target]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, measure]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight || 200);
  }, [index, open]);

  const next = () => (last ? onClose() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));
  const pos = cardPosition(rect, cardHeight);
  const pad = 4;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {rect ? (
          // Spotlight: a hole around the highlighted item, the rest dimmed.
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
            {steps.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-500' : 'bg-surface-sunken'}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-muted">
              {index + 1} מתוך {steps.length}
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
                {index === 0 ? 'יאללה, מתחילים' : last ? 'סיום' : 'הבא'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
