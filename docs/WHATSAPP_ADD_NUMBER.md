# הוספת מספר WhatsApp חדש ל-SimpleCatch (הרצף שנוסה בפועל)

מדריך פנימי. מתאר את הרצף שהוביל לחיבור מספר דרך Meta Cloud API, בעסק אחד ב-Meta ובלי שיתוף שותפים. מבוסס על מה שנוסה והצליח בנובמבר 2026. שמות מסכים של Meta עלולים להשתנות.

מה שלא נבדק עד הסוף מסומן **[לא אומת]**. נכון למועד הכתיבה, בדיקת הודעה נכנסת ויוצאת עדיין לא בוצעה (סעיף 8).

## 1. הכנה חד-פעמית (כבר נעשה)

- עסק ב-Meta (**SimpleCatch**) ואפליקציה בו (**SimpleCatch**, בעבר LeadFlow Demo).
- אימות דו-שלבי בחשבון הפייסבוק האישי, ו"כולם" בכרטיס האימות הדו-שלבי במרכז האבטחה של העסק.
- ב-Render (Environment): `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_ID`, ו**בלי** `WHATSAPP_BUSINESS_ID`.
- ב-Meta, ב-Configure Webhooks: כתובת `https://app.simplecatch.co.il/api/v1/integrations/whatsapp/webhook`, אותו verify token, והרשמה לשדה **messages**.
- משתמש מערכת **SimpleCatch API** (Admin) עם האפליקציה בשליטה מלאה.

## 2. להכין את המספר

מספר פנוי שמקבל SMS או שיחה. אם הוא פעיל באפליקציית WhatsApp או WhatsApp Business, מוחקים קודם את החשבון שלו שם, כי מספר לא יכול להיות גם באפליקציה וגם ב-Cloud API.

## 3. חשבון WhatsApp אמיתי (פעם ראשונה בלבד)

ב-Business Settings ← חשבונות ← חשבונות WhatsApp ← **הוספה** ← יצירת חשבון חדש: שם SimpleCatch, אזור זמן Asia/Jerusalem, קטגוריה, ובחירה ב"הוספה של מספר חדש". חשבון הבדיקה (Test Messaging Account) לא מקבל מספרים אמיתיים. למספר נוסף משתמשים באותו חשבון.

## 4. להוסיף את המספר

ב-WhatsApp Manager ← מספרי טלפון ← **הוספת מספר טלפון**:

- מדינה ישראל +972, המספר בלי 0 בהתחלה.
- שם תצוגה שמתאים לעסק ולאתר, בלי המילה WhatsApp ובלי תווים מיוחדים.
- אימות בקוד ב-SMS או בשיחה.

הסטטוס "בהמתנה" אומר שהמספר עוד לא פעיל. אצלנו הסיבה הייתה שהוא לא נרשם ל-Cloud API (סעיף 5), ולא רק המתנה לאישור שם התצוגה.

## 5. לרשום את המספר ל-Cloud API

ב-Developers ← האפליקציה ← מקרי שימוש ← Connect on WhatsApp ← **Step 2. Production setup**:

- ליד המספר מופיע **Not registered**. לוחצים **Register**, ובוחרים PIN בן שש ספרות ושומרים אותו.
- מדליקים **Subscribe webhooks** של החשבון.
- מעתיקים את ה-**Phone Number ID** שמופיע ליד המספר (לא להקליד ידנית).

בחשבון Meta בלי אימות עסק אפשר להוסיף עד שני מספרים (עד 20 אחרי אימות).

## 6. הרשאות לטוקן

ב-Business Settings ← משתמשי מערכת ← **SimpleCatch API** ← **הקצאת נכסים**: האפליקציה **וגם** חשבון ה-WhatsApp (בקטגוריה "חשבונות WhatsApp", לא Messaging accounts), שניהם בשליטה מלאה. אם החשבון כבר משויך, מדלגים.

## 7. ליצור טוקן קבוע

באותו משתמש: **ליצור אסימון** ← בוחרים את האפליקציה ← תפוגה **Never** (או 60 יום אם זו האפשרות היחידה) ← הרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management`.

- הטוקן מוצג פעם אחת. מעתיקים אותו מיד ומשתמשים בו רק בטופס במערכת. לא שולחים אותו בצ'אט, במייל או בקוד.
- טוקן קבוע אחד מכסה את כל המספרים של החשבונות המשויכים למשתמש, ולכן מספר נוסף באותו חשבון לא דורש טוקן חדש.
- הטוקן הזמני מ-Step 1 פג אחרי 24 שעות ולא מתאים.

## 8. לחבר במערכת ולבדוק

בהגדרות ← ערוצים ← WhatsApp: מדביקים Phone Number ID וטוקן. המערכת בודקת אותם מול Meta ושומרת את הטוקן מוצפן.

- הכרטיס אמור להיות **מחובר** עם שם, ו**בלי** הכיתוב "דרך הגדרות המערכת". אם הכיתוב מופיע, `WHATSAPP_BUSINESS_ID` עדיין מוגדר ב-Render.
- **בדיקה נכנסת:** שולחים הודעה למספר מטלפון אחר. היא אמורה להופיע בשיחות ולהפוך לליד, או להמתין כ"מספר חדש" עד לסימון עסקי. **[לא אומת]**
- **בדיקה יוצאת:** עונים מהמערכת, בתוך 24 שעות מהודעת הלקוח. **[לא אומת]**

אם ההודעה לא מגיעה: בודקים ב-Developers את Configure Webhooks (כתובת, verify token, מנוי ל-messages, כפתור Test), בלוגים של Render אם הבקשה הגיעה ואם נדחתה (חתימה לא תקינה), ושה-`WHATSAPP_APP_SECRET` הוא ה-App secret של האפליקציה. כשהאפליקציה במצב פיתוח ייתכן ש-Meta מוסרת הודעות רק ממשתמשים עם תפקיד באפליקציה. **[לא אומת]**

## מלכודות שנתקלנו בהן

| בעיה | מה היה |
| --- | --- |
| שיתוף שותף בין שני עסקים | נכשל שוב ושוב ב-"Unable to add a partner" (גם אחרי 2FA). לכן כל הרצף בעסק אחד. |
| המספר "בהמתנה" | לא היה רשום ל-Cloud API. הרישום (Register) הוא שלב נפרד ב-Step 2. |
| "Add phone number" כבוי | החשבון שנבחר היה Test Messaging Account. עוברים לחשבון אמיתי. |
| "דרך הגדרות המערכת" | חיבור ישן של POC דרך Render. מוחקים את `WHATSAPP_BUSINESS_ID` כדי שהטופס יופיע. |
| שם האפליקציה עדיין LeadFlow | נשאר מהשם הישן. משנים ב-App settings ← Basic ← Display name. |
| Phone Number ID שגוי | התבלבלנו בין Phone Number ID לבין Messaging account ID. הם שני מספרים שונים. |

## אימות עסק

בלי אימות עסק יש מגבלה של 250 לקוחות ל-24 שעות. אימות עסק, App Review ו-Embedded Signup דורשים עסק רשום, ולכן לא נעשו. בינתיים כל מספר מתווסף ידנית לפי הרצף הזה.

## קישורים

- אפליקציות: https://developers.facebook.com/apps
- חשבונות WhatsApp: https://business.facebook.com/settings/whatsapp-business-accounts
- WhatsApp Manager, מספרי טלפון: https://business.facebook.com/wa/manage/phone-numbers/
- משתמשי מערכת: https://business.facebook.com/settings/system-users
- מדריך Meta: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
