import { can, type Business, type Permission } from '@leadflow/shared';
import { shortcutLabel } from '../shell/CommandPalette';
import { navItems } from '../shell/nav';
import { Tour, type TourStep } from './Tour';

/**
 * Product tour (D-093): a few bubbles over the main menu, shown once per user on first entry and
 * replayable from "סיור במערכת". Steps follow the menu, so a role only sees screens it can open.
 */

interface MenuStep extends TourStep {
  /** `data-tour` value of the menu element to highlight. */
  menu?: string;
  permission?: Permission;
}

const STEPS: MenuStep[] = [
  {
    title: 'ברוכים הבאים ל-LeadFlow',
    body: 'סיור קצר של דקה: נראה איפה כל דבר נמצא. הכול נמצא בתפריט (בטלפון: כפתור התפריט למעלה). אפשר לדלג בכל רגע, ובכל עמוד יש גם "סיור בעמוד".',
  },
  {
    menu: 'dashboard',
    title: 'דשבורד',
    body: 'התמונה הכללית של העסק: פניות חדשות, משימות להיום והצעד הבא שכדאי לעשות.',
  },
  {
    menu: 'site',
    title: 'האתר שלי',
    body: 'בונים ועורכים את אתר העסק ישירות על העמוד ומפרסמים בלחיצה. כל פנייה מהאתר נכנסת למערכת.',
  },
  {
    menu: 'leads',
    title: 'לקוחות ולידים',
    body: 'כל הפניות במקום אחד: מהאתר, מוואטסאפ ומה שהוספתם ידנית. גוררים בין שלבים, משייכים לעובד ומוסיפים הערות.',
  },
  {
    menu: 'conversations',
    title: 'שיחות',
    body: 'מספרים חדשים שכתבו בוואטסאפ מחכים כאן. "עסקי" יוצר ליד, "פרטי" משאיר אותם מחוץ למערכת.',
  },
  {
    menu: 'tasks',
    title: 'משימות',
    body: 'תזכורות למעקב, למשל מתי לחזור ללקוח. מקבלים מייל כשמגיע הזמן.',
  },
  {
    menu: 'appointments',
    title: 'תורים',
    body: 'יומן התורים, ובקשות לתור שהגיעו מהאתר ומחכות לאישור.',
  },
  {
    menu: 'quotes',
    title: 'הצעות מחיר',
    body: 'הצעת מחיר מסודרת מתוך ליד, שליחה בקישור או בוואטסאפ, והלקוח מאשר אונליין.',
  },
  {
    menu: 'reports',
    title: 'דוחות',
    body: 'כמה פניות הגיעו, מאיפה, כמה מהר עניתם ומה נסגר.',
  },
  {
    menu: 'search',
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
    const item = navItems.find((i) => (i.segment || 'dashboard') === s.menu);
    const permission = s.permission ?? item?.permission;
    return !permission || can(role, permission);
  }).map(({ menu, title, body }) => ({
    title,
    body,
    target: menu ? `[data-tour="${menu}"]` : undefined,
  }));
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

export function ProductTour({
  role,
  open,
  onClose,
}: {
  role: Business['role'];
  open: boolean;
  onClose: () => void;
}) {
  return <Tour steps={tourSteps(role)} open={open} onClose={onClose} startLabel="יאללה, מתחילים" />;
}
