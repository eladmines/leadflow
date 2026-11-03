import { can, type Business, type Permission } from '@leadflow/shared';
import { shortcutLabel } from '../shell/CommandPalette';
import { navItems } from '../shell/nav';
import { Tour, type TourStep } from './Tour';
import { tr } from '../../i18n';

/**
 * Product tour (D-093): a few bubbles over the main menu, shown once per user on first entry and
 * replayable from the help button (D-104). Steps follow the menu, so a role only sees screens it can open.
 */

interface MenuStep extends TourStep {
  /** `data-tour` value of the menu element to highlight. */
  menu?: string;
  permission?: Permission;
}

const STEPS: MenuStep[] = [
  {
    title: tr('ברוכים הבאים ל-LeadFlow'),
    body: tr(
      'סיור קצר של דקה: נראה איפה כל דבר נמצא. הכול נמצא בתפריט (בטלפון: כפתור התפריט למעלה). אפשר לדלג בכל רגע, ובכפתור העזרה (?) בפינת המסך יש גם סיור לכל עמוד.',
    ),
  },
  {
    menu: 'dashboard',
    title: tr('דשבורד'),
    body: tr('התמונה הכללית של העסק: פניות חדשות, משימות להיום והצעד הבא שכדאי לעשות.'),
  },
  {
    menu: 'site',
    title: tr('האתר שלי'),
    body: tr(
      'בונים ועורכים את אתר העסק ישירות על העמוד ומפרסמים בלחיצה. כל פנייה מהאתר נכנסת למערכת.',
    ),
  },
  {
    menu: 'leads',
    title: tr('לקוחות ולידים'),
    body: tr(
      'כל הפניות במקום אחד: מהאתר, מוואטסאפ ומה שהוספתם ידנית. גוררים בין שלבים, משייכים לעובד ומוסיפים הערות.',
    ),
  },
  {
    menu: 'conversations',
    title: tr('שיחות'),
    body: tr(
      'מספרים חדשים שכתבו בוואטסאפ מחכים כאן. "עסקי" יוצר ליד, "פרטי" משאיר אותם מחוץ למערכת.',
    ),
  },
  {
    menu: 'tasks',
    title: tr('משימות'),
    body: tr('תזכורות למעקב, למשל מתי לחזור ללקוח. מקבלים מייל כשמגיע הזמן.'),
  },
  {
    menu: 'appointments',
    title: tr('תורים'),
    body: tr('יומן התורים, ובקשות לתור שהגיעו מהאתר ומחכות לאישור.'),
  },
  {
    menu: 'quotes',
    title: tr('הצעות מחיר'),
    body: tr('הצעת מחיר מסודרת מתוך ליד, שליחה בקישור או בוואטסאפ, והלקוח מאשר אונליין.'),
  },
  {
    menu: 'reports',
    title: tr('דוחות'),
    body: tr('כמה פניות הגיעו, מאיפה, כמה מהר עניתם ומה נסגר.'),
  },
  {
    menu: 'search',
    title: tr('חיפוש מהיר'),
    body: tr('מחפשים לקוח או קופצים לכל מסך. אפשר גם בקיצור {0}.', shortcutLabel),
  },
  {
    title: tr('זהו, אפשר להתחיל!'),
    body: tr('אפשר לחזור לסיור בכל זמן מכפתור העזרה (?) בפינת המסך.'),
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
  return (
    <Tour steps={tourSteps(role)} open={open} onClose={onClose} startLabel={tr('יאללה, מתחילים')} />
  );
}
