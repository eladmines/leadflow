/** English copy, keyed by the Hebrew source text (D-100). Part 4: custom lead fields (F34). */
export const enPart4: Record<string, string> = {
  // Field types
  מספר: 'Number',
  'בחירה מרשימה': 'Choice from a list',
  'תיבת סימון': 'Checkbox',
  // Values
  כן: 'Yes',
  'לא נבחר': 'Not chosen',
  הוסרה: 'removed',
  'אפשרות שנמחקה': 'Removed option',
  'ערך בין {0} ל־{1}': 'Between {0} and {1}',
  'ערך מ־{0} ומעלה': '{0} or more',
  'ערך עד {0}': 'Up to {0}',
  // Settings → Lead fields
  'שדות לידים': 'Lead fields',
  'שדות הלידים': 'lead fields',
  'שדות משלכם בכרטיס של כל ליד, למשל תאריך האירוע, דגם הרכב או סוג הטיפול. אפשר לסנן לפיהם ברשימת הלידים.':
    'Your own fields on every lead, such as the event date, the car model or the type of treatment. You can filter the leads list by them.',
  'טוענים את השדות…': 'Loading the fields…',
  'לא הצלחנו לטעון את השדות': "We couldn't load the fields",
  'לנסות שוב': 'Try again',
  'עדיין אין שדות משלכם': 'No fields of your own yet',
  'כל ליד מגיע עם שם, טלפון והודעה. הוסיפו שדות שחשובים לעסק שלכם, ומלאו אותם בכרטיס הליד.':
    'Every lead comes with a name, phone and message. Add the fields that matter to your business, and fill them in on the lead page.',
  'הוספת שדה': 'Add field',
  '{0} מתוך {1} שדות פעילים': '{0} of {1} active fields',
  'שדות פעילים': 'Active fields',
  חובה: 'Required',
  'אפשרויות: {0}': 'Options: {0}',
  'עריכת {0}': 'Edit {0}',
  'העברת {0} לארכיון': 'Archive {0}',
  בארכיון: 'Archived',
  'שדות בארכיון': 'Archived fields',
  'שדות בארכיון לא מופיעים בטפסים ובסינון. ערכים שכבר מולאו נשארים בכרטיסי הלידים לקריאה בלבד.':
    'Archived fields are left out of forms and filters. Values already filled in stay on the leads, read-only.',
  'שחזור {0}': 'Restore {0}',
  שחזור: 'Restore',
  'השדה {0} הועבר למקום {1}': '{0} moved to position {1}',
  'השדה {0} הועבר לארכיון': '{0} was archived',
  'השדה {0} שוחזר': '{0} was restored',
  'השדה {0} נוסף': '{0} was added',
  'השדה {0} נשמר': '{0} was saved',
  'להעביר את "{0}" לארכיון?': 'Archive "{0}"?',
  'השדה לא יופיע יותר בטפסים ובסינון. ערכים שכבר מולאו יישארו בכרטיסי הלידים, ואפשר לשחזר את השדה בכל זמן.':
    'The field will no longer appear in forms and filters. Values already filled in stay on the leads, and you can restore the field at any time.',
  'העברה לארכיון': 'Archive',
  'עריכת שדה': 'Edit field',
  'שדה חדש': 'New field',
  'שם השדה': 'Field name',
  'למשל: תאריך האירוע': 'For example: event date',
  'סוג השדה': 'Field type',
  'אי אפשר לשנות את הסוג אחרי השמירה.': "The type can't be changed after saving.",
  'אפשרות {0}': 'Option {0}',
  'הזזת אפשרות {0} למעלה': 'Move option {0} up',
  'הזזת אפשרות {0} למטה': 'Move option {0} down',
  'הסרת אפשרות {0}': 'Remove option {0}',
  'הוספת אפשרות': 'Add option',
  'אפשרות שמסירים עוברת לארכיון: לידים שכבר בחרו בה ימשיכו להציג אותה, ואי אפשר לבחור בה שוב.':
    "A removed option is archived: leads that already have it keep showing it, and it can't be chosen again.",
  'אפשרויות שהוסרו': 'Removed options',
  'החזרת האפשרות {0}': 'Bring back the option {0}',
  'ערך מינימלי': 'Minimum',
  'ערך מקסימלי': 'Maximum',
  'חובה רק בטופס "ליד חדש" ובעריכה בכרטיס הליד. פניות מהאתר ומהערוצים, לידים מייבוא ולקוח שנוסף מהר ממסך הצעת המחיר יתקבלו גם בלי.':
    'Required only in the "New lead" form and when editing on the lead page. Leads from the website and channels, imported leads and a customer added quickly from the quote screen still arrive without it.',
  'שמירת השדה': 'Save field',
  'הוספת השדה': 'Add the field',
  // Lead page
  פרטים: 'Details',
  'אפשר להוסיף לכל ליד שדות משלכם, למשל תאריך האירוע או דגם הרכב.':
    'You can add your own fields to every lead, such as the event date or the car model.',
  ריק: 'empty',
  'שדה נוסף': 'Custom field',
  'שונה ל': 'changed to',
  'שדות נוספים': 'Custom fields',
  // New lead
  'פרטים נוספים': 'More details',
  'לא הצלחנו לטעון את השדות הנוספים. אפשר לנסות לשמור, או לסגור ולפתוח שוב.':
    "We couldn't load the custom fields. You can try to save, or close and open again.",
  // Leads list
  'סינון לפי שדות נוספים': 'Filter by custom fields',
  הכל: 'All',
  מסומן: 'Ticked',
  'לא מסומן': 'Not ticked',
  'מכיל…': 'Contains…',
  '{0}: מ־': '{0}: from',
  '{0}: עד': '{0}: to',
  'מ־': 'From',
  עד: 'To',
  בלי: 'None',
  'שדות שמוצגים בכרטיסי הלידים': 'Fields shown on lead cards',
  'שדה בכרטיסים': 'Field on cards',
  'שדה נוסף בכרטיסים': 'Another field on cards',

  // Shared messages (`leadFieldMessages` in packages/shared), shown through tr().
  'יש להזין שם לשדה': 'Enter a name for the field',
  'שם השדה יכול להכיל עד {0} תווים': 'The field name can be up to {0} characters',
  'כבר יש שדה פעיל בשם הזה': 'There is already an active field with this name',
  'יש לבחור סוג שדה': 'Choose a field type',
  'אי אפשר לשנות את סוג השדה. אפשר ליצור שדה חדש במקומו':
    "The field type can't be changed. You can create a new field instead",
  'לשדה בחירה צריכות להיות בין {0} ל-{1} אפשרויות':
    'A choice field needs between {0} and {1} options',
  'יש יותר מדי אפשרויות בארכיון של השדה הזה': 'This field has too many archived options',
  'רק לשדה בחירה יש אפשרויות': 'Only a choice field has options',
  'יש להזין טקסט לאפשרות': 'Enter text for the option',
  'אפשרות יכולה להכיל עד {0} תווים': 'An option can be up to {0} characters',
  'יש שתי אפשרויות עם אותו שם': 'Two options have the same name',
  'אחת האפשרויות אינה שייכת לשדה הזה': "One of the options doesn't belong to this field",
  'טווח ערכים אפשרי רק לשדה מספר': 'Only a number field can have a range',
  'הערך המינימלי גדול מהמקסימלי': 'The minimum is greater than the maximum',
  'יש להזין מספר': 'Enter a number',
  'שדה סימון לא יכול להיות שדה חובה': "A checkbox field can't be required",
  'אפשר עד {0} שדות פעילים. העבירו שדה לארכיון כדי להוסיף חדש':
    'You can have up to {0} active fields. Archive a field to add a new one',
  'שדה מופיע פעמיים ברשימה': 'A field appears twice in the list',
  'רשימת השדות השתנתה. רעננו את הדף ונסו שוב':
    'The list of fields changed. Refresh the page and try again',
  'השדות הנוספים אינם תקינים': 'The custom fields are not valid',
  'יש יותר מדי שדות נוספים בבקשה': 'Too many custom fields in the request',
  'השדה הזה לא קיים בעסק': "This field doesn't exist in the business",
  'השדה הועבר לארכיון ואי אפשר לעדכן אותו': "The field was archived and can't be updated",
  'זהו שדה חובה': 'This field is required',
  'יש להזין טקסט': 'Enter text',
  'הטקסט ארוך מדי (עד {0} תווים)': 'The text is too long (up to {0} characters)',
  'המספר צריך להיות לפחות {0}': 'The number must be at least {0}',
  'המספר צריך להיות לכל היותר {0}': 'The number must be at most {0}',
  'יש להזין תאריך תקין': 'Enter a valid date',
  'יש לבחור אחת מהאפשרויות': 'Choose one of the options',
  'יש לסמן או לבטל את הסימון': 'Tick or untick the box',
  'הסינון לפי שדה נוסף אינו תקין': 'The custom field filter is not valid',
  'הטקסט מכיל תווים לא תקינים. מחקו אותם ונסו שוב':
    'The text contains invalid characters. Delete them and try again.',

  // D-206: user menu, billing page, lead fields in Leads
  'תפריט המשתמש': 'User menu',
  'תפריט המשתמש: {0}': 'User menu: {0}',
  'מנוי והחיוב': 'plan and billing',
  'ניהול שדות': 'Manage fields',
  'פרטי העסק, שעות פעילות (קובעות אילו שעות מוצעות לתורים) ואזורי שירות, כולם בלשונית אחת, כל כרטיס עם כפתור שמירה משלו. בלשונית השנייה: ערוצים (חיבור הוואטסאפ ודף הפייסבוק של העסק).':
    "Business details, opening hours (which decide the hours offered for appointments) and service areas, all in one tab, each card with its own save button. The second tab: channels (connecting the business's WhatsApp and Facebook page).",
  // D-207 – D-210: lead page in cards, next action = nearest task, value from quotes.
  'יש שינויים שלא נשמרו': 'Unsaved changes',
  'ביטול שינויים': 'Discard changes',
  'הצגת פחות': 'Show less',
  'הצג הכול ({0})': 'Show all ({0})',
  'הפעולה הבאה': 'Next action',
  'הפעולה הבאה:': 'Next action:',
  'אחראי:': 'Assignee:',
  'אין פעולה הבאה. כדאי להוסיף משימה כדי לא לשכוח לחזור ללקוח.':
    'No next action. Add a task so you remember to get back to the customer.',
  '+ משימה': '+ Task',
  '+ תור': '+ Appointment',
  '+ הצעה': '+ Quote',
  'טוענים את המשימות…': 'Loading tasks…',
  'אין לך הרשאה לראות את המשימות של הליד הזה.':
    "You don't have permission to see this lead's tasks.",
  'טוענים את התורים…': 'Loading appointments…',
  'אין לך הרשאה לראות את התורים של הליד הזה.':
    "You don't have permission to see this lead's appointments.",
  'תורי הליד': "Lead's appointments",
  'ערך הליד, לפי הצעות המחיר': "The lead's value, from its quotes",
  'נסגר (הצעות שאושרו)': 'Won (accepted quotes)',
  'פתוח (ההצעה האחרונה שנשלחה)': 'Open (latest sent quote)',
  'טוענים את הצעות המחיר…': 'Loading quotes…',
  'אין לך הרשאה לראות את הצעות המחיר של הליד הזה.':
    "You don't have permission to see this lead's quotes.",
  'הצעות המחיר של הליד': "Lead's quotes",
  'אין עדיין הצעות. ערך הליד נקבע לפי הצעות המחיר שלו.':
    "No quotes yet. The lead's value comes from its quotes.",
  'לצאת בלי לשמור?': 'Leave without saving?',
  'יש בפרטים של הליד שינויים שלא נשמרו. אם יוצאים עכשיו, הם לא יישמרו.':
    "The lead's details have unsaved changes. If you leave now, they won't be saved.",
  'להישאר בעמוד': 'Stay on this page',
  'לצאת בלי לשמור': 'Leave without saving',
  'לפי הצעות המחיר': 'From quotes',
  '{0} בהצעות פתוחות · לפי הצעות מחיר': '{0} in open quotes · from quotes',
  'המשימה הפתוחה הקרובה של הליד: מה לעשות, מתי ומי אחראי. "+ משימה" מוסיף משימה חדשה.':
    'The lead\'s nearest open task: what to do, when and who\'s responsible. "+ Task" adds a new one.',
  'השדות שהגדרתם לכל ליד. ממלאים בחופשיות ושומרים בכפתור "שמירה".':
    'The fields you set up for every lead. Fill them in freely and click "Save".',
  'משימות, תורים והצעות מחיר': 'Tasks, appointments and quotes',
  'כל אחד בכרטיס משלו, הקרובים קודם. ה־"+" בכל כרטיס מוסיף משימה, תור או הצעה. ערך הליד מחושב מהצעות המחיר: מה שאושר ומה שנשלח ועדיין פתוח.':
    'Each in its own card, nearest first. The "+" on each card adds a task, an appointment or a quote. The lead\'s value comes from its quotes: what was accepted and what was sent and is still open.',
  'שיחה והיסטוריה': 'Conversation and history',
  'שתי לשוניות: השיחה עם הלקוח (אפשר לענות בוואטסאפ עד 24 שעות מההודעה האחרונה שלו) והערות והיסטוריה, כל מה שקרה בליד.':
    'Two tabs: the conversation with the customer (you can reply on WhatsApp up to 24 hours after their last message) and notes & history, everything that happened with the lead.',
};
