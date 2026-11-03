import { useLocation } from 'react-router-dom';
import type { TourStep } from './Tour';
import { tr } from '../../i18n';

/**
 * Page tours (D-096): a short tour per screen, started from "סיור בעמוד". Steps point at what the
 * page already shows (headings, labelled lists and buttons), so a step whose element isn't there
 * right now (an empty list, a role without access) is simply skipped.
 */

export type PageKey =
  | 'dashboard'
  | 'site'
  | 'leads'
  | 'lead'
  | 'conversations'
  | 'tasks'
  | 'appointments'
  | 'quotes'
  | 'reports'
  | 'team'
  | 'quote'
  | 'settings'
  | 'account';

/** The page under `/b/:businessId/…`, or null for screens without a tour. */
export function pageKeyFor(pathname: string): PageKey | null {
  const [, , , section = '', sub] = pathname.split('/');
  if (section === '') return 'dashboard';
  if (section === 'leads') return sub ? 'lead' : 'leads';
  if (section === 'quotes') return sub ? 'quote' : 'quotes';
  const known: PageKey[] = [
    'site',
    'conversations',
    'tasks',
    'appointments',
    'reports',
    'team',
    'settings',
    'account',
  ];
  return (known as string[]).includes(section) ? (section as PageKey) : null;
}

export function usePageKey(): PageKey | null {
  return pageKeyFor(useLocation().pathname);
}

// --- Finding elements -------------------------------------------------------------------------

const inPage = (el: Element) => !el.closest('[role="dialog"]');
const sized = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const pick = (els: HTMLElement[]) => {
  const list = els.filter(inPage);
  return list.find(sized) ?? list[0] ?? null;
};

/** The card or section that a heading titles. */
const card = (title: string) => () => {
  const heading = pick(
    [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3')].filter(
      (h) => h.textContent?.trim() === title,
    ),
  );
  return heading?.closest<HTMLElement>('.shadow-card, section, article') ?? heading;
};

/** A button or link by its visible text (`exact` for short labels like "פרטי"). */
const button =
  (text: string, exact = false) =>
  () =>
    pick(
      [...document.querySelectorAll<HTMLElement>('main button, main a')].filter((b) => {
        const t = b.textContent?.trim() ?? '';
        return exact ? t === text : t.includes(text);
      }),
    );

/** The card that contains an element (e.g. the table of quote lines). */
const cardOf = (css: string) => () => {
  const el = pick([...document.querySelectorAll<HTMLElement>(css)]);
  return el?.closest<HTMLElement>('.shadow-card') ?? el;
};

/** The header section around the page's main title. */
const pageTop = () => {
  const h1 = pick([...document.querySelectorAll<HTMLElement>('main h1')]);
  return h1?.closest<HTMLElement>('section') ?? h1?.parentElement ?? null;
};

// --- The tours --------------------------------------------------------------------------------

export const pageTours: Record<PageKey, TourStep[]> = {
  dashboard: [
    {
      target: pageTop,
      title: tr('הדשבורד'),
      body: tr('מה קורה בעסק במבט אחד. למעלה מופיע הצעד הבא שכדאי לעשות, עם כפתור ישיר אליו.'),
    },
    {
      target: card(tr('הצעדים להפעלת העסק')),
      title: tr('הצעדים להפעלת העסק'),
      body: tr('רשימת ההקמה: מה כבר הושלם ומה נשאר. כל צעד מסומן לבד כשמסיימים אותו.'),
    },
    {
      target: card(tr('פניות אחרונות')),
      title: tr('פניות אחרונות'),
      body: tr('הפניות החדשות ביותר מהאתר ומוואטסאפ. לחיצה על פנייה פותחת את הליד.'),
    },
    {
      target: card(tr('המשימות שלי להיום')),
      title: tr('המשימות שלי להיום'),
      body: tr('מה צריך לעשות היום ומה באיחור, כדי ששום לקוח לא ייפול בין הכיסאות.'),
    },
    {
      target: card(tr('פרופיל העסק')),
      title: tr('פרופיל העסק'),
      body: tr('טלפון, כתובת, שעות ואזורי שירות. הפרטים האלה מופיעים גם באתר.'),
    },
  ],
  site: [
    {
      target: card(tr('בואו נבנה את האתר שלך')),
      title: tr('בונים אתר'),
      body: tr('בוחרים תבנית, והיא מתמלאת מראש בפרטי העסק ובתמונות לדוגמה. אחר כך משנים הכול.'),
    },
    {
      target: card(tr('כבר יש לעסק אתר?')),
      title: tr('כבר יש לכם אתר?'),
      body: tr('אפשר להוסיף את הכתובת שלו כדי לראות אותו כאן. LeadFlow לא ינהל אותו.'),
    },
    {
      target: card(tr('האתר הקיים של העסק')),
      title: tr('האתר הקיים'),
      body: tr('האתר שכבר יש לעסק, לצפייה בלבד. שינויים בו נעשים אצל מי שבנה אותו.'),
    },
    {
      target: `[aria-label="${tr('כלי עריכה')}"]`,
      title: tr('כלי העריכה'),
      body: tr('עמודי האתר, הוספת מקטעים, מקטעים מוסתרים וגודל המסך (מחשב או טלפון).'),
    },
    {
      target: `[aria-label="${tr('תצוגה מקדימה')}"]`,
      title: tr('עורכים ישירות על העמוד'),
      body: tr(
        'לוחצים על כל טקסט כדי לכתוב, על תמונה כדי להחליף, ועל מקטע כדי לשנות את העיצוב שלו. הכול נשמר לבד.',
      ),
    },
    {
      target: button(tr('פרסום')),
      title: tr('פרסום'),
      body: tr('השינויים עולים לאוויר רק אחרי פרסום. עד אז האתר החי לא משתנה.'),
    },
    {
      target: button(tr('היסטוריה')),
      title: tr('היסטוריה'),
      body: tr('כל פרסום נשמר כגרסה. אפשר לחזור לגרסה קודמת או להוריד את האתר מהאוויר.'),
    },
    {
      target: button(tr('אפשרויות')),
      title: tr('אפשרויות'),
      body: tr('החלפת תבנית, או מחיקת האתר כדי לחזור לאתר קיים.'),
    },
  ],
  leads: [
    {
      target: button(tr('ליד חדש')),
      title: tr('ליד חדש'),
      body: tr('פניות מהאתר ומוואטסאפ נכנסות לבד. כאן מוסיפים ליד ידנית, למשל מטלפון.'),
    },
    {
      target: '[role="search"]',
      title: tr('חיפוש וסינון'),
      body: tr('מחפשים לפי שם, טלפון או אימייל, ומסננים לפי שלב, אחראי, מקור או תגית.'),
    },
    {
      target: `[aria-label="${tr('תצוגה')}"]`,
      title: tr('לוח או רשימה'),
      body: tr('בלוח רואים את הלידים לפי שלב וגוררים ביניהם. ברשימה רואים יותר פרטים על כל ליד.'),
    },
    {
      target: `[aria-label="${tr('לוח לידים')}"], [aria-label="${tr('פניות')}"]`,
      title: tr('הלידים'),
      body: tr('לחיצה על שם פותחת את הליד: פרטים, הערות, משימות, תורים, הצעות מחיר ושיחת וואטסאפ.'),
    },
    {
      target: button(tr('ייצוא לאקסל')),
      title: tr('ייצוא לאקסל'),
      body: tr('מורידים את הלידים (לפי הסינון הנוכחי) לקובץ שנפתח באקסל.'),
    },
  ],
  lead: [
    {
      target: pageTop,
      title: tr('כרטיס הליד'),
      body: tr('מי הלקוח, מאיפה הגיע ומה ביקש. כפתורי החיוג והאימייל פותחים שיחה בלחיצה.'),
    },
    {
      target: card(tr('פרטי הטיפול')),
      title: tr('פרטי הטיפול'),
      body: tr('השלב בתהליך, מי אחראי, ערך משוער, מתי לחזור ללקוח ותגיות.'),
    },
    {
      target: card('WhatsApp'),
      title: tr('שיחת וואטסאפ'),
      body: tr('השיחה עם הלקוח בוואטסאפ. אפשר לענות מכאן עד 24 שעות מההודעה האחרונה שלו.'),
    },
    {
      target: card(tr('הערות והיסטוריה')),
      title: tr('הערות והיסטוריה'),
      body: tr('כותבים הערות לצוות, ורואים כל מה שקרה בליד: שינויי שלב, שיוכים, משימות והצעות.'),
    },
    {
      target: card(tr('משימות')),
      title: tr('משימות'),
      body: tr('תזכורת לחזור ללקוח. מקבלים מייל כשמגיע הזמן.'),
    },
    {
      target: card(tr('תורים')),
      title: tr('תורים'),
      body: tr('התורים של הלקוח, וקביעת תור חדש.'),
    },
    {
      target: card(tr('הצעות מחיר')),
      title: tr('הצעות מחיר'),
      body: tr('יוצרים הצעת מחיר מתוך הליד ושולחים ללקוח בקישור.'),
    },
  ],
  conversations: [
    {
      title: tr('שיחות WhatsApp'),
      body: tr('מספרים חדשים שכתבו לעסק בוואטסאפ מחכים כאן, עד שתחליטו אם זה לקוח או מישהו פרטי.'),
    },
    {
      target: `[aria-label="${tr('מספרים שמחכים לסיווג')}"]`,
      title: tr('מחכים לסיווג'),
      body: tr(
        'כל מספר עם ההודעות שלו. לקוחות מוכרים לא מגיעים לכאן: ההודעות שלהם נכנסות ישר לליד.',
      ),
    },
    {
      target: button(tr('עסקי: יצירת ליד')),
      title: tr('עסקי'),
      body: tr('יוצר ליד מההודעות. מעכשיו כל הודעה מהמספר הזה תיכנס לליד שלו.'),
    },
    {
      target: button(tr('פרטי'), true),
      title: tr('פרטי'),
      body: tr('ההודעות נמחקות, והמספר לא ייכנס למערכת גם בהמשך. מתאים לבני משפחה וחברים.'),
    },
    {
      target: 'main details',
      title: tr('מספרים פרטיים'),
      body: tr('המספרים שסימנתם כפרטיים. אפשר לבטל סימון אם טעיתם.'),
    },
  ],
  tasks: [
    {
      target: `[aria-label="${tr('משימה חדשה')}"]`,
      title: tr('משימה חדשה'),
      body: tr('מה צריך לעשות ומתי. אפשר לשייך לעובד, ומקבלים מייל כשמגיע הזמן.'),
    },
    {
      target: `[aria-label="${tr('של מי')}"]`,
      title: tr('של מי'),
      body: tr('המשימות שלכם או של כל הצוות.'),
    },
    {
      target: 'main ul',
      title: tr('הרשימה'),
      body: tr('באיחור, היום והלאה. מסמנים משימה כבוצעה בלחיצה.'),
    },
  ],
  appointments: [
    {
      target: button(tr('תור חדש')),
      title: tr('תור חדש'),
      body: tr('קובעים תור ללקוח: שירות, איש צוות ושעה. המערכת לא תאפשר שני תורים באותה שעה.'),
    },
    {
      target: button(tr('שירותים')),
      title: tr('שירותים'),
      body: tr('השירותים שהעסק נותן, עם משך ומחיר. הם מופיעים גם בבקשת התור באתר.'),
    },
    {
      target: `[aria-label="${tr('תצוגה')}"]`,
      title: tr('יום או שבוע'),
      body: tr('בוחרים איך לראות את היומן, ועוברים בין ימים או שבועות בחיצים.'),
    },
    {
      target: `[aria-label="${tr('סינון לפי איש צוות')}"]`,
      title: tr('לפי איש צוות'),
      body: tr('רואים את היומן של כל הצוות או של אדם אחד.'),
    },
  ],
  quotes: [
    {
      title: tr('הצעות מחיר'),
      body: tr('כל ההצעות של העסק. הצעה חדשה נוצרת מתוך ליד, בכפתור "הצעת מחיר חדשה" בכרטיס הליד.'),
    },
    {
      target: `[aria-label="${tr('סינון לפי סטטוס')}"]`,
      title: tr('סינון לפי סטטוס'),
      body: tr('טיוטות, הצעות שנשלחו, אושרו או נדחו.'),
    },
    {
      target: 'main table',
      title: tr('הרשימה'),
      body: tr('לחיצה על הצעה פותחת אותה לעריכה, לשליחה או להדפסה.'),
    },
  ],
  reports: [
    {
      target: `[aria-label="${tr('טווח זמן')}"]`,
      title: tr('טווח זמן'),
      body: tr('7, 30 או 90 הימים האחרונים, בהשוואה לתקופה שלפניהם.'),
    },
    {
      target: `[aria-label="${tr('פניות לאורך זמן')}"]`,
      title: tr('פניות לאורך זמן'),
      body: tr('כמה פניות הגיעו בכל יום.'),
    },
    {
      target: card(tr('פניות לפי שלב')),
      title: tr('פניות לפי שלב'),
      body: tr('כמה לידים נמצאים בכל שלב, ואיפה הם נתקעים.'),
    },
    {
      target: card(tr('מאיפה הגיעו הפניות')),
      title: tr('מאיפה הגיעו'),
      body: tr('האתר, וואטסאפ או הזנה ידנית: מה מביא הכי הרבה לקוחות.'),
    },
  ],
  team: [
    {
      target: card(tr('הזמנת חבר/ת צוות')),
      title: tr('הזמנת עובד'),
      body: tr(
        'שולחים הזמנה באימייל ובוחרים תפקיד: מנהל רואה את כל הלידים, עובד רואה רק את מה ששויך לו.',
      ),
    },
    {
      target: `[aria-label="${tr('חברי הצוות')}"]`,
      title: tr('חברי הצוות'),
      body: tr('מי בצוות ובאיזה תפקיד. אפשר לשנות תפקיד או להסיר.'),
    },
    {
      target: `[aria-label="${tr('הזמנות ממתינות')}"]`,
      title: tr('הזמנות ממתינות'),
      body: tr('הזמנות שעוד לא אושרו. אפשר לשלוח שוב או לבטל.'),
    },
  ],
  quote: [
    {
      target: pageTop,
      title: tr('הצעת המחיר'),
      body: tr('המספר, הלקוח והסטטוס של ההצעה. טיוטה אפשר לערוך עד שהיא נשלחת.'),
    },
    {
      target: cardOf('main table'),
      title: tr('שורות ההצעה'),
      body: tr(
        'מה כלול: תיאור, כמות ומחיר ליחידה. "הוספת שורה" מוסיפה פריט, והסכומים מחושבים לבד.',
      ),
    },
    {
      target: `[aria-label="${tr('סיכום')}"]`,
      title: tr('סיכום'),
      body: tr('סכום ביניים, הנחה, מע"מ וסה"כ לתשלום.'),
    },
    {
      target: button(tr('שליחה ללקוח')),
      title: tr('שליחה ללקוח'),
      body: tr(
        'שולחים קישור להצעה באימייל או בוואטסאפ. הלקוח מאשר או דוחה אונליין, ואתם רואים את זה בליד.',
      ),
    },
    {
      target: button(tr('פתיחת עמוד ההצעה')),
      title: tr('עמוד ההצעה'),
      body: tr('כך הלקוח רואה את ההצעה. משם אפשר גם להדפיס או לשמור כ-PDF.'),
    },
  ],
  settings: [
    {
      target: card(tr('פרטי העסק')),
      title: tr('פרטי העסק'),
      body: tr('השם, התחום, הטלפון והכתובת. הם מופיעים באתר, בכפתור החיוג ובמיילים.'),
    },
    {
      target: card(tr('אזורי שירות')),
      title: tr('אזורי שירות'),
      body: tr('הערים והאזורים שבהם העסק עובד. מופיעים באתר.'),
    },
    {
      target: card(tr('שעות פעילות')),
      title: tr('שעות פעילות'),
      body: tr('השעות מופיעות באתר, וקובעות מתי אפשר לבקש תור.'),
    },
    {
      target: card(tr('מנוי וחיוב')),
      title: tr('מנוי וחיוב'),
      body: tr('המסלול ואמצעי התשלום של החשבון.'),
    },
  ],
  account: [
    {
      target: card(tr('פרטים אישיים')),
      title: tr('פרטים אישיים'),
      body: tr('השם שלכם כפי שהצוות רואה אותו.'),
    },
    {
      target: card(tr('שינוי סיסמה')),
      title: tr('שינוי סיסמה'),
      body: tr('אחרי שינוי סיסמה, החיבור במכשירים האחרים מתנתק ונשלח אליכם מייל.'),
    },
    {
      target: card(tr('התראות במייל')),
      title: tr('התראות במייל'),
      body: tr('בוחרים אם לקבל מייל על כל פנייה חדשה.'),
    },
  ],
};
