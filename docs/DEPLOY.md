# Deploying LeadFlow for free (test version)

This puts LeadFlow on the internet at no cost, for you and a few test businesses (D-119).
Everything runs as one service on Render; the database is on Neon; emails go out through
Brevo (optional).

| Piece                       | Where                              | Free plan limits                                   |
| --------------------------- | ---------------------------------- | -------------------------------------------------- |
| App, API, customer websites | Render web service (`render.yaml`) | Sleeps after 15 min idle, ~1 min to wake; 750 h/mo |
| Database (and photos)       | Neon Postgres                      | 0.5 GB, 100 compute hours/mo, pauses when idle     |
| Email                       | Brevo email API (optional)         | 300 emails a day                                   |

Addresses: the app is `https://<service>.onrender.com`, and a business's website is
`https://<service>.onrender.com/s/<its-name>`.

## 1. Database — Neon (5 minutes)

1. Sign up at <https://neon.com> (GitHub or Google sign-in is fine).
2. Create a project: name `leadflow`, Postgres 16 or newer, region **Frankfurt** (closest to Israel).
3. On the project dashboard click **Connect**, turn **Connection pooling off**, and copy the
   connection string. It looks like
   `postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   Keep it private — it is the database password.

## 2. Email — Brevo (optional, 5 minutes)

Render's free plan blocks outgoing SMTP (ports 25/465/587), so Gmail SMTP can't be used there;
Brevo sends over HTTPS instead, free for 300 emails a day, from one verified address (no domain).
Until it's set up, email is off (`EMAIL_TRANSPORT=disabled`): everything works, but no
verification, reset, new-lead or invitation emails go out.

1. Sign up at <https://www.brevo.com> (free plan).
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: your Gmail address; confirm
   the email Brevo sends you.
3. **SMTP & API → API keys → Generate a new API key**; copy it (shown once).
4. In Render → the service → **Environment**: `BREVO_API_KEY` = the key, `EMAIL_FROM` =
   `LeadFlow <the verified address>`, and `EMAIL_TRANSPORT` = `brevo` (also change it in
   `render.yaml`, or the Blueprint sets it back).

## 3. App — Render (10 minutes)

1. Make sure the latest code is on GitHub (`main` branch of your `leadflow` repository).
2. Sign up at <https://render.com> with GitHub.
3. **New → Blueprint**, pick the `leadflow` repository. Render reads `render.yaml` and asks for
   the private values:
   - `DATABASE_URL` — the Neon connection string from step 1.
   - `BREVO_API_KEY`, `EMAIL_FROM` — from step 2, or leave empty while email is off.
4. **Apply**. The first build takes about 5–8 minutes. When the log shows the server listening,
   open the `https://….onrender.com` address and create your account.

Every push to `main` deploys again automatically.

## 4. WhatsApp (optional, later)

Your own number, connected by hand. Two parts: the server once, then the number.

**A. The server (once).** In Render → the service → **Environment**, fill in:

| Variable                | Value                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `WHATSAPP_PROVIDER`     | `cloud`                                                     |
| `WHATSAPP_APP_SECRET`   | Meta app → App settings → Basic → App secret                |
| `WHATSAPP_VERIFY_TOKEN` | any word you choose; the same word goes into Meta's webhook |
| `META_APP_ID`           | Meta app → App settings → Basic → App ID                    |

Without `cloud` and the app secret the Channels form accepts anything without asking Meta, and
messages are recorded here but never delivered. Save, and let Render redeploy.

**B. Meta.**

1. [developers.facebook.com](https://developers.facebook.com) → create an app (type Business), add the
   **WhatsApp** product, and add your number. A number that is already in the regular WhatsApp or
   WhatsApp Business app can't be used until it is removed from there; a number of its own is best.
2. WhatsApp → API setup: copy the **Phone number ID**.
3. A permanent token (the temporary one expires after 24 hours): Business settings → Users →
   System users → add one, give it full control of the app and the WhatsApp account, and generate a
   token with `whatsapp_business_messaging` (and `whatsapp_business_management`).
4. WhatsApp → Configuration → Webhook: callback URL
   `https://<service>.onrender.com/api/v1/integrations/whatsapp/webhook`, the verify token from
   part A, then subscribe to the **messages** field.

**C. In LeadFlow.** Settings → Channels → **Connect WhatsApp**: paste the Phone number ID and the
token. They are checked with Meta first, and the token is stored encrypted.

**D. Try it.** Send a message to the number from another phone: it appears in Conversations and
becomes a lead. Until the Meta app is live and the business verified, Meta only lets test numbers
message you, and caps the number of conversations.

Good to know: the webhook is signed with one app secret, so the number must belong to the Meta app
named in part A. One-click connection for other businesses (Embedded Signup) needs LeadFlow to be a
Meta Tech Provider and isn't built yet (D-159). Customers can be answered freely for 24 hours after
their last message; later messages need an approved template, which isn't supported yet.

## 5. Email conversations (optional, later)

Customers write to a forwarding address, and your team answers from the inbox (F27, D-177). It needs
three things that are yours to choose, so nothing is switched on until you set them:

1. A domain for the addresses (for example `mail.example.com`) and an inbound-email service on it
   (MX records) that can post each message to
   `https://<service>.onrender.com/api/v1/integrations/email/inbound` as JSON, signed with
   `X-LeadFlow-Signature: sha256=<HMAC-SHA256 of the body>`. The JSON shape is `emailInboundSchema` in
   `packages/shared/src/channels.ts`; a small adapter per provider turns its own format into it.
2. In Render → Environment: `EMAIL_INBOUND_DOMAIN` (that domain) and `EMAIL_INBOUND_SECRET` (a long
   random string, the same one the service signs with).
3. For replies: `EMAIL_TRANSPORT` other than `disabled` (see step 2), with the sending domain verified
   (SPF/DKIM) at the email provider so replies from `…@mail.example.com` are accepted.

Then Settings → Channels → Email → **Create address**. Locally, `pnpm --filter @leadflow/api
mail:simulate --to <address>` stands in for the inbound service.

## Good to know

- **Sleeping:** after 15 minutes without visitors the server sleeps; the next visit takes about a
  minute. A free uptime monitor (e.g. UptimeRobot) calling `/health` every 10 minutes keeps it
  awake — one service fits in the 750 free hours a month.
- **Reminders and the booking bot's follow-ups** only run while the server is awake.
- **Data:** this is a test setup. Before real customers: a paid instance (no sleep), backups, the
  privacy review (O-007) and a domain of your own.
- **Moving to a domain later:** buy one, point `*.yourdomain` and `app.yourdomain` at Render, set
  `PUBLIC_SITE_MODE=host` and `PUBLIC_SITE_HOST=yourdomain`, and send email from your domain
  (O-009).

## Sample data for a demo account

To make an account look lived-in (about 20 leads with history, tasks, appointments, quotes and
WhatsApp conversations, all tagged "דוגמה"), run from the repository on your computer:

```bash
DATABASE_URL='<the Neon connection string>' pnpm --filter @leadflow/api seed:demo --email <the account's email>
```

The same command with `--remove` at the end deletes it again. The account must have finished
onboarding. The database address is never read from `.env`, so it is always your choice which
database gets the data.
