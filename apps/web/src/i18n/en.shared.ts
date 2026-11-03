/**
 * English for copy that comes from `packages/shared` and the API (labels, validation and error
 * messages), keyed by the Hebrew text (D-100). Messages with `{0}` are matched as patterns, so
 * "לפחות 10 תווים" finds "לפחות {0} תווים".
 */
export const enShared: Record<string, string> = {
  // Appointments
  'ממתין לאישור': 'Awaiting approval',
  מאושר: 'Confirmed',
  בוצע: 'Done',
  בוטל: 'Cancelled',
  'יש להזין שם לשירות': 'Enter a service name',
  'השם ארוך מדי (עד 80 תווים)': 'The name is too long (up to 80 characters)',
  'משך בין 5 דקות ל־8 שעות': 'Duration between 5 minutes and 8 hours',
  'יש להזין מחיר בשקלים (מספר שלם)': 'Enter a price (whole number)',
  'יש לבחור ליד או להזין שם וטלפון של הלקוח':
    "Choose a lead or enter the customer's name and phone",
  'יש להזין שם לקוח': 'Enter a customer name',
  'ההערות ארוכות מדי (עד 1,000 תווים)': 'The notes are too long (up to 1,000 characters)',
  'השירות שנבחר אינו קיים': "The selected service doesn't exist",
  'אפשר לשבץ רק חבר צוות פעיל בעסק': 'You can only assign an active team member',
  'הליד שנבחר אינו קיים': "The selected lead doesn't exist",
  'יש כבר תור בזמן הזה לאותו איש צוות. בחרו שעה אחרת או איש צוות אחר.':
    'This staff member already has an appointment at that time. Choose another time or staff member.',
  'כדי לאשר תור יש לשבץ איש צוות': 'Assign a staff member to confirm the appointment',
  'טווח לא תקין': 'Invalid range',
  // Auth
  'יש להזין שם מלא': 'Enter your full name',
  'השם המלא צריך להכיל לפחות {0} תווים': 'Your full name must be at least {0} characters',
  'השם המלא יכול להכיל עד {0} תווים': 'Your full name can be up to {0} characters',
  'יש להזין כתובת אימייל': 'Enter an email address',
  'כתובת האימייל אינה תקינה': 'This email address is not valid',
  'כתובת האימייל יכולה להכיל עד {0} תווים': 'The email address can be up to {0} characters',
  'יש להזין סיסמה': 'Enter a password',
  'הסיסמה צריכה להכיל לפחות {0} תווים': 'The password must be at least {0} characters',
  'הסיסמה יכולה להכיל עד {0} תווים': 'The password can be up to {0} characters',
  'יש לאשר את תנאי השימוש ומדיניות הפרטיות': 'Please accept the Terms of Use and Privacy Policy',
  'הקישור אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש':
    'The link is invalid or expired. You can request a new one',
  'האימייל או הסיסמה שגויים': 'The email or password is incorrect',
  'כתובת האימייל הזו כבר רשומה. אפשר להתחבר או לאפס סיסמה':
    'This email is already registered. Sign in or reset your password',
  'הסיסמה הנוכחית שגויה': 'The current password is incorrect',
  'הסיסמה החדשה זהה לנוכחית': 'The new password is the same as the current one',
  // Business
  'בעלי מקצוע (חשמל, אינסטלציה, שיפוצים)': 'Trades (electrical, plumbing, renovations)',
  'בעלי מקצוע': 'Trades',
  'מספרה וקוסמטיקה': 'Hair & beauty',
  'סטודיו וכושר': 'Studio & fitness',
  מוסך: 'Garage',
  'נותני שירות': 'Services',
  אחר: 'Other',
  ראשון: 'Sunday',
  שני: 'Monday',
  שלישי: 'Tuesday',
  רביעי: 'Wednesday',
  חמישי: 'Thursday',
  שישי: 'Friday',
  שבת: 'Saturday',
  'שעת פתיחה': 'Opening time',
  'שעת סגירה': 'Closing time',
  'יש להזין את שם העסק': 'Enter the business name',
  'שם העסק צריך להכיל לפחות {0} תווים': 'The business name must be at least {0} characters',
  'שם העסק יכול להכיל עד {0} תווים': 'The business name can be up to {0} characters',
  'יש לבחור תחום פעילות': 'Choose an industry',
  'יש להזין מספר טלפון': 'Enter a phone number',
  'מספר הטלפון אינו תקין. לדוגמה: 050-1234567':
    'This phone number is not valid. Example: 050-1234567',
  'הכתובת יכולה להכיל עד {0} תווים': 'The address can be up to {0} characters',
  'כתובת האתר אינה תקינה. לדוגמה: www.my-business.co.il':
    'This website address is not valid. Example: www.my-business.com',
  'כתובת האתר ארוכה מדי': 'The website address is too long',
  'כל אזור שירות יכול להכיל עד {0} תווים': 'Each service area can be up to {0} characters',
  'אפשר להוסיף עד {0} אזורי שירות': 'You can add up to {0} service areas',
  'יש להזין שעה בפורמט 09:00': 'Enter a time like 09:00',
  'שעת הסגירה צריכה להיות אחרי שעת הפתיחה': 'The closing time must be after the opening time',
  'כדי לסיים את ההקמה יש להשלים את שם העסק, התחום ומספר הטלפון':
    'To finish the setup, fill in the business name, industry and phone number',
  // Errors
  'חלק מהשדות אינם תקינים': 'Some fields are not valid',
  'יש להתחבר כדי להמשיך': 'Please sign in to continue',
  'אין לך הרשאה לבצע פעולה זו': "You don't have permission to do this",
  'הפריט המבוקש לא נמצא': "The requested item wasn't found",
  'הפעולה מתנגשת בנתונים קיימים': 'This conflicts with existing data',
  'יותר מדי ניסיונות. נסו שוב בעוד מספר דקות':
    'Too many attempts. Please try again in a few minutes',
  'אירעה שגיאה בלתי צפויה. נסו שוב מאוחר יותר': 'Something went wrong. Please try again later',
  // Leads & CRM
  'יש להזין שם': 'Enter a name',
  'השם ארוך מדי': 'The name is too long',
  'ההודעה ארוכה מדי (עד 1,000 תווים)': 'The message is too long (up to 1,000 characters)',
  'יש לאשר את יצירת הקשר כדי לשלוח': 'Please agree to be contacted to send',
  'נוצר קשר': 'Contacted',
  'הצעה נשלחה': 'Quote sent',
  ממתין: 'Waiting',
  נסגר: 'Won',
  אבוד: 'Lost',
  'טופס באתר': 'Website form',
  'הוזן ידנית': 'Added manually',
  'יש להזין טלפון או אימייל': 'Enter a phone or email',
  'יש להזין סכום בשקלים (מספר שלם)': 'Enter an amount (whole number)',
  'יש לכתוב הערה': 'Write a note',
  'ההערה ארוכה מדי (עד 2,000 תווים)': 'The note is too long (up to 2,000 characters)',
  'השלב שנבחר אינו קיים': "The selected stage doesn't exist",
  'אפשר לשייך רק לחבר צוות פעיל בעסק': 'You can only assign to an active team member',
  'תגית יכולה להכיל עד 30 תווים': 'A tag can be up to 30 characters',
  'אפשר עד 10 תגיות לליד': 'Up to 10 tags per lead',
  // Media
  'הקובץ גדול מדי (עד 8MB)': 'The file is too large (up to 8MB)',
  'אפשר להעלות רק תמונות JPG, PNG או WebP': 'Only JPG, PNG or WebP images can be uploaded',
  'לא הצלחנו לקרוא את התמונה. נסו קובץ אחר': "We couldn't read the image. Try another file",
  'נגמר מקום האחסון של העסק. מחקו תמונות שלא בשימוש':
    "The business's storage is full. Delete unused photos",
  'התמונה בשימוש באתר. הסירו אותה מהאתר לפני המחיקה':
    'The photo is used on the website. Remove it from the website before deleting',
  'אחת התמונות אינה שייכת לעסק': "One of the photos doesn't belong to the business",
  'לא נבחר קובץ': 'No file selected',
  // Notifications
  'ליד חדש מוואטסאפ': 'New lead from WhatsApp',
  'ליד חדש מהאתר': 'New lead from the website',
  '{0} · בקשה לתור: {1}': '{0} · appointment request: {1}',
  'הודעה מ{0}': 'Message from {0}',
  '{0} · מחכה לסיווג': '{0} · waiting to be classified',
  'הצעת מחיר אושרה': 'Quote accepted',
  '{0} · הצעה מס׳ {1}': '{0} · quote #{1}',
  'הצעת מחיר נדחתה': 'Quote declined',
  'הגיע הזמן למשימה': 'A task is due',
  // Roles
  'בעל/ת העסק': 'Owner',
  'מנהל/ת צוות': 'Manager',
  'עובד/ת': 'Employee',
  // Quotes
  טיוטה: 'Draft',
  נשלחה: 'Sent',
  אושרה: 'Accepted',
  נדחתה: 'Declined',
  'פג תוקף': 'Expired',
  'הכותרת ארוכה מדי (עד 120 תווים)': 'The title is too long (up to 120 characters)',
  'יש להוסיף לפחות שורה אחת': 'Add at least one line',
  'אפשר עד 50 שורות': 'Up to 50 lines',
  'יש לתאר את השירות או המוצר': 'Describe the service or product',
  'התיאור ארוך מדי (עד 300 תווים)': 'The description is too long (up to 300 characters)',
  'כמות בין 1 ל־9,999': 'Quantity between 1 and 9,999',
  'מחיר לא תקין': 'Invalid price',
  'ההנחה לא יכולה להיות גבוהה מהסכום': "The discount can't be more than the amount",
  'שיעור מע״מ לא תקין': 'Invalid VAT rate',
  'ההערות ארוכות מדי (עד 2,000 תווים)': 'The notes are too long (up to 2,000 characters)',
  'אפשר לערוך רק טיוטה. כדי לשנות הצעה שנשלחה, שכפלו אותה.':
    'Only drafts can be edited. To change a sent quote, duplicate it.',
  'ההצעה כבר אינה ממתינה להחלטה': 'The quote is no longer awaiting a decision',
  'תוקף ההצעה פג. אפשר לפנות לעסק לקבלת הצעה מעודכנת.':
    'The quote has expired. Contact the business for an updated quote.',
  'ללקוח אין כתובת אימייל. אפשר לשלוח את הקישור ב־WhatsApp או להעתיק אותו.':
    'The customer has no email address. Send the link on WhatsApp or copy it.',
  // Site
  'הכותרת יכולה להכיל עד {0} תווים': 'The title can be up to {0} characters',
  'הטקסט יכול להכיל עד {0} תווים': 'The text can be up to {0} characters',
  'המחיר יכול להכיל עד {0} תווים': 'The price can be up to {0} characters',
  'אפשר להוסיף עד {0} פריטים': 'You can add up to {0} items',
  'אפשר להוסיף עד {0} מקטעים': 'You can add up to {0} sections',
  'שדה חובה': 'Required',
  'האתר נערך בינתיים בחלון אחר. טענו מחדש כדי לראות את הגרסה העדכנית.':
    'The website was edited in another window meanwhile. Reload to see the latest version.',
  'לעסק כבר יש אתר': 'The business already has a website',
  'יש לבחור כתובת לאתר': 'Choose a website address',
  'אפשר להשתמש באותיות באנגלית, ספרות ומקף (3–40 תווים), בלי מקף בהתחלה או בסוף':
    'Use Latin letters, digits and hyphens (3–40 characters), not starting or ending with a hyphen',
  'הכתובת הזו שמורה למערכת. נסו כתובת אחרת': 'This address is reserved. Try another one',
  'הכתובת הזו כבר תפוסה. נסו כתובת אחרת': 'This address is taken. Try another one',
  'יש שינויים שעדיין נשמרים. נסו לפרסם שוב בעוד רגע':
    'Some changes are still saving. Try publishing again in a moment',
  'יש לתת שם לעמוד': 'Give the page a name',
  'כתובת העמוד: אותיות באנגלית, ספרות ומקף (עד 40 תווים)':
    'Page address: Latin letters, digits and hyphens (up to 40 characters)',
  'הכתובת הזו שמורה למערכת. בחרו כתובת אחרת': 'This address is reserved. Choose another one',
  'כבר יש עמוד בכתובת הזו': 'A page with this address already exists',
  'אפשר עד {0} עמודים נוספים': 'Up to {0} extra pages',
  'כותרת ראשית': 'Hero',
  אודות: 'About',
  גלריה: 'Gallery',
  מחירון: 'Prices',
  המלצות: 'Testimonials',
  'שאלות נפוצות': 'FAQ',
  'קריאה לפעולה': 'Call to action',
  'מעבר ליצירת קשר': 'Go to contact',
  'צור קשר': 'Contact',
  'דף נחיתה': 'Landing page',
  'עמוד ריק': 'Blank page',
  'תודה! קיבלנו את הפרטים ונחזור אליכם בהקדם.':
    'Thanks! We got your details and will get back to you soon.',
  'כותרת לגוגל יכולה להכיל עד 70 תווים': 'The Google title can be up to 70 characters',
  'תיאור לגוגל יכול להכיל עד 160 תווים': 'The Google description can be up to 160 characters',
  'מזהי מקטעים כפולים': 'Duplicate section ids',
  טורקיז: 'Turquoise',
  'ורוד עתיק': 'Antique rose',
  'כחול עמוק': 'Deep blue',
  'ירוק יער': 'Forest green',
  שזיף: 'Plum',
  גרפיט: 'Graphite',
  'רוביק — עגול וידידותי': 'Rubik — rounded and friendly',
  'חיבו — נקי ומודרני': 'Heebo — clean and modern',
  'אסיסטנט — קליל': 'Assistant — light',
  'פרנק ריהל — קלאסי': 'Frank Ruhl — classic',
  'צבע לא תקין': 'Invalid colour',
  'הצבע הראשי בהיר מדי לטקסט לבן על כפתורים. בחרו גוון כהה יותר':
    'The main colour is too light for white button text. Choose a darker shade',
  'יופי וטיפוח': 'Beauty & care',
  'למספרות, קוסמטיקה וסטודיו: שירותים, מחירון, המלצות וקביעת תור.':
    'For salons, cosmetics and studios: services, prices, testimonials and booking.',
  'בעלי מקצוע ושירות': 'Trades & services',
  'לחשמלאים, אינסטלטורים ושיפוצים: שירותים, אזורי שירות ו"התקשרו עכשיו".':
    'For electricians, plumbers and renovators: services, service areas and "Call now".',
  'מוסכים ורכב': 'Garages & cars',
  'למוסכים, פחחות וחשמלאי רכב: שירותים, הכנה לטסט, שעות פתיחה וקביעת טיפול.':
    'For garages, body shops and auto electricians: services, inspections, opening hours and booking.',
  'קליניקה ומטפלים': 'Clinics & therapists',
  'לפיזיותרפיה, טיפול רגשי, דיאטנים ורפואה משלימה: תהליך טיפול, שאלות נפוצות ופגישה.':
    'For physiotherapy, counselling, dietitians and complementary medicine: the process, FAQ and booking.',
  'מסעדה ובית קפה': 'Restaurants & cafés',
  'למסעדות, בתי קפה וקייטרינג: מהתפריט, שעות פתיחה, הזמנת שולחן ואירועים.':
    'For restaurants, cafés and catering: menu highlights, opening hours, reservations and events.',
  // Tasks
  'יש לכתוב מה צריך לעשות': 'Write what needs to be done',
  'הכותרת ארוכה מדי (עד 200 תווים)': 'The title is too long (up to 200 characters)',
  'אפשר להקצות רק לחבר צוות פעיל בעסק': 'You can only assign to an active team member',
  // Team
  'יש לבחור תפקיד': 'Choose a role',
  'האדם הזה כבר חבר בצוות': 'This person is already on the team',
  'יש יותר מדי הזמנות פתוחות. בטלו חלק מהן ונסו שוב':
    'There are too many open invitations. Cancel some and try again',
  'אי אפשר לשנות או להסיר את בעל/ת העסק': "The business owner can't be changed or removed",
  'ההזמנה אינה תקפה. בקשו מבעל/ת העסק לשלוח הזמנה חדשה':
    'The invitation is not valid. Ask the business owner to send a new one',
  'ההזמנה נשלחה לכתובת אימייל אחרת. התחברו עם החשבון שאליו נשלחה ההזמנה':
    'The invitation was sent to a different email. Sign in with the account it was sent to',
  // WhatsApp
  'יש לכתוב הודעה': 'Write a message',
  'ההודעה ארוכה מדי (עד {0} תווים)': 'The message is too long (up to {0} characters)',
  'WhatsApp עדיין לא מחובר לעסק הזה': "WhatsApp isn't connected to this business yet",
  'לליד הזה אין מספר טלפון': 'This lead has no phone number',
  'אפשר לענות בוואטסאפ רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח. כדי לפנות מחדש, התקשרו אליו.':
    "You can reply on WhatsApp only within 24 hours of the customer's last message. To reach them again, call them.",
  'ההודעה לא נשלחה. נסו שוב בעוד רגע': "The message wasn't sent. Try again in a moment",
  'המספר כבר משויך ללקוח במערכת. כדי להסיר אותו, מחקו את הליד.':
    'This number already belongs to a customer. To remove it, delete the lead.',
  'אפשר לבטל רק סימון של מספר פרטי': 'Only a personal marking can be undone',
  התקבלה: 'Received',
  נמסרה: 'Delivered',
  נקראה: 'Read',
  'לא נמסרה': 'Not delivered',
  // Small pieces used around the app
  ' על ידי הלקוח': ' by the customer',
  ' על ידי {0}': ' by {0}',
};
