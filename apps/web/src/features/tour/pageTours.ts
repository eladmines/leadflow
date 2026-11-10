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
  | 'automations'
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
    'automations',
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

/** The card whose heading starts with a text (headings that end with a count). */
const cardStarting = (title: string) => () => {
  const heading = pick(
    [...document.querySelectorAll<HTMLElement>('main h2, main h3')].filter((h) =>
      h.textContent?.trim().startsWith(title),
    ),
  );
  return heading?.closest<HTMLElement>('.shadow-card, section, article') ?? heading;
};

/** Anywhere on screen (e.g. the menu); only a visible one, so a closed phone menu skips it. */
const anywhere = (css: string) => () =>
  [...document.querySelectorAll<HTMLElement>(css)].filter(inPage).find(sized) ?? null;

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
      body: tr(
        'מה קורה בעסק במבט אחד. למעלה מופיע הצעד הבא שכדאי לעשות, עם כפתור ישיר אליו, וכמה מההקמה כבר הושלם.',
      ),
    },
    {
      target: '[aria-labelledby="today-title"]',
      title: tr('מה מחכה לכם היום'),
      body: tr(
        'פניות פתוחות, תורים היום, משימות באיחור ושיחות שלא נקראו. לחיצה על קופסה פותחת את העמוד שלה; כל שאר החלקים נמצאים בתפריט.',
      ),
    },
    {
      target: anywhere(`button[aria-haspopup="dialog"][aria-label^="${tr('התראות')}"]`),
      title: tr('התראות'),
      body: tr(
        'הפעמון מראה כמה דברים חדשים מחכים: פנייה, הודעה בוואטסאפ, תור שנקבע בבוט או הצעה שאושרה. לחיצה על התראה לוקחת אליה.',
      ),
    },
    {
      target: anywhere('[aria-label="Language / שפה"]'),
      title: tr('שפה'),
      body: tr('לוחצים על הדגל כדי להחליף בין אנגלית לעברית. ההחלפה נשמרת בדפדפן הזה.'),
    },
    {
      target: anywhere(`button[aria-haspopup="menu"][aria-label="${tr('עזרה')}"]`),
      title: tr('העוזר של LeadFlow'),
      body: tr(
        'בכל עמוד אפשר ללחוץ עליי: סיור בעמוד שמסביר מה יש בו, סיור במערכת כולה, וחיפוש מהיר.',
      ),
    },
  ],
  site: [
    {
      target: card(tr('בואו נבנה את האתר שלך')),
      title: tr('בונים אתר'),
      body: tr('בוחרים תבנית, והיא מתמלאת מראש בפרטי העסק ובתמונות לדוגמה. אחר כך משנים הכול.'),
    },
    {
      target: '#site-start',
      title: tr('בחרו איך להתחיל'),
      body: tr(
        'בונים אתר חדש מתבנית מוכנה, או מחברים את האתר שכבר יש לכם ורואים אותו כאן — LeadFlow לא משנה בו דבר. כל פנייה מאתר שנבנה כאן נכנסת ישר למערכת.',
      ),
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
      title: tr('לידים'),
      body: tr(
        'כל מי שפנה לעסק: מטופס האתר, מוואטסאפ, מבוט התורים או שהוספתם בעצמכם. כל ליד עובר שלבים עד שהוא נסגר.',
      ),
    },
    {
      target: button(tr('ליד חדש')),
      title: tr('ליד חדש'),
      body: tr('פניות מהאתר ומוואטסאפ נכנסות לבד. כאן מוסיפים ליד ידנית, למשל מטלפון.'),
    },
    {
      target: button(tr('עוד')),
      title: tr('עוד'),
      body: tr('רענון (פניות חדשות מופיעות לבד, והכפתור מביא אותן מיד) וייצוא הלידים לאקסל.'),
    },
    {
      target: '[role="search"]',
      title: tr('חיפוש וסינון'),
      body: tr(
        'מחפשים לפי שם, טלפון או אימייל. הכפתור "סינון" פותח סינון לפי שלב, אחראי, מקור או תגית.',
      ),
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
      body: tr(
        'השלב בתהליך, מי אחראי, ערך משוער, מתי לחזור ללקוח ותגיות. כל שינוי נשמר ונרשם בהיסטוריה.',
      ),
    },
    {
      target: `[aria-label="${tr('חלקי הליד')}"]`,
      title: tr('הכול על הליד, בלשוניות'),
      body: tr(
        'הערות והיסטוריה (כל מה שקרה בליד), WhatsApp (אפשר לענות עד 24 שעות מההודעה האחרונה של הלקוח), משימות, תורים והצעות מחיר. לחיצה על לשונית מציגה את החלק שלה.',
      ),
    },
  ],
  conversations: [
    {
      title: tr('שיחות'),
      body: tr(
        'כל ההודעות מלקוחות, מוואטסאפ ומפייסבוק, במקום אחד. פותחים שיחה ועונים מכאן, בערוץ שבו הלקוח כתב.',
      ),
    },
    {
      target: button(tr('רענון')),
      title: tr('רענון'),
      body: tr('הודעות חדשות מגיעות לבד כל כמה שניות. הכפתור מביא אותן מיד.'),
    },
    {
      target: `ul[aria-label="${tr('שיחות')}"]`,
      title: tr('השיחות'),
      body: tr(
        'החדשות למעלה. נקודה ירוקה: וואטסאפ, כחולה: פייסבוק. כל פונה חדש נכנס כליד. "לא נקראו" מסנן את הרשימה.',
      ),
    },
  ],
  automations: [
    {
      title: tr('אוטומציות'),
      body: tr('מה קורה כשלקוח כותב לכם בוואטסאפ: מענה אוטומטי, קביעת תורים והצצה לעסק.'),
    },
    {
      target: `[aria-label="${tr('בחירת סטטוס')}"]`,
      title: tr('הסטטוס שלך'),
      body: tr(
        'לחיצה אחת, למשל "באירוע", ומתחת רואים בדיוק מה לקוחות מקבלים עכשיו — ואפשר לשנות את ההודעה שם. אפשר לבחור לכמה זמן ולהוסיף סרטון, ו"זמין" מחזיר את ההודעה הכללית.',
      ),
    },
    {
      target: `[aria-label="${tr('מה קורה כשלקוח כותב')}"]`,
      title: tr('מה קורה כשלקוח כותב'),
      body: tr(
        'שתי דרכים לענות: מענה אוטומטי או קביעת תורים אוטומטית. לכל אחת ההגדרות שלה, שנשמרות גם כשהיא כבויה. מדליקים את המתג של מה שרוצים — אחת בכל פעם.',
      ),
    },
    {
      target: '[aria-labelledby="bot-settings-title"]',
      title: tr('הגדרות קביעת התורים'),
      body: tr(
        'עונה ללקוחות בוואטסאפ גם כשאתם עסוקים: מציע שעות פנויות מהיומן וקובע תור בלחיצה, או בעסקי אירועים אוסף את פרטי האירוע. לקוח שמבקש לדבר איתכם, או שלא מבינים אותו פעמיים, עובר אליכם מיד. לא עונה למספרים פרטיים, ושותק ברגע שמישהו מהצוות כותב בשיחה.',
      ),
    },
    {
      target: `[role="group"][aria-label="${tr('מה לקוחות יכולים להזמין?')}"]`,
      title: tr('מה לקוחות יכולים להזמין'),
      body: tr(
        '"תור בשעה פנויה": הלקוח בוחר שירות, יום ושעה. "בקשה לאירוע": הלקוח כותב תאריך ומספר על האירוע, ואתם מאשרים. האפשרות שמתאימה לתחום שלכם מסומנת.',
      ),
    },
    {
      target: `[role="group"][aria-label="${tr('כשלקוח קובע תור:')}"]`,
      title: tr('אישור התורים'),
      body: tr(
        '"התור מאושר מיד": התור נכנס ליומן כמאושר. "התור מחכה לאישור שלי": השעה נשמרת, והתור מחכה לכם ב"בקשות ממתינות לאישור" בעמוד התורים.',
      ),
    },
    {
      target: button(tr('שמירת ההגדרות')),
      title: tr('שמירת ההגדרות'),
      body: tr(
        'השינויים בהגדרות נכנסים לתוקף רק אחרי לחיצה כאן. עד אז מופיע "יש שינויים שעוד לא נשמרו", ו"ביטול השינויים" מחזיר את מה שהיה.',
      ),
    },
    {
      target: button(tr('עריכת ההודעות ללקוחות')),
      title: tr('ההודעות ללקוחות'),
      body: tr(
        'פתחו כדי לכתוב את ההודעות במילים שלכם. פרטים בסוגריים, כמו [שם העסק], מתמלאים לבד, ומתחת לכל הודעה רואים בדיוק מה הלקוח יקבל. "ברירת מחדל" מחזיר את הנוסח המקורי.',
      ),
    },
    {
      target: `[aria-label="${tr('הצצה לעסק')}"]`,
      title: tr('הצצה לעסק'),
      body: tr(
        'אחרי המענה האוטומטי, או ללקוח שלא סיים לקבוע תור, נשלחת הודעה עם קישור, עד 3 תמונות וסרטון מהעסק. לכל היותר פעם ביום ללקוח. המתג מדליק ומכבה אותה.',
      ),
    },
  ],
  tasks: [
    {
      target: `[aria-label="${tr('משימה חדשה')}"]`,
      title: tr('משימה חדשה'),
      body: tr(
        'כותבים מה צריך לעשות ומתי, ולוחצים "הוספה". אפשר לשייך לעובד, ומקבלים מייל ופעמון כשמגיע הזמן.',
      ),
    },
    {
      target: `[aria-label="${tr('של מי')}"]`,
      title: tr('של מי'),
      body: tr('"שלי" מראה רק את המשימות שלכם; "של כל הצוות" את כולן.'),
    },
    {
      target: 'main ul',
      title: tr('הרשימה'),
      body: tr('באיחור, היום והלאה. מסמנים משימה כבוצעה בלחיצה; משימה של ליד מקשרת אליו.'),
    },
  ],
  appointments: [
    {
      target: '[role="grid"]',
      title: tr('היומן'),
      body: tr(
        'כל עמודה היא יום וכל שורה חצי שעה. תור מופיע כבלוק בגודל הזמן שהוא תופס; לחיצה עליו פותחת אותו לשינוי, לשיבוץ איש צוות או לביטול.',
      ),
    },
    {
      target: () =>
        pick([
          ...document.querySelectorAll<HTMLElement>(
            `main [aria-label^="${tr('פנוי: קביעת תור ב{0}', '')}"]`,
          ),
        ]),
      title: tr('שעה פנויה'),
      body: tr(
        'השעות הירוקות פנויות. לחיצה על שעה פנויה פותחת תור חדש עם התאריך והשעה כבר ממולאים.',
      ),
    },
    {
      target: `[aria-label="${tr('מקרא')}"]`,
      title: tr('מה כל צבע אומר'),
      body: tr('ירוק: פנוי. מקווקו: מחוץ לשעות הפעילות. הסטטוס של כל תור כתוב עליו.'),
    },
    {
      target: cardStarting(tr('בקשות ממתינות לאישור')),
      title: tr('בקשות ממתינות'),
      body: tr(
        'בקשות מהאתר ומהבוט בוואטסאפ, כולל בקשות לאירוע. לוחצים על בקשה, משבצים איש צוות ומאשרים.',
      ),
    },
    {
      target: button(tr('תור חדש')),
      title: tr('תור חדש'),
      body: tr('קובעים תור ללקוח: שירות, איש צוות ושעה. המערכת לא תאפשר שני תורים באותה שעה.'),
    },
    {
      target: button(tr('עוד')),
      title: tr('שירותים'),
      body: tr(
        'בכפתור "עוד": השירותים שהעסק נותן, עם משך ומחיר. הם מופיעים בבקשת התור באתר וברשימה של הבוט בוואטסאפ.',
      ),
    },
    {
      target: `[aria-label="${tr('תצוגה')}"]`,
      title: tr('יום או שבוע'),
      body: tr('בוחרים איך לראות את היומן, ועוברים בין ימים או שבועות בחיצים. "היום" חוזר להיום.'),
    },
    {
      target: `[aria-label="${tr('סינון לפי איש צוות')}"]`,
      title: tr('לפי איש צוות'),
      body: tr('רואים את היומן של כל הצוות או של אדם אחד. השעות הפנויות מתעדכנות בהתאם.'),
    },
  ],
  quotes: [
    {
      title: tr('הצעות מחיר'),
      body: tr(
        'כל ההצעות של העסק. הצעה חדשה נוצרת מתוך ליד, בכפתור "הצעת מחיר חדשה" בכרטיס הליד, כך שהיא כבר מכירה את הלקוח.',
      ),
    },
    {
      target: `[aria-label="${tr('סינון לפי סטטוס')}"]`,
      title: tr('סינון לפי סטטוס'),
      body: tr(
        'טיוטה: עוד לא נשלחה. נשלחה: מחכה ללקוח. אושרה או נדחתה: הלקוח החליט, וקיבלתם על זה התראה.',
      ),
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
      body: tr('כמה פניות הגיעו בכל יום. כל עמודה היא יום אחד.'),
    },
    {
      target: button(tr('הצגה כטבלה')),
      title: tr('הצגה כטבלה'),
      body: tr('אותם נתונים כטבלה של מספרים, לקריאה נוחה או להעתקה.'),
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
      target: `[aria-label="${tr('חלקי ההגדרות')}"]`,
      title: tr('ההגדרות, בלשוניות'),
      body: tr(
        'פרטי העסק (מופיעים באתר, בכפתור החיוג ובמיילים), אזורי שירות, שעות פעילות (קובעות אילו שעות מוצעות לתורים), ערוצים (חיבור הוואטסאפ ודף הפייסבוק של העסק) ומנוי. כל לשונית נשמרת בכפתור משלה.',
      ),
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
