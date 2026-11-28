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
  // D-211: a simpler lead page.
  'אין עדיין פרטים על הבקשה.': 'No details about the request yet.',
  'מה ביקשו': 'What they asked for',
  'עוד לא מולאו פרטים. אפשר להוסיף אותם ב"עריכה".':
    'No details filled in yet. Add them with "Edit".',
  'עוד לא מולאו פרטים.': 'No details filled in yet.',
  '{0} פתוח / {1} נסגר': '{0} open / {1} won',
  'כל המשימות ({0})': 'All tasks ({0})',
  'כל המשימות': 'All tasks',
  'סימון כבוצעה: {0}': 'Mark as done: {0}',
  '{0} קרובים': '{0} upcoming',
  התקשרות: 'Call',
  נוצר: 'Created',
  'עדיין אין הערות.': 'No notes yet.',
  'עוד פרטים': 'More details',
  'פעולות מהירות': 'Quick actions',
  'המשימה הפתוחה הקרובה: מה לעשות, מתי ומי אחראי. "בוצע" מסמן אותה, "+ משימה" מוסיף חדשה, ושאר המשימות ב"כל המשימות".':
    'The nearest open task: what to do, when and who\'s responsible. "Done" marks it, "+ Task" adds a new one, and the other tasks are under "All tasks".',
  'השיחה עם הלקוח (אפשר לענות בוואטסאפ עד 24 שעות מההודעה האחרונה שלו) וההערות של הצוות.':
    "The conversation with the customer (you can reply on WhatsApp up to 24 hours after their last message) and the team's notes.",
  'מה הלקוח כתב והפרטים שמילאתם. "עריכה" פותחת את הטופס, ושומרים בכפתור "שמירה".':
    'What the customer wrote and the details you filled in. "Edit" opens the form; save with "Save".',
  'מי הלקוח, באיזה שלב הוא, וכפתורים להתקשר או לכתוב לו בוואטסאפ.':
    "Who the customer is, which stage they're in, and buttons to call them or write on WhatsApp.",
  'עוד בלחיצה': 'More, one click away',
  'שיחה והערות': 'Conversation and notes',
  'WhatsApp: מעבר לשיחה בעמוד': 'WhatsApp: go to the conversation on this page',
  'WhatsApp: פתיחה בחלון חדש': 'WhatsApp: opens in a new window',
  // D-212: two-column lead page on wide screens.
  'אין שדות נוספים.': 'No extra fields.',
  'ביטול שינויים': 'Discard changes',
  '{0} אירועים': '{0} events',
  'ליד מ־{0}': 'Lead from {0}',
  'לידים קשורים': 'Related leads',
  'מאפייני הליד': 'Lead properties',
  מאפיינים: 'Properties',
  'ערך לפי הצעות מחיר': 'Value from quotes',
  // F35: linked tasks and automatic follow-ups.
  'אין לך הרשאה לראות את המשימות האלה.': "You don't have permission to see these tasks.",
  'אין משימות על ההצעה הזו.': 'No tasks on this quote.',
  'אין משימות על התור הזה.': 'No tasks on this appointment.',
  'משימות על ההצעה': 'Tasks on the quote',
  'משימות על התור': 'Tasks on the appointment',
  'טוענים את ההגדרות…': 'Loading the settings…',
  'כשנקבע תור נוצרת משימה "לאשר את התור", יום לפני התור ב־09:00 (שישי ושבת עוברים ליום ראשון, או ליום חמישי אם התור לפני כן). נסגרת מעצמה כשהתור מבוטל, מתקיים או מסומן שלא הגיעו.':
    'When an appointment is booked, a task "Confirm the appointment" is created for the day before at 09:00 (Friday and Saturday move to Sunday, or to Thursday if the appointment comes first). It closes by itself when the appointment is cancelled, takes place or is marked as a no-show.',
  'כשנשלחת הצעה נוצרת משימה "לחזור לגבי הצעה", יומיים אחרי השליחה ב־09:00 (שישי ושבת עוברים ליום ראשון). נסגרת מעצמה כשההצעה מאושרת או נדחית.':
    'When a quote is sent, a task "Follow up on quote" is created two days later at 09:00 (Friday and Saturday move to Sunday). It closes by itself when the quote is accepted or rejected.',
  'משימת מעקב אחרי הצעה': 'Quote follow-up task',
  'משימת אישור תור': 'Appointment confirmation task',
  'משימות אוטומטיות': 'Automatic tasks',
  'משימות מעקב שהמערכת כותבת וסוגרת בשבילך. משימות שהוספתם בעצמכם לא נסגרות מעצמן.':
    'Follow-up tasks the system writes and closes for you. Tasks you add yourselves never close by themselves.',
  'רק בעלי העסק ומנהלים יכולים לשנות את ההגדרות האלה.':
    'Only owners and managers can change these settings.',
  'אין משימות פתוחות מהסוג הזה': 'No open tasks of this type',
  'אישור תורים': 'Appointment confirmations',
  'אפשר לבחור סוג אחר, או "כל הסוגים".': 'Choose another type, or "All types".',
  ידניות: 'Manual',
  'כל הסוגים': 'All types',
  'מעקב אחרי הצעות': 'Quote follow-ups',
  'סוג משימה': 'Task type',
  אוטומטית: 'Automatic',
  'הצעה #{0}': 'Quote #{0}',
  'הצעה מקושרת': 'Linked quote',
  'הצעת מחיר או תור של הליד (לא חובה)': "One of the lead's quotes or appointments (optional)",
  ללא: 'None',
  'נוצרה אוטומטית, ותיסגר מעצמה כשההצעה תאושר או תידחה.':
    'Created automatically; it closes by itself when the quote is accepted or rejected.',
  'נוצרה אוטומטית, ותיסגר מעצמה כשהתור יבוטל, יתקיים או יסומן שלא הגיעו.':
    'Created automatically; it closes by itself when the appointment is cancelled, takes place or is marked as a no-show.',
  'על הצעה #{0}': 'About quote #{0}',
  'על התור ב־{0}': 'About the appointment on {0}',
  'קשור ל…': 'About…',
  'תור {0}': 'Appointment {0}',
  'תור מקושר': 'Linked appointment',
  'אוטומציות של וואטסאפ': 'WhatsApp automations',
  // F35 server messages (shared taskMessages).
  'ההצעה שנבחרה אינה קיימת': "The selected quote doesn't exist",
  'התור שנבחר אינו קיים': "The selected appointment doesn't exist",
  'אפשר לקשר משימה להצעה או לתור, לא לשניהם':
    'A task can be about a quote or an appointment, not both',
  'ההצעה או התור שייכים לליד אחר. בטלו את הקישור או בחרו את הליד שלהם.':
    'The quote or appointment belongs to another lead. Remove the link or choose their lead.',
  // D-217: lead page header.
  'באחריות {0}': 'Owned by {0}',
  'הגיע מ־{0}': 'Came from {0}',
  'העתקת {0}': 'Copy {0}',
  'התקשרות ל־{0}': 'Call {0}',
  'מייל ל־{0}': 'Email {0}',
  // D-218.
  '{0} פתוח · {1} נסגר': '{0} open · {1} won',
  // D-219: tabs with counts and a communication panel.
  '{0}, {1} הודעות חדשות': '{0}, {1} new messages',
  'אין פרטי קשר לליד הזה.': 'No contact details for this lead.',
  'הוספה לליד': 'Add to the lead',
  הליד: 'The lead',
  הערה: 'Note',
  'הערות, {0}': 'Notes, {0}',
  הצעות: 'Quotes',
  'הצעות, {0} · {1} פתוח': 'Quotes, {0} · {1} open',
  'הצעות, {0}': 'Quotes, {0}',
  'השיחה בעמוד הזה': 'Conversation on this page',
  'ממתין לתשובה שלך:': 'Waiting for your reply:',
  משימה: 'Task',
  'משימות, {0} פתוחות': 'Tasks, {0} open',
  'נפתח בחלון חדש': 'Opens in a new window',
  'עדיין אין כאן הערות, משימות, הצעות או תורים. הכפתור + מוסיף את הראשון.':
    'No notes, tasks, quotes or appointments yet. The + button adds the first one.',
  'שיחה, הערות ומשימות': 'Conversation, notes and tasks',
  'תורים, {0} קרובים': 'Appointments, {0} upcoming',
  תקשורת: 'Communication',
  'הכול בלשוניות': 'Everything in tabs',
  'המשימה הפתוחה הקרובה: מה לעשות, מתי ומי אחראי. "בוצע" מסמן אותה ו"+ משימה" מוסיף חדשה.':
    'The nearest open task: what to do, when and who\'s responsible. "Done" marks it and "+ Task" adds a new one.',
  'הפרטים בצד': 'The details at the side',
  'השיחה, ההערות, המשימות, ההצעות והתורים, כל אחד עם המספר שלו. לשונית ריקה לא מוצגת, והכפתור + מוסיף פריט חדש.':
    'The conversation, notes, tasks, quotes and appointments, each with its count. An empty tab is hidden, and the + button adds a new item.',
  'תקשורת (וואטסאפ, טלפון ואימייל), פרטי הליד והשדות שלכם. בסוף, ב"עוד": לידים קשורים והיסטוריה.':
    'Communication (WhatsApp, phone and email), the lead\'s details and your fields. At the end, under "More": related leads and history.',
  // D-220: one column, a lead-info tab.
  מידע: 'Info',
  'מידע, השיחה, ההערות, המשימות, ההצעות והתורים, כל אחד עם המספר שלו. הכפתור + מוסיף פריט חדש.':
    'Info, the conversation, notes, tasks, quotes and appointments, each with its count. The + button adds a new item.',
  'השלב, האחראי, המקור, הטלפון והאימייל ומה ביקשו. מתחת: תקשורת, השדות שלכם, לידים קשורים והיסטוריה.':
    'The stage, owner, source, phone and email and what they asked for. Below: communication, your fields, related leads and history.',
  // D-221: a "תקשורת" tab with channel sub-tabs.
  'ערוצי תקשורת': 'Communication channels',
  'אין מספר טלפון לליד.': 'This lead has no phone number.',
  'פתיחה ב־WhatsApp': 'Open in WhatsApp',
  'אין כתובת מייל לליד.': 'This lead has no email address.',
  '+ מייל': '+ Email',
  'שיחת מייל': 'Email conversation',
  'שיחת פייסבוק': 'Facebook conversation',
  'שיחת אינסטגרם': 'Instagram conversation',
  'אין שיחת וואטסאפ עם הליד.': 'No WhatsApp conversation with this lead.',
  'אין עדיין מיילים עם הליד.': 'No emails with this lead yet.',
  'אין שיחת פייסבוק עם הליד.': 'No Facebook conversation with this lead.',
  'אין שיחת אינסטגרם עם הליד.': 'No Instagram conversation with this lead.',
  'אחרי חיבור מספר WhatsApp לעסק, ההודעות יופיעו כאן.':
    'Once a WhatsApp number is connected to the business, messages will show here.',
  'עדיין אין מיילים. כשהלקוח יכתוב לעסק במייל, השיחה תופיע כאן.':
    'No emails yet. When the customer emails the business, the conversation will show here.',
  'תשובה מהעמוד נשלחת ב־{0}, הערוץ שבו הלקוח כתב לאחרונה.':
    'A reply from this page goes out on {0}, the channel the customer wrote in last.',
  // Lead page "לקוח" tab (owner, 2026-11-28).
  לקוח: 'Customer',
  פניות: 'Inquiries',
  'סה״כ רכישות': 'Total purchases',
  'איתנו מאז': 'With us since',
  'פניות נוספות': 'Other inquiries',
};
