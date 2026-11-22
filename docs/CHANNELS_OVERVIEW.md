# הערוצים במבט אחד: וואטסאפ, פייסבוק, אינסטגרם, Gmail

דף מסכם אחד לכל ההגדרות. מי שרוצה פירוט לוואטסאפ: `WHATSAPP_ADD_NUMBER.md` ו-`WHATSAPP_CUSTOMER_SETUP.md`. פירוט טכני: `docs/features/F25.md` (חיבורים), `F23.md` (פייסבוק), `F28.md` (אינסטגרם), `F29.md` (Gmail).

## 1. איך זה בנוי (הכלל שמסדר את הבלגן)

יש **שלושה מקומות** שבהם מגדירים דברים, ולכל ערוץ יש חלק בכל אחד מהם:

| מקום                                   | מה מגדירים שם                                                 | באיזו תדירות                                   |
| -------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| **Render ← Environment**               | מפתחות של האפליקציה שלנו מול Meta ו-Google                    | פעם אחת, לכל המערכת                            |
| **Meta for Developers / Google Cloud** | האפליקציה שלנו שם: כתובות חזרה, webhook, הרשאות, משתמשי בדיקה | פעם אחת, לכל המערכת                            |
| **באפליקציה ← הגדרות ← ערוצים**        | חיבור של עסק מסוים (הדף שלו, המספר שלו, ה-Gmail שלו)          | פעם אחת **לכל עסק**, ובעל העסק עושה אותו בעצמו |

שני המקומות הראשונים הם שלך כבעלים של המערכת. השלישי הוא של הלקוחות.

## 2. משתני הסביבה ב-Render

| משתנה                    | לאיזה ערוץ        | ערך                                                           | חובה?                           |
| ------------------------ | ----------------- | ------------------------------------------------------------- | ------------------------------- |
| `META_APP_ID`            | פייסבוק, אינסטגרם | App ID מ-Meta ← App settings ← Basic                          | כן, בלעדיו המתג אפור            |
| `WHATSAPP_APP_SECRET`    | כל ערוצי Meta     | App secret מאותו מסך. חותם את ה-webhook                       | כן                              |
| `WHATSAPP_VERIFY_TOKEN`  | כל ערוצי Meta     | מילה לבחירתך (8 תווים ומעלה). אותה מילה בכל ה-webhooks ב-Meta | כן                              |
| `WHATSAPP_PROVIDER`      | וואטסאפ           | `cloud`                                                       | כן, אחרת ההודעות לא נשלחות באמת |
| `MESSENGER_PROVIDER`     | פייסבוק, אינסטגרם | `cloud` (מופיע גם ב-`render.yaml`)                            | כן, אחרת תשובות לא נשלחות באמת  |
| `META_LOGIN_CONFIG_ID`   | פייסבוק, אינסטגרם | Configuration ID מ-Facebook Login for Business                | מומלץ                           |
| `GOOGLE_CLIENT_ID`       | Gmail             | Client ID מ-Google Auth Platform ← Clients                    | כן, בלעדיו המתג אפור            |
| `GOOGLE_CLIENT_SECRET`   | Gmail             | הסוד של אותו client (מתחיל ב-`GOCSPX-`)                       | כן                              |
| `APP_URL`, `WEB_ORIGINS` | הכול              | `https://app.simplecatch.co.il`                               | כן                              |

**משתנים שצריך שלא יהיו** (חיבור ישן של דף אחד דרך הסביבה, שנועל את המתג של העסק ב"דרך הגדרות המערכת"): `MESSENGER_BUSINESS_ID`, `MESSENGER_PAGE_ID`, `MESSENGER_PAGE_ACCESS_TOKEN`, ובוואטסאפ `WHATSAPP_BUSINESS_ID`.

כל סוד (App secret, Client secret) מדביקים רק ב-Render. לא בצ'אט, לא בקוד ולא בצילום מסך.

## 3. הכתובות שמדביקים ב-Meta וב-Google

| מה                                           | איפה                                                                          | הכתובת                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Webhook של וואטסאפ                           | Meta ← WhatsApp ← Configuration                                               | `https://app.simplecatch.co.il/api/v1/integrations/whatsapp/webhook`           |
| Webhook של פייסבוק ושל אינסטגרם (אותה כתובת) | Meta ← Webhooks (או Instagram ← API setup)                                    | `https://app.simplecatch.co.il/api/v1/integrations/messenger/webhook`          |
| Verify token                                 | בכל ה-webhooks                                                                | אותה מילה כמו `WHATSAPP_VERIFY_TOKEN`                                          |
| כתובת חזרה של פייסבוק ואינסטגרם              | Meta ← Facebook Login for Business ← Settings ← **Valid OAuth Redirect URIs** | `https://app.simplecatch.co.il/api/v1/integrations/facebook/callback`          |
| App Domains                                  | Meta ← App settings ← Basic                                                   | `app.simplecatch.co.il` ו-`simplecatch.co.il`                                  |
| כתובת חזרה של Gmail                          | Google ← Clients ← ה-client ← **Authorized redirect URIs**                    | `https://app.simplecatch.co.il/api/v1/integrations/gmail/callback`             |
| מדיניות פרטיות, תנאים, מחיקת נתונים          | Meta Basic, Google Branding                                                   | `https://simplecatch.co.il/privacy.html`, `/terms.html`, `/data-deletion.html` |

טעות נפוצה: הכתובת של Gmail היא ב-**Authorized redirect URIs**, לא ב-JavaScript origins.

## 4. כל ערוץ: מה צריך ומה אפשר לבדוק

### וואטסאפ

- Render: `WHATSAPP_PROVIDER`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- Meta: webhook עם `messages`; מספר אמיתי בחשבון WhatsApp (פירוט במדריכים).
- באפליקציה: הלקוח מדביק Phone number ID וטוקן (אין עדיין חיבור בלחיצה).
- **בדיקה:** שולחים הודעה למספר, והיא מופיעה בשיחות.

### פייסבוק (Messenger)

- Render: `META_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `MESSENGER_PROVIDER=cloud`, ובלי `MESSENGER_*` של הדף.
- Meta: Facebook Login for Business ← Settings ← Valid OAuth Redirect URIs; App Domains; webhook לדף עם `messages` ו-`message_echoes`; הרשאות `pages_show_list`, `pages_messaging`, `pages_manage_metadata`.
- באפליקציה: הגדרות ← ערוצים ← פייסבוק ← כניסה עם פייסבוק ← בחירת דף.
- **עד App Review** רק מי שיש לו תפקיד (Admin / Developer / Tester) באפליקציה ב-Meta יכול להתחבר ולקבל הודעות.
- **בדיקה:** מחשבון אחר שיש לו תפקיד, שולחים הודעה לדף.

### אינסטגרם

- כל מה שיש לפייסבוק, ובנוסף:
- Meta: מקרה השימוש **Instagram API**, עם **API setup with Facebook login**, ההרשאות `instagram_basic` ו-`instagram_manage_messages` ב-Configuration, webhook ל-Instagram עם `messages`.
- חשבון אינסטגרם **עסקי או Creator**, מקושר לדף פייסבוק, עם גישה להודעות ל"כלים מחוברים".
- באפליקציה: ערוצים ← Instagram. אם הפייסבוק כבר מחובר, זו לחיצה אחת.
- **בדיקה:** שולחים הודעה לחשבון מחשבון אינסטגרם אחר שיש לו תפקיד באפליקציה.

### Gmail

- Render: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Google: Gmail API מופעל; Data Access עם `gmail.readonly` ו-`gmail.send`; Audience במצב **Testing** עם כתובות ה-Gmail ב-**Test users**; client מסוג Web עם כתובת החזרה למעלה.
- באפליקציה: ערוצים ← Gmail ← כניסה עם Google (אזהרת "לא מאומת" ← Advanced ← המשך).
- **בדיקה:** שולחים מייל ל-Gmail מכתובת אחרת, ומחכים עד 2 דקות. הוא מופיע בשיחות עם שאלה "לקוח או פרטי?".
- במצב Testing הכניסה פגה כל 7 ימים.
- הסריקה רצה רק כשהשרת ער. ב-Render החינמי, כדאי ניטור שקורא ל-`/health` כל 10 דקות.

## 5. מה כל שגיאה אומרת

| מה רואים                                          | הסיבה                                                           | התיקון                                                             |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| המתג אפור, "חיבור … עוד לא הוגדר במערכת"          | חסר `META_APP_ID` או `GOOGLE_CLIENT_ID` ב-Render                | להוסיף ולפרוס                                                      |
| בשורת פייסבוק כתוב "דרך הגדרות המערכת"            | נשארו `MESSENGER_BUSINESS_ID` וחבריו                            | למחוק ב-Render                                                     |
| Facebook: "URL blocked" / "domain not included"   | חסר App Domain או Valid OAuth Redirect URI                      | להוסיף ב-Meta ולשמור                                               |
| Facebook: "האפליקציה לא פעילה"                    | מי שמתחבר אינו בעל תפקיד באפליקציה (מצב פיתוח)                  | להוסיף כ-Tester ושיאשר, או App Review                              |
| Google: `invalid_client` / "client was not found" | `GOOGLE_CLIENT_ID` שגוי או חתוך                                 | להעתיק מחדש מ-Clients                                              |
| "החיבור ל-Gmail לא הצליח"                         | בדרך כלל Gmail API לא מופעל, secret שגוי או כתובת חזרה לא תואמת | לבדוק את שלושתם; בלוג ב-Render: `gmail sign-in failed` עם `status` |
| תשובות נרשמות בשיחה אבל לא מגיעות ללקוח           | `MESSENGER_PROVIDER` או `WHATSAPP_PROVIDER` לא `cloud`          | להגדיר ולפרוס                                                      |
| Webhook "Verify" נכשל ב-Meta                      | הפריסה לא הסתיימה, או ה-verify token שונה מזה שב-Render         | לוודא Live ואותה מילה                                              |

## 6. לפני שפותחים ללקוחות אמיתיים

1. **Meta:** App Review (הרשאות הודעות לדפים ולאינסטגרם), ייתכן Business Verification, סרטון הדגמה, ומעבר ל-Live.
2. **Google:** פרסום האפליקציה ואימות; כי הרשאת הקריאה של Gmail מוגבלת, נדרשת גם בדיקת אבטחה חיצונית (CASA). עד אז עד 100 משתמשי בדיקה.
3. הדפים הציבוריים (פרטיות, תנאים, מחיקת נתונים) והמייל `support@simplecatch.co.il` פעילים. הדפים הם טיוטה לבדיקה משפטית (O-007).
