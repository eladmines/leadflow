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

In Render → the service → **Environment**, add the `WHATSAPP_*` values from your local
`apps/api/.env` (`WHATSAPP_PROVIDER=cloud`, `WHATSAPP_BUSINESS_ID` = the business id from the
online app's address, phone number id, access token, app secret, verify token). Then in Meta set
the webhook to `https://<service>.onrender.com/api/v1/integrations/whatsapp/webhook` — no tunnel
needed any more. Meta's temporary token expires every 24 hours; create a permanent System User
token for anything longer than a test.

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
