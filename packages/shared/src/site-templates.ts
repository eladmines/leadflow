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
      theme: { palette: 'rose', font: 'rubik' },
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
          form: { ...DEFAULT_CONTACT_FORM },
        },
      ],
    };
  }

  return {
    templateKey,
    theme: { palette: 'navy', font: 'heebo' },
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
      };
    case 'about':
      return { id, type, visible: true, title: 'אודות', body: '' };
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
