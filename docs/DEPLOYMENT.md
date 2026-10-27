# Deployment plan — Beta environment

Status: **Plan** (2026-10-27). Goal: run LeadFlow on a real domain so 3–5 real businesses can use it, and close the
Stage 0 gate from doc 08: _deploy a version and restore the DB in a test environment._

One environment for Beta (called **beta**), on the real domain. A separate staging can be added later by
repeating the same setup with other names.

`<domain>` below = the domain you buy, e.g. `leadflow.co.il`.

---

## 1. Architecture in production

```
Visitors ──► https://<sub>.<domain>   ─┐
Owners   ──► https://app.<domain>      │  Cloudflare (DNS, TLS, CDN, WAF)
             https://api.<domain>      │
             https://media.<domain>    │
                                       ▼
 app.<domain>    → Cloudflare Pages  (React admin, static)
 api.<domain>    → Fly.io app, port 4000 (API)          ┐ one Fly machine,
 *.<domain>      → Fly.io app, port 4100 (public sites) ┘ same process (D-036)
 media.<domain>  → Cloudflare R2 bucket (images, public read)
 Postgres        → Neon (Frankfurt), daily backups + point-in-time restore
 Email           → Resend (SMTP), SPF/DKIM on <domain>
```

Why these (resolves O-001):

| Need               | Choice                                                              | Why                                                                    | Start cost                |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------- |
| Domain             | Israeli registrar for `.co.il` (or Cloudflare Registrar for `.com`) | `.co.il` builds trust with Israeli SMBs                                | ≈ ₪50–100 / year          |
| DNS, TLS, CDN      | Cloudflare (Free)                                                   | Free wildcard TLS for `*.<domain>`; DDoS protection                    | Free                      |
| Admin app          | Cloudflare Pages                                                    | Static React build, global CDN                                         | Free                      |
| API + public sites | Fly.io, region `fra`                                                | Runs our Docker image as is; close to Israel; simple secrets           | ≈ $5–10 / month           |
| Database           | Neon, `aws-eu-central-1`                                            | Managed Postgres 16, branching, point-in-time restore; Prisma-friendly | Free tier → ≈ $19 / month |
| Images             | Cloudflare R2 + custom domain                                       | S3 API (D-011/D-053), no egress fees                                   | Free up to 10 GB          |
| Email              | Resend                                                              | SMTP + API, simple DNS setup, good deliverability                      | Free up to 3,000 / month  |
| Uptime             | Better Stack (or UptimeRobot)                                       | Alerts when `/health/db` fails                                         | Free                      |
| Errors             | Sentry (Developer)                                                  | Stack traces without logging personal data                             | Free                      |

**Expected total for Beta: ≈ $10–35 / month + the domain.**

---

## 2. What you do (accounts) — about one hour

Please create these and share the details listed under "send me" (never send passwords; invite me where possible or
create API tokens and put them straight into GitHub/Fly secrets — see §5).

1. **Domain** — buy `<domain>` (e.g. at a `.co.il` registrar such as LiveDNS / Box / Domain The Net).
   _Send me:_ the domain name.
2. **Cloudflare** (cloudflare.com, Free plan) — add the domain; change the domain's nameservers at the registrar to
   the two Cloudflare gives you (takes minutes–hours to propagate). Enable **R2** (needs a payment card, free tier).
   _Send me:_ an API token with permissions: Zone DNS edit, Pages edit, R2 edit, Workers edit (for later).
3. **Fly.io** (fly.io) — sign up, add a payment card. _Send me:_ nothing yet; we'll create a deploy token together
   (`fly tokens create deploy`) and store it as a GitHub secret.
4. **Neon** (neon.tech) — create project **leadflow**, region **AWS Europe Central 1 (Frankfurt)**, Postgres 16.
   _Send me:_ nothing — paste the two connection strings (pooled and direct) into Fly secrets yourself (§5).
5. **Resend** (resend.com) — add domain `<domain>`, then add the DNS records it shows (SPF, DKIM) in Cloudflare.
   Create an SMTP/API key.
6. **Sentry** (sentry.io, optional now) — create a Node project; keep the DSN.
7. **GitHub** — nothing new; the repo `eladmines/leadflow` gets deploy secrets in §5.

**Before real businesses use it (legal, not code):** a privacy policy and terms of use (Israeli Privacy Protection
Law, Amendment 13 — PRD §20, O-007). The register page links to `/terms` and `/privacy`, which are placeholders today,
and Meta requires a privacy-policy URL for WhatsApp too. A lawyer or a reputable template service is recommended.

---

## 3. What I build (code) — one working session, before any account is needed

| #   | Change                                                                                                                                                                                                               | Why                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **Real client IP behind Cloudflare/Fly.** Stop trusting arbitrary `X-Forwarded-For`; read `CF-Connecting-IP` (public sites, behind Cloudflare) / `Fly-Client-IP`, configurable via `TRUSTED_PROXY`.                  | **Security:** today rate limits (login, lead form) could be bypassed with a forged header once behind a proxy. |
| 2   | SMTP auth + TLS (`SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`)                                                                                                                                                            | Resend/any real provider (O-009).                                                                              |
| 3   | `R2StorageProvider` (S3-compatible, `@aws-sdk/client-s3`) selected by `STORAGE_DRIVER=r2`; `MEDIA_PUBLIC_BASE=https://media.<domain>`                                                                                | Images survive deploys and scale (D-053).                                                                      |
| 4   | Web: `VITE_API_BASE=https://api.<domain>`; CORS + cookies already support sibling subdomains (`SameSite=Lax`, `Secure`).                                                                                             | Admin on Pages, API on Fly.                                                                                    |
| 5   | Admin security headers (`_headers` for Pages): CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS.                                                                                                                | Defence in depth for the app that holds customer data.                                                         |
| 6   | Production `Dockerfile` (multi-stage, pnpm, Prisma client, non-root user) and `fly.toml` with two services (4000 → `api.`, 4100 → `*.`), health checks on `/health/db`, `release_command` = `prisma migrate deploy`. | Repeatable, migrations before traffic.                                                                         |
| 7   | CI: on push to `main` → existing checks → deploy API to Fly → deploy web to Pages.                                                                                                                                   | No manual deploys.                                                                                             |
| 8   | Production config checks (fail fast): required secrets, `https` URLs, `COOKIE_SECURE`, real email + storage drivers.                                                                                                 | Misconfiguration can't silently ship.                                                                          |
| 9   | Sentry (errors only, PII scrubbing) — optional flag.                                                                                                                                                                 | Know about failures before users report them.                                                                  |
| 10  | Runbooks in `docs/runbooks/`: deploy, rollback, rotate secrets, **restore drill**.                                                                                                                                   | Stage 0 gate.                                                                                                  |

Known limits accepted for Beta (recorded as decisions when built): one Fly machine (in-memory rate limits and page cache
are per process — fine for one machine), published pages still read from Postgres (Worker + R2 for sites comes later),
no staging separate from beta.

---

## 4. DNS plan (Cloudflare)

| Name            | Type             | Target                                           | Proxy                                                                                |
| --------------- | ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `app`           | CNAME            | `<project>.pages.dev`                            | Proxied                                                                              |
| `api`           | CNAME            | `<fly-app>.fly.dev`                              | Proxied (SSL mode **Full (strict)**; `fly certs add api.<domain>`)                   |
| `*`             | CNAME            | `<fly-app>.fly.dev`                              | Proxied (Universal SSL covers `*.<domain>`; `fly certs add "*.<domain>"` via DNS-01) |
| `media`         | R2 custom domain | bucket `leadflow-media`                          | Proxied                                                                              |
| `@`, `www`      | —                | marketing site later (redirect to `app` for now) | Proxied                                                                              |
| Resend SPF/DKIM | TXT/CNAME        | as shown by Resend                               | DNS only                                                                             |

`app`, `api`, `media`, `www` are already reserved subdomains (customers can't take them).

---

## 5. Secrets and configuration

Set with `fly secrets set …` (API) and Cloudflare Pages env vars (web). Never in the repo.

| Variable                                                                                                        | Where          | Value                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------- |
| `DATABASE_URL`                                                                                                  | Fly            | Neon **pooled** connection string (`…-pooler…`)         |
| `DIRECT_DATABASE_URL`                                                                                           | Fly            | Neon **direct** string (migrations)                     |
| `APP_URL`                                                                                                       | Fly            | `https://app.<domain>`                                  |
| `WEB_ORIGINS`                                                                                                   | Fly            | `https://app.<domain>`                                  |
| `PUBLIC_SITE_HOST`                                                                                              | Fly            | `<domain>`                                              |
| `COOKIE_SECURE`                                                                                                 | Fly            | `true`                                                  |
| `FORM_TOKEN_SECRET`                                                                                             | Fly            | 48 random bytes (`openssl rand -base64 48`)             |
| `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`              | Fly            | Resend SMTP; from `LeadFlow <no-reply@<domain>>`        |
| `STORAGE_DRIVER`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `MEDIA_PUBLIC_BASE` | Fly            | R2 token scoped to one bucket; `https://media.<domain>` |
| `SENTRY_DSN` (optional)                                                                                         | Fly            | from Sentry                                             |
| `VITE_API_BASE`                                                                                                 | Pages          | `https://api.<domain>`                                  |
| `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                                                | GitHub Actions | deploy tokens                                           |

---

## 6. Go-live checklist (Beta)

- [ ] All §3 changes merged; CI green.
- [ ] First deploy; `https://api.<domain>/health/db` OK; `https://app.<domain>` loads.
- [ ] Register with a real email → verification email arrives (check spam score / Resend dashboard).
- [ ] Publish a site → `https://<sub>.<domain>` serves it with a valid certificate; image loads from `media.`.
- [ ] Lead form on the live site → lead in CRM → owner email.
- [ ] Rate limit test from outside: forged `X-Forwarded-For` doesn't bypass it.
- [ ] **Restore drill:** restore Neon to a branch from a point in time, point a local API at it, verify data; record the time it took (RTO/RPO baseline, PRD §22.2).
- [ ] Uptime monitor on `/health/db`; alert email/SMS to you.
- [ ] Privacy policy + terms published and linked (legal).
- [ ] Seed/demo accounts are **not** created in beta.

---

## 7. In parallel: WhatsApp (F12) — start now, it takes days–weeks

1. Create a **Meta Business** account (business.facebook.com) for your company.
2. **Business verification** — upload company documents (עוסק מורשה / ח.פ certificate, a utility bill or bank letter with
   the business address). Typical: a few days.
3. **WhatsApp Business Platform:** create an app at developers.facebook.com → add the WhatsApp product → you get a test
   number for development immediately.
4. Decide the **onboarding model** (O-005): each customer connects their own number through Meta's _Embedded Signup_
   inside LeadFlow (requires becoming a Tech Provider) vs. a BSP. Recommended: Embedded Signup as Tech Provider.
5. Needed by Meta: privacy-policy URL, app icon, business website (`https://app.<domain>` or a landing page).

The proof of concept from doc 04 — "WhatsApp with a real number" — happens once steps 1–3 are done.

---

## 8. Order of work

1. You: accounts (§2) — I: code (§3), in parallel.
2. Together: DNS (§4) and secrets (§5) — about 30 minutes, you paste secrets, I verify.
3. First deploy → go-live checklist (§6), including the restore drill.
4. Beta with 3–5 businesses; weekly feedback (doc 08 Beta plan).
5. Next features chosen by Beta feedback: F10 tasks, F11 custom domains, F12 WhatsApp (after Meta approval).
