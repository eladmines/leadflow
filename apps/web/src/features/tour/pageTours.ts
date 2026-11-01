import { useLocation } from 'react-router-dom';
import type { TourStep } from './Tour';

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
  | 'team';

/** The page under `/b/:businessId/…`, or null for screens without a tour. */
export function pageKeyFor(pathname: string): PageKey | null {
  const [, , , section = '', sub] = pathname.split('/');
  if (section === '') return 'dashboard';
  if (section === 'leads') return sub ? 'lead' : 'leads';
  const known: PageKey[] = ['site', 'conversations', 'tasks', 'appointments', 'reports', 'team'];
  if (section === 'quotes' && !sub) return 'quotes';
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
      title: 'הדשבורד',
      body: 'מה קורה בעסק במבט אחד. למעלה מופיע הצעד הבא שכדאי לעשות, עם כפתור ישיר אליו.',
    },
    {
      target: card('הצעדים להפעלת העסק'),
      title: 'הצעדים להפעלת העסק',
      body: 'רשימת ההקמה: מה כבר הושלם ומה נשאר. כל צעד מסומן לבד כשמסיימים אותו.',
    },
    {
      target: card('פניות אחרונות'),
      title: 'פניות אחרונות',
      body: 'הפניות החדשות ביותר מהאתר ומוואטסאפ. לחיצה על פנייה פותחת את הליד.',
    },
    {
      target: card('המשימות שלי להיום'),
      title: 'המשימות שלי להיום',
      body: 'מה צריך לעשות היום ומה באיחור, כדי ששום לקוח לא ייפול בין הכיסאות.',
    },
    {
      target: card('פרופיל העסק'),
      title: 'פרופיל העסק',
      body: 'טלפון, כתובת, שעות ואזורי שירות. הפרטים האלה מופיעים גם באתר.',
    },
  ],
  site: [
    {
      target: card('בואו נבנה את האתר שלך'),
      title: 'בונים אתר',
      body: 'בוחרים תבנית, והיא מתמלאת מראש בפרטי העסק ובתמונות לדוגמה. אחר כך משנים הכול.',
    },
    {
      target: card('כבר יש לעסק אתר?'),
      title: 'כבר יש לכם אתר?',
      body: 'אפשר להוסיף את הכתובת שלו כדי לראות אותו כאן. LeadFlow לא ינהל אותו.',
    },
    {
      target: card('האתר הקיים של העסק'),
      title: 'האתר הקיים',
      body: 'האתר שכבר יש לעסק, לצפייה בלבד. שינויים בו נעשים אצל מי שבנה אותו.',
    },
    {
      target: '[aria-label="כלי עריכה"]',
      title: 'כלי העריכה',
      body: 'עמודי האתר, הוספת מקטעים, מקטעים מוסתרים וגודל המסך (מחשב או טלפון).',
    },
    {
      target: '[aria-label="תצוגה מקדימה"]',
      title: 'עורכים ישירות על העמוד',
      body: 'לוחצים על כל טקסט כדי לכתוב, על תמונה כדי להחליף, ועל מקטע כדי לשנות את העיצוב שלו. הכול נשמר לבד.',
    },
    {
      target: button('פרסום'),
      title: 'פרסום',
      body: 'השינויים עולים לאוויר רק אחרי פרסום. עד אז האתר החי לא משתנה.',
    },
    {
      target: button('היסטוריה'),
      title: 'היסטוריה',
      body: 'כל פרסום נשמר כגרסה. אפשר לחזור לגרסה קודמת או להוריד את האתר מהאוויר.',
    },
    {
      target: button('אפשרויות'),
      title: 'אפשרויות',
      body: 'החלפת תבנית, או מחיקת האתר כדי לחזור לאתר קיים.',
    },
  ],
  leads: [
    {
      target: button('ליד חדש'),
      title: 'ליד חדש',
      body: 'פניות מהאתר ומוואטסאפ נכנסות לבד. כאן מוסיפים ליד ידנית, למשל מטלפון.',
    },
    {
      target: '[role="search"]',
      title: 'חיפוש וסינון',
      body: 'מחפשים לפי שם, טלפון או אימייל, ומסננים לפי שלב, אחראי, מקור או תגית.',
    },
    {
      target: '[aria-label="תצוגה"]',
      title: 'לוח או רשימה',
      body: 'בלוח רואים את הלידים לפי שלב וגוררים ביניהם. ברשימה רואים יותר פרטים על כל ליד.',
    },
    {
      target: '[aria-label="לוח לידים"], [aria-label="פניות"]',
      title: 'הלידים',
      body: 'לחיצה על שם פותחת את הליד: פרטים, הערות, משימות, תורים, הצעות מחיר ושיחת וואטסאפ.',
    },
    {
      target: button('ייצוא לאקסל'),
      title: 'ייצוא לאקסל',
      body: 'מורידים את הלידים (לפי הסינון הנוכחי) לקובץ שנפתח באקסל.',
    },
  ],
  lead: [
    {
      target: pageTop,
      title: 'כרטיס הליד',
      body: 'מי הלקוח, מאיפה הגיע ומה ביקש. כפתורי החיוג והאימייל פותחים שיחה בלחיצה.',
    },
    {
      target: card('פרטי הטיפול'),
      title: 'פרטי הטיפול',
      body: 'השלב בתהליך, מי אחראי, ערך משוער, מתי לחזור ללקוח ותגיות.',
    },
    {
      target: card('WhatsApp'),
      title: 'שיחת וואטסאפ',
      body: 'השיחה עם הלקוח בוואטסאפ. אפשר לענות מכאן עד 24 שעות מההודעה האחרונה שלו.',
    },
    {
      target: card('הערות והיסטוריה'),
      title: 'הערות והיסטוריה',
      body: 'כותבים הערות לצוות, ורואים כל מה שקרה בליד: שינויי שלב, שיוכים, משימות והצעות.',
    },
    {
      target: card('משימות'),
      title: 'משימות',
      body: 'תזכורת לחזור ללקוח. מקבלים מייל כשמגיע הזמן.',
    },
    {
      target: card('תורים'),
      title: 'תורים',
      body: 'התורים של הלקוח, וקביעת תור חדש.',
    },
    {
      target: card('הצעות מחיר'),
      title: 'הצעות מחיר',
      body: 'יוצרים הצעת מחיר מתוך הליד ושולחים ללקוח בקישור.',
    },
  ],
  conversations: [
    {
      title: 'שיחות WhatsApp',
      body: 'מספרים חדשים שכתבו לעסק בוואטסאפ מחכים כאן, עד שתחליטו אם זה לקוח או מישהו פרטי.',
    },
    {
      target: '[aria-label="מספרים שמחכים לסיווג"]',
      title: 'מחכים לסיווג',
      body: 'כל מספר עם ההודעות שלו. לקוחות מוכרים לא מגיעים לכאן: ההודעות שלהם נכנסות ישר לליד.',
    },
    {
      target: button('עסקי: יצירת ליד'),
      title: 'עסקי',
      body: 'יוצר ליד מההודעות. מעכשיו כל הודעה מהמספר הזה תיכנס לליד שלו.',
    },
    {
      target: button('פרטי', true),
      title: 'פרטי',
      body: 'ההודעות נמחקות, והמספר לא ייכנס למערכת גם בהמשך. מתאים לבני משפחה וחברים.',
    },
    {
      target: 'main details',
      title: 'מספרים פרטיים',
      body: 'המספרים שסימנתם כפרטיים. אפשר לבטל סימון אם טעיתם.',
    },
  ],
  tasks: [
    {
      target: '[aria-label="משימה חדשה"]',
      title: 'משימה חדשה',
      body: 'מה צריך לעשות ומתי. אפשר לשייך לעובד, ומקבלים מייל כשמגיע הזמן.',
    },
    {
      target: '[aria-label="של מי"]',
      title: 'של מי',
      body: 'המשימות שלכם או של כל הצוות.',
    },
    {
      target: 'main ul',
      title: 'הרשימה',
      body: 'באיחור, היום והלאה. מסמנים משימה כבוצעה בלחיצה.',
    },
  ],
  appointments: [
    {
      target: button('תור חדש'),
      title: 'תור חדש',
      body: 'קובעים תור ללקוח: שירות, איש צוות ושעה. המערכת לא תאפשר שני תורים באותה שעה.',
    },
    {
      target: button('שירותים'),
      title: 'שירותים',
      body: 'השירותים שהעסק נותן, עם משך ומחיר. הם מופיעים גם בבקשת התור באתר.',
    },
    {
      target: '[aria-label="תצוגה"]',
      title: 'יום או שבוע',
      body: 'בוחרים איך לראות את היומן, ועוברים בין ימים או שבועות בחיצים.',
    },
    {
      target: '[aria-label="סינון לפי איש צוות"]',
      title: 'לפי איש צוות',
      body: 'רואים את היומן של כל הצוות או של אדם אחד.',
    },
  ],
  quotes: [
    {
      title: 'הצעות מחיר',
      body: 'כל ההצעות של העסק. הצעה חדשה נוצרת מתוך ליד, בכפתור "הצעת מחיר חדשה" בכרטיס הליד.',
    },
    {
      target: '[aria-label="סינון לפי סטטוס"]',
      title: 'סינון לפי סטטוס',
      body: 'טיוטות, הצעות שנשלחו, אושרו או נדחו.',
    },
    {
      target: 'main table',
      title: 'הרשימה',
      body: 'לחיצה על הצעה פותחת אותה לעריכה, לשליחה או להדפסה.',
    },
  ],
  reports: [
    {
      target: '[aria-label="טווח זמן"]',
      title: 'טווח זמן',
      body: '7, 30 או 90 הימים האחרונים, בהשוואה לתקופה שלפניהם.',
    },
    {
      target: '[aria-label="פניות לאורך זמן"]',
      title: 'פניות לאורך זמן',
      body: 'כמה פניות הגיעו בכל יום.',
    },
    {
      target: card('פניות לפי שלב'),
      title: 'פניות לפי שלב',
      body: 'כמה לידים נמצאים בכל שלב, ואיפה הם נתקעים.',
    },
    {
      target: card('מאיפה הגיעו הפניות'),
      title: 'מאיפה הגיעו',
      body: 'האתר, וואטסאפ או הזנה ידנית: מה מביא הכי הרבה לקוחות.',
    },
  ],
  team: [
    {
      target: card('הזמנת חבר/ת צוות'),
      title: 'הזמנת עובד',
      body: 'שולחים הזמנה באימייל ובוחרים תפקיד: מנהל רואה את כל הלידים, עובד רואה רק את מה ששויך לו.',
    },
    {
      target: '[aria-label="חברי הצוות"]',
      title: 'חברי הצוות',
      body: 'מי בצוות ובאיזה תפקיד. אפשר לשנות תפקיד או להסיר.',
    },
    {
      target: '[aria-label="הזמנות ממתינות"]',
      title: 'הזמנות ממתינות',
      body: 'הזמנות שעוד לא אושרו. אפשר לשלוח שוב או לבטל.',
    },
  ],
};
