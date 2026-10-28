import type { MediaMap } from './site-render';
import {
  DEFAULT_CONTACT_FORM,
  type Section,
  type SiteSeo,
  type SiteTheme,
  type TemplateKey,
} from './site';

/** The business details a template or the renderer needs. */
export interface SiteBusinessInfo {
  name: string;
  industry: string;
  phone: string | null;
  address: string | null;
  serviceAreas: string[];
  openingHours: Record<string, { open: boolean; from: string; to: string }> | null;
  /** Active services, offered in the appointment request (F17). */
  services?: { id: string; name: string }[];
}

export interface SiteDraft {
  templateKey: TemplateKey;
  theme: SiteTheme;
  seo: SiteSeo;
  sections: Section[];
}

/**
 * Starting content for a new site. Copy is realistic but generic; the owner edits it.
 * Ids are deterministic per template (unique within the site); sections added later get random ids.
 */
export function buildTemplateDraft(templateKey: TemplateKey, b: SiteBusinessInfo): SiteDraft {
  const areas = b.serviceAreas.length ? b.serviceAreas.join(', ') : '';
  if (templateKey === 'beauty') {
    return {
      templateKey,
      theme: { palette: 'rose', font: 'rubik', logoAssetId: null },
      seo: {
        title: b.name.slice(0, 70),
        description: `${b.name} — טיפולים מקצועיים באווירה נעימה. קבעו תור עוד היום.`.slice(0, 160),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle: 'טיפולים מקצועיים באווירה אישית ונעימה. נשמח לראות אותך!',
          buttonLabel: 'לקביעת תור',
          buttonAction: b.phone ? 'call' : 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'הטיפולים שלנו',
          items: [
            { name: 'תספורת ועיצוב', description: 'התאמה אישית למבנה הפנים ולסגנון שלך.' },
            { name: 'צבע וגוונים', description: 'צבעים איכותיים ושמירה על בריאות השיער.' },
            { name: 'טיפולי פנים', description: 'ניקוי, הזנה ורענון העור.' },
          ],
        },
        {
          id: 'pricing',
          type: 'pricing',
          visible: true,
          title: 'מחירון',
          note: 'המחירים משתנים לפי אורך השיער וסוג הטיפול.',
          items: [
            { name: 'תספורת נשים', price: '₪150' },
            { name: 'תספורת גברים', price: '₪80' },
            { name: 'צבע שורש', price: '₪220' },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'נעים להכיר',
          body: `ב${b.name} אנחנו מאמינים שכל ביקור צריך להיות רגע של פינוק. אנחנו מקפידים על חומרים איכותיים, יחס אישי וזמנים מדויקים.`,
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'מה הלקוחות מספרים',
          items: [
            { quote: 'שירות מדהים ותוצאה בדיוק כמו שרציתי. ממליצה בחום!', author: 'מיכל' },
            { quote: 'מקצועיות, סבלנות ואווירה נעימה. כבר קבעתי תור הבא.', author: 'נועה' },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: false,
          title: 'שאלות נפוצות',
          items: [
            {
              question: 'צריך לקבוע תור מראש?',
              answer: 'מומלץ לקבוע תור מראש. נשתדל לקבל גם ללא תור לפי הזמינות.',
            },
            { question: 'יש חניה בקרבת מקום?', answer: 'כן, יש חניה ציבורית במרחק הליכה קצר.' },
          ],
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'יצירת קשר',
          subtitle: 'נשמח לענות על כל שאלה ולתאם תור.',
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...DEFAULT_CONTACT_FORM, askAppointment: true },
        },
      ],
    };
  }

  if (templateKey === 'garage') {
    return {
      templateKey,
      theme: { palette: 'graphite', font: 'heebo', logoAssetId: null },
      seo: {
        title: b.name.slice(0, 70),
        description:
          `${b.name} — טיפולים, תיקונים והכנה לטסט${areas ? ` ב${areas}` : ''}. קבעו טיפול עוד היום.`.slice(
            0,
            160,
          ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle:
            'טיפולים תקופתיים, תיקונים ואבחון ממוחשב. מחיר ברור לפני שמתחילים, והרכב חוזר אליכם בזמן.',
          buttonLabel: 'לקביעת טיפול',
          buttonAction: b.phone ? 'call' : 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'מה אנחנו עושים',
          items: [
            { name: 'טיפולים תקופתיים', description: 'שמן, מסננים ובדיקות לפי הוראות היצרן.' },
            { name: 'אבחון ממוחשב', description: 'איתור תקלות מדויק לפני שמחליפים חלקים.' },
            { name: 'מכונאות ובלמים', description: 'תיקוני מנוע, מתלים, בלמים ומצמד.' },
            {
              name: 'הכנה לטסט',
              description: 'בדיקה מקדימה ותיקון כל מה שצריך לעבור בפעם הראשונה.',
            },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'למה אצלנו',
          body: `ב${b.name} מסבירים מה צריך לתקן ולמה, נותנים הצעת מחיר לפני העבודה ולא מחליפים חלק בלי אישור שלכם.`,
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'pricing',
          type: 'pricing',
          visible: false,
          title: 'מחירים לדוגמה',
          note: 'המחיר הסופי תלוי בדגם הרכב. נשמח לתת הצעת מחיר בטלפון.',
          items: [
            { name: 'טיפול שמן ומסננים', price: 'החל מ-₪350' },
            { name: 'הכנה לטסט', price: 'החל מ-₪250' },
          ],
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'לקוחות מספרים',
          items: [
            { quote: 'הסבירו בדיוק מה צריך ולא ניסו למכור לי מה שלא צריך.', author: 'אבי' },
            { quote: 'הרכב היה מוכן באותו יום ובמחיר שסיכמנו.', author: 'דנה' },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: true,
          title: 'שאלות נפוצות',
          items: [
            {
              question: 'צריך לקבוע תור מראש?',
              answer: 'מומלץ לתאם מראש כדי שנוכל להתחיל לעבוד על הרכב מיד כשתגיעו.',
            },
            {
              question: 'אפשר לקבל הצעת מחיר לפני התיקון?',
              answer: 'כן. אחרי האבחון נעדכן אתכם במחיר, ונתחיל רק אחרי אישור שלכם.',
            },
          ],
        },
        {
          id: 'cta',
          type: 'cta',
          visible: true,
          title: 'הרכב צריך טיפול?',
          subtitle: 'התקשרו ונמצא לכם תור קרוב.',
          buttonLabel: 'דברו איתנו',
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'איך מגיעים',
          subtitle: 'השאירו פרטים ונחזור אליכם לתיאום.',
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...DEFAULT_CONTACT_FORM, askAppointment: true },
        },
      ],
    };
  }

  if (templateKey === 'clinic') {
    return {
      templateKey,
      theme: { palette: 'teal', font: 'assistant', logoAssetId: null },
      seo: {
        title: b.name.slice(0, 70),
        description: `${b.name} — טיפול מקצועי ואישי בסביבה רגועה. קבעו פגישת היכרות.`.slice(
          0,
          160,
        ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle:
            'טיפול מקצועי ואישי, בקצב שלך ובסביבה רגועה. נתחיל בפגישת היכרות ונבנה יחד את הדרך.',
          buttonLabel: 'לקביעת פגישה',
          buttonAction: 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'איך אני יכול/ה לעזור',
          items: [
            { name: 'פגישת היכרות', description: 'שיחה ראשונה להבנת הצרכים והמטרות שלך.' },
            { name: 'תוכנית טיפול אישית', description: 'תהליך שמותאם לך, עם יעדים ברורים.' },
            { name: 'ליווי ומעקב', description: 'בדיקת התקדמות ועדכון התוכנית לאורך הדרך.' },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'נעים להכיר',
          body: 'כאן כדאי לספר על ההכשרה, הניסיון והגישה הטיפולית שלך, ולמי הטיפול מתאים.',
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'מטופלים מספרים',
          items: [
            { quote: 'הרגשתי שמקשיבים לי באמת. התהליך שינה לי את השגרה.', author: 'שירה' },
            { quote: 'מקצועיות, סבלנות ויחס אישי מהפגישה הראשונה.', author: 'עומר' },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: true,
          title: 'שאלות נפוצות',
          items: [
            {
              question: 'כמה זמן נמשכת פגישה?',
              answer: 'פגישה רגילה נמשכת כשעה. פגישת ההיכרות קצרה יותר.',
            },
            {
              question: 'יש החזר מביטוח משלים?',
              answer: 'בחלק מהביטוחים המשלימים יש החזר. נשמח לתת קבלה מסודרת.',
            },
            {
              question: 'איך קובעים פגישה ראשונה?',
              answer: 'משאירים פרטים בטופס או מתקשרים, ונתאם מועד שנוח לך.',
            },
          ],
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'קביעת פגישה',
          subtitle: 'השאירו פרטים ואחזור אליכם לתיאום. הפרטים נשמרים בדיסקרטיות.',
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...DEFAULT_CONTACT_FORM, askAppointment: true },
        },
      ],
    };
  }

  if (templateKey === 'food') {
    return {
      templateKey,
      theme: { palette: 'forest', font: 'frank', logoAssetId: null },
      seo: {
        title: b.name.slice(0, 70),
        description: `${b.name} — אוכל טרי, קפה טוב ואווירה נעימה. הזמינו שולחן או אירוע.`.slice(
          0,
          160,
        ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle: 'אוכל טרי שמוכן במקום, קפה טוב ואווירה שמזמינה להישאר. מחכים לכם.',
          buttonLabel: 'להזמנת שולחן',
          buttonAction: b.phone ? 'call' : 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'מה מחכה לכם',
          items: [
            { name: 'ארוחות בוקר', description: 'כל בוקר, עם לחם טרי ומוצרים מקומיים.' },
            { name: 'צהריים וערב', description: 'מנות עונתיות שמשתנות לפי מה שטרי בשוק.' },
            { name: 'אירועים קטנים', description: 'ימי הולדת, ישיבות וחגיגות משפחתיות.' },
          ],
        },
        {
          id: 'pricing',
          type: 'pricing',
          visible: true,
          title: 'מהתפריט',
          note: 'התפריט המלא והמחירים העדכניים במקום.',
          items: [
            { name: 'ארוחת בוקר זוגית', price: '₪138' },
            { name: 'סלט הבית', price: '₪54' },
            { name: 'קפה ומאפה', price: '₪28' },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'הסיפור שלנו',
          body: `${b.name} נולד מאהבה לאוכל פשוט וטוב. אנחנו מכינים הכול במקום, עובדים עם ספקים מקומיים ושמחים לראות לקוחות חוזרים.`,
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'אומרים עלינו',
          items: [
            { quote: 'ארוחת הבוקר הכי טובה באזור, והשירות חם ומהיר.', author: 'טל' },
            { quote: 'חגגנו כאן יום הולדת והכול היה מושלם.', author: 'ליאת' },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: false,
          title: 'שאלות נפוצות',
          items: [
            { question: 'יש מנות טבעוניות?', answer: 'כן, יש בתפריט כמה מנות טבעוניות וצמחוניות.' },
            { question: 'אפשר להזמין לאירוע?', answer: 'בטח. השאירו פרטים ונחזור אליכם עם הצעה.' },
          ],
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'הזמנות ואירועים',
          subtitle: 'רוצים לשריין שולחן או לחגוג אצלנו? השאירו פרטים.',
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...DEFAULT_CONTACT_FORM },
        },
      ],
    };
  }

  return {
    templateKey,
    theme: { palette: 'navy', font: 'heebo', logoAssetId: null },
    seo: {
      title: b.name.slice(0, 70),
      description:
        `${b.name} — שירות מקצועי, אמין ומהיר${areas ? ` ב${areas}` : ''}. התקשרו עכשיו.`.slice(
          0,
          160,
        ),
    },
    sections: [
      {
        id: 'hero',
        type: 'hero',
        visible: true,
        title: b.name,
        subtitle: `שירות מקצועי, אמין ומהיר${areas ? ` ב${areas}` : ''}. עובדים נקי, עומדים בזמנים.`,
        buttonLabel: 'התקשרו עכשיו',
        buttonAction: b.phone ? 'call' : 'contact',
        imageAssetId: null,
      },
      {
        id: 'services',
        type: 'services',
        visible: true,
        title: 'השירותים שלנו',
        items: [
          { name: 'תיקונים ותקלות', description: 'אבחון מהיר ופתרון במקום ברוב המקרים.' },
          { name: 'התקנות', description: 'התקנה מקצועית לפי התקן, עם אחריות.' },
          { name: 'שירות חירום', description: 'זמינים גם לקריאות דחופות.' },
        ],
      },
      {
        id: 'about',
        type: 'about',
        visible: true,
        title: 'למה לבחור בנו',
        body: 'ניסיון של שנים, מחיר הוגן שנקבע מראש ואחריות על העבודה. אנחנו מגיעים בזמן, משאירים נקי ועונים לטלפון.',
        imageAssetId: null,
        imageAlt: '',
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        visible: true,
        title: 'לקוחות ממליצים',
        items: [
          { quote: 'הגיעו באותו יום, פתרו את התקלה ונתנו מחיר הוגן.', author: 'יוסי' },
          { quote: 'עבודה נקייה ומקצועית. בהחלט נזמין שוב.', author: 'רונית' },
        ],
      },
      {
        id: 'faq',
        type: 'faq',
        visible: true,
        title: 'שאלות נפוצות',
        items: [
          {
            question: 'כמה עולה קריאת שירות?',
            answer: 'המחיר נקבע מראש בטלפון לפי סוג העבודה, בלי הפתעות.',
          },
          { question: 'יש אחריות על העבודה?', answer: 'כן, כל עבודה מגיעה עם אחריות.' },
        ],
      },
      {
        id: 'cta',
        type: 'cta',
        visible: true,
        title: 'צריכים עזרה עכשיו?',
        subtitle: 'התקשרו ונחזור אליכם בהקדם.',
        buttonLabel: 'דברו איתנו',
      },
      {
        id: 'contact',
        type: 'contact',
        visible: true,
        title: 'יצירת קשר',
        subtitle: areas ? `נותנים שירות ב${areas}.` : 'נשמח לעזור.',
        showPhone: true,
        showAddress: true,
        showHours: true,
        form: { ...DEFAULT_CONTACT_FORM },
      },
    ],
  };
}

/** A sample photo bundled with a template (D-069). Files live in the API (`assets/stock`). */
export interface StockPhoto {
  file: string;
  width: number;
  height: number;
  /** Describes what the photo shows (it is not the business's own place). */
  alt: string;
}

/** Hero + about photos a new site starts with; copied into the business's library on creation. */
export const STOCK_PHOTOS: Record<TemplateKey, { hero: StockPhoto; about: StockPhoto }> = {
  beauty: {
    hero: { file: 'beauty-hero.webp', width: 1600, height: 1067, alt: '' },
    about: { file: 'beauty-about.webp', width: 1600, height: 1067, alt: 'עמדות עיצוב שיער במספרה' },
  },
  trades: {
    hero: { file: 'trades-hero.webp', width: 1600, height: 1067, alt: '' },
    about: { file: 'trades-about.webp', width: 1600, height: 1065, alt: 'עבודה בלוח חשמל' },
  },
  garage: {
    hero: { file: 'garage-hero.webp', width: 1600, height: 1067, alt: '' },
    about: { file: 'garage-about.webp', width: 1600, height: 1067, alt: 'מכונאי בודק מנוע של רכב' },
  },
  clinic: {
    hero: { file: 'clinic-hero.webp', width: 1600, height: 1067, alt: '' },
    about: { file: 'clinic-about.webp', width: 1067, height: 1600, alt: 'חדר טיפולים מואר' },
  },
  food: {
    hero: { file: 'food-hero.webp', width: 1084, height: 1600, alt: '' },
    about: { file: 'food-about.webp', width: 1600, height: 1067, alt: 'שולחן ארוחת בוקר ערוך' },
  },
};

/** Where the API serves the bundled photos (for the template picker preview). */
export const STOCK_MEDIA_PATH = '/media/stock';
const PREVIEW_IDS = {
  hero: '00000000-0000-4000-8000-0000000000a1',
  about: '00000000-0000-4000-8000-0000000000a2',
} as const;

/** Puts photo ids on the template's hero and about sections (first of each). */
export function withTemplatePhotos(
  draft: SiteDraft,
  ids: { hero?: string; about?: string },
): SiteDraft {
  const photos = STOCK_PHOTOS[draft.templateKey];
  let hero = false;
  let about = false;
  return {
    ...draft,
    sections: draft.sections.map((s) => {
      if (s.type === 'hero' && !hero && ids.hero) {
        hero = true;
        return { ...s, imageAssetId: ids.hero };
      }
      if (s.type === 'about' && !about && ids.about) {
        about = true;
        return { ...s, imageAssetId: ids.about, imageAlt: photos.about.alt };
      }
      return s;
    }),
  };
}

/** The template as a new site will look, with its sample photos (picker preview only). */
export function templatePreview(
  key: TemplateKey,
  b: SiteBusinessInfo,
  base = '',
): { draft: SiteDraft; media: MediaMap } {
  const photos = STOCK_PHOTOS[key];
  const draft = withTemplatePhotos(buildTemplateDraft(key, b), PREVIEW_IDS);
  const ref = (p: StockPhoto) => ({
    url: `${base}${STOCK_MEDIA_PATH}/${p.file}`,
    width: p.width,
    height: p.height,
  });
  return {
    draft,
    media: { [PREVIEW_IDS.hero]: ref(photos.hero), [PREVIEW_IDS.about]: ref(photos.about) },
  };
}

/** Empty content for a section the owner adds in the editor. */
export function newSection(type: Section['type'], id: string): Section {
  switch (type) {
    case 'hero':
      return {
        id,
        type,
        visible: true,
        title: 'כותרת חדשה',
        subtitle: '',
        buttonLabel: 'צרו קשר',
        buttonAction: 'contact',
        imageAssetId: null,
      };
    case 'about':
      return {
        id,
        type,
        visible: true,
        title: 'אודות',
        body: '',
        imageAssetId: null,
        imageAlt: '',
      };
    case 'gallery':
      return { id, type, visible: true, title: 'גלריה', items: [] };
    case 'services':
      return {
        id,
        type,
        visible: true,
        title: 'השירותים שלנו',
        items: [{ name: 'שירות', description: '' }],
      };
    case 'pricing':
      return {
        id,
        type,
        visible: true,
        title: 'מחירון',
        note: '',
        items: [{ name: 'שירות', price: '' }],
      };
    case 'testimonials':
      return { id, type, visible: true, title: 'המלצות', items: [{ quote: '', author: '' }] };
    case 'faq':
      return {
        id,
        type,
        visible: true,
        title: 'שאלות נפוצות',
        items: [{ question: '', answer: '' }],
      };
    case 'contact':
      return {
        id,
        type,
        visible: true,
        title: 'יצירת קשר',
        subtitle: '',
        showPhone: true,
        showAddress: true,
        showHours: true,
        form: { ...DEFAULT_CONTACT_FORM },
      };
    case 'cta':
      return {
        id,
        type,
        visible: true,
        title: 'מוכנים להתחיל?',
        subtitle: '',
        buttonLabel: 'צרו קשר',
      };
  }
}
