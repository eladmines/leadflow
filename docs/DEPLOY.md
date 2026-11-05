# Deploying LeadFlow for free (test version)

This puts LeadFlow on the internet at no cost, for you and a few test businesses (D-119).
Everything runs as one service on Render; the database is on Neon; emails go out through a
Gmail account.

| Piece                       | Where                              | Free plan limits                                   |
| --------------------------- | ---------------------------------- | -------------------------------------------------- |
| App, API, customer websites | Render web service (`render.yaml`) | Sleeps after 15 min idle, ~1 min to wake; 750 h/mo |
| Database (and photos)       | Neon Postgres                      | 0.5 GB, 100 compute hours/mo, pauses when idle     |
| Email                       | Gmail SMTP with an app password    | About 500 emails a day                             |

Addresses: the app is `https://<service>.onrender.com`, and a business's website is
`https://<service>.onrender.com/s/<its-name>`.

## 1. Database — Neon (5 minutes)

1. Sign up at <https://neon.com> (GitHub or Google sign-in is fine).
2. Create a project: name `leadflow`, Postgres 16 or newer, region **Frankfurt** (closest to Israel).
3. On the project dashboard click **Connect**, turn **Connection pooling off**, and copy the
   connection string. It looks like
   `postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   Keep it private — it is the database password.

## 2. Email — Gmail app password (3 minutes)

1. The Gmail account needs **2-Step Verification** on: <https://myaccount.google.com/security>.
2. Create an app password at <https://myaccount.google.com/apppasswords> (name it "LeadFlow").
   Google shows 16 letters once — copy them.

## 3. App — Render (10 minutes)

1. Make sure the latest code is on GitHub (`main` branch of your `leadflow` repository).
2. Sign up at <https://render.com> with GitHub.
3. **New → Blueprint**, pick the `leadflow` repository. Render reads `render.yaml` and asks for
   the four private values:
   - `DATABASE_URL` — the Neon connection string from step 1.
   - `SMTP_USER` — the Gmail address.
   - `SMTP_PASS` — the 16-letter app password from step 2 (no spaces).
   - `EMAIL_FROM` — `LeadFlow <the same Gmail address>`.
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
  `PUBLIC_SITE_MODE=host` and `PUBLIC_SITE_HOST=yourdomain`, and switch email to a provider with
  your domain (O-009).
