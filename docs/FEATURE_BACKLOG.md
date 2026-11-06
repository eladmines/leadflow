# Feature backlog

Ordered by business value and dependencies. **Status:** Planned · Design · In progress · QA · Done · Blocked.
Updated by the orchestrator after every completed task. Specs: `docs/features/Fxx.md`.

Smallest complete customer journey: **register → onboard → build site → publish → lead → CRM** (F01–F08).

| ID  | Feature                                                 | Value              | Depends on        | Parallel with | Pipeline                            | Status   |
| --- | ------------------------------------------------------- | ------------------ | ----------------- | ------------- | ----------------------------------- | -------- |
| F00 | [Platform foundation](features/F00.md)                  | Prerequisite       | —                 | —             | Orchestrator                        | **Done** |
| F01 | [Authentication & sessions](features/F01.md)            | Core               | F00               | —             | Architect → Backend ∥ Frontend → QA | **Done** |
| F02 | [Business onboarding, tenancy & RBAC](features/F02.md)  | Core               | F01               | —             | Architect → Backend ∥ Frontend → QA | **Done** |
| F03 | [App shell, navigation & dashboard](features/F03.md)    | Core               | F02 contract      | F02 backend   | Frontend → QA                       | **Done** |
| F04 | [Site builder](features/F04.md)                         | Core               | F02, F03          | F05 backend   | Full pipeline                       | **Done** |
| F05 | [Media & file storage](features/F05.md)                 | Core-adjacent      | F02               | F04           | Architect → Backend → Frontend → QA | **Done** |
| F06 | [Publishing & public serving](features/F06.md)          | Core               | F04 (+F05 images) | F07 backend   | Full pipeline                       | **Done** |
| F07 | [Lead capture forms](features/F07.md)                   | Core               | F06, F02          | F06           | Full pipeline                       | **Done** |
| F08 | [CRM core](features/F08.md)                             | Core (journey end) | F07               | —             | Full pipeline                       | **Done** |
| F09 | [Team invitations & member management](features/F09.md) | High               | F02               | F04–F08       | Backend ∥ Frontend → QA             | **Done** |
| F10 | [Tasks / follow-ups](features/F10.md)                   | High               | F08               | F11 spike     | Full pipeline                       | **Done** |
| F11 | Custom domains + HTTPS                                  | High               | F06 + POC spike   | F12           | Spike → full pipeline               | Planned  |
| F12 | WhatsApp connection & inbox                             | High               | F08 + POC spike   | F11           | Spike → full pipeline               | POC      |
| F13 | Plans, trial, billing & quotas                          | High               | F02, O-004        | F14           | Full pipeline                       | Planned  |
| F14 | Data export, deletion & retention                       | Beta-required      | F08, O-007        | F13           | Full pipeline                       | Planned  |
| F15 | Ops hardening: monitoring, backups, audit views         | Beta-required      | F00               | any           | Backend → QA                        | Planned  |
| F16 | AI agent (suggestions first) + hard budget              | Medium             | F12, F13          | F17–F19       | Full pipeline                       | Planned  |
| F17 | Appointments / calendar                                 | Medium             | F08               | F16           | Full pipeline                       | **Done** |
| F18 | Quotes                                                  | Medium             | F08               | F16           | Full pipeline                       | **Done** |
| F19 | Preset automations                                      | Medium             | F08, F10          | F16           | Full pipeline                       | Planned  |
| F20 | Reports & analytics                                     | Medium             | F08               | F16           | Full pipeline                       | **Lite** |
| F21 | Platform admin console (audited support access)         | Medium             | F02, F15          | any           | Full pipeline                       | Planned  |

## Dependency graph (core journey)

```
F00 ─► F01 ─► F02 ─┬─► F03 ─► F04 ─► F06 ─► F07 ─► F08 ─► F10 ─► F19
                   ├─► F05 ───────────┘ (images)        └─► F12 (after spike) ─► F16
                   ├─► F09                               └─► F17, F18, F20, F14
                   └─► F13 ─► F16
F06 ─► F11 (after spike)
```

## Task log

- 2026-10-27 — F00 complete: monorepo, API skeleton, Prisma baseline migration, web RTL kit,
  tests (13 unit/integration, 6 e2e), CI, planning docs, agent definitions.
- 2026-10-27 — F01 complete: 8 auth endpoints, 6 RTL screens, 182 tests + 7 e2e; QA verdict ready; QA-F01-1 (empty JSON body on logout) fixed.
- 2026-10-27 — F02 complete (built directly, no agent pipeline): businesses + memberships, tenant scope with auto route walker, owner-only edits, 4-step wizard with server-saved resume, business home. 229 unit/integration tests + 16 e2e (desktop + mobile).
- 2026-10-27 — F03 complete: app shell (right sidebar, mobile drawer, business switcher, skip link), dashboard with real setup checklist, coming-soon sections, team list, settings (details, areas, hours; owner-only edits). 240 unit/integration tests + 18 e2e.
- 2026-10-27 — F04 complete (MVP): one-page site builder, 2 templates, 8 section types, presets, autosave with revision locking + local backup, live sandboxed preview, owner-only edit. 262 unit/integration tests + 20 e2e.
- 2026-10-27 — F06 complete (MVP): subdomains, atomic publish into immutable versions, history/rollback/unpublish, public site server (CSP, ETag, robots, sitemap), editor publish/history UI. 291 unit/integration tests + 22 e2e.
- 2026-10-27 — F07 complete (MVP): no-JS lead form with signed tokens + spam filters, leads with contact matching and idempotency, owner/manager email, leads page + dashboard. Core journey register → onboard → site → publish → lead works end to end. 320 unit/integration tests + 26 e2e.
- 2026-10-27 — F08 complete (MVP): pipeline board with drag-and-drop + stage menu, list with search/filters, lead page with notes and history, manual leads with duplicate warning, employee visibility. **Stage 1 core journey (F01–F08) done.** 335 unit/integration tests + 28 e2e.
- 2026-10-27 — F09 complete: email invitations (7-day single-use, email-bound), join from link incl. registration, role changes, removal, resend/cancel. 352 unit/integration tests + 30 e2e.
- 2026-10-27 — F05 complete (MVP): image upload with server-side re-encoding (WebP, ≤1920px, EXIF stripped), storage interface, library with quota, logo/hero/about images and gallery, same-origin serving. 368 unit/integration tests + 32 e2e.
- 2026-10-27 — F10 complete: follow-up tasks (lead-linked or standalone), tasks page, lead + dashboard integration, email reminders via an in-process job. **Stage 1 complete.** 384 unit/integration tests + 35 e2e.
- 2026-10-28 — Small features: lead export to Excel/CSV (owner-only, injection-safe), account settings (name, password change with session sign-out and notice email).
- 2026-10-28 — F20 lite: reports page for owners/managers — new leads vs previous period, close rate, won/open value, average response time, leads over time (7/30/90 days), funnel by stage, sources. Full F20 (custom ranges, per-employee, exports) stays planned.
- 2026-10-28 — Small features 2: delete a lead (owner only), lead tags (edit, filter, suggestions, CSV), per-business new-lead email opt-out, dashboard "this week in numbers".
- 2026-10-28 — Site design v2: professional layout for both templates (menu, hero card/photo, service icons, accordion FAQ, CTA panel, footer, mobile call bar). No scripts; applies to live sites on next publish.
- 2026-10-28 — Templates: garage, clinic and food added (5 total); new sites start with sample photos copied into the media library; picker previews show the photos.
- 2026-10-28 — Visual editing step 1: click a section in the preview to edit it; hover toolbar to move/hide; "+" inserts a section in place; scroll position kept across edits.
- 2026-10-28 — Visual editing step 2: type directly on the page (titles, texts, services, prices, reviews, FAQ, buttons) and click photos to replace them.
- 2026-10-28 — Page-first editor: full-width preview, settings panel on demand (settings only on desktop), add/move/delete list items on the page, placeholders for empty fields.
- 2026-10-28 — Admin redesign: modern neutral look (tokens, UI kit, compact sidebar), Ctrl+K quick search, flat headers; fixed lead board labels widening the page.
- 2026-10-28 — Editable menu labels, second hero button and mobile-bar buttons on the page; business details (phone, address, hours, areas) editable from the editor in a dialog.
- 2026-10-28 — F17 appointments (first version): services, week/day calendar, booking with clash prevention, website appointment requests (manual approval), lead card and history.
- 2026-10-28 — F18 quotes (first version): from a lead, items/discount/VAT, numbered drafts, private link + email + WhatsApp, customer accept/reject with print-to-PDF, lead card and history. Fixed a leads-page search race that could undo a navigation.
- 2026-10-28 — Site pages: add pages (about, services, gallery, FAQ, contact, landing, blank), page switcher and settings in the editor, per-page Google details, live at /address with menu, phone menu and sitemap.
- 2026-10-28 — Editor: section settings window on click (look from the palette, settings, actions), text/button toolbar, site design window from the logo.
- 2026-10-28 — Custom site colours (main + accent) with a readability check and one-click darker fix.
- 2026-10-28 — Desktop editor without the side panel: page settings include Google, "+ מקטע" and hidden-sections menu above the preview.
- 2026-10-31 — Site design v3: cleaner, more professional customer-site look for all 5 templates (D-090). Applies to live sites on next publish.
- 2026-10-31 — F12 POC: WhatsApp via Meta Cloud API (D-091, proposed) — signed webhook, WhatsApp leads, conversation and replies on the lead page (24-hour window), delivery status, local simulator. See docs/features/F12.md.
- 2026-10-31 — WhatsApp number classification (D-092): known customers go straight to their lead, new numbers wait in the "שיחות" inbox, one click marks business (lead) or personal (deleted, ignored from then on); remembered; leads page points to waiting numbers.
- 2026-11-01 — Product tour (D-093): first-entry walkthrough of the main menu with spotlight bubbles (centred on phones), per-role steps, keyboard support, replay from "סיור במערכת".
- 2026-11-01 — Existing website (D-094): save the address of a site built elsewhere; "האתר שלי" shows it with a live preview and a "לא מנוהל ב-LeadFlow" note, and still offers LeadFlow templates.
- 2026-11-01 — Site options (D-095): change template after creating the site (logo, pages and address kept; live site unchanged until publish) and delete the LeadFlow site (offline, address freed, leads and consent records kept) to go back to an existing website.
- 2026-11-01 — Page tours (D-096): "סיור בעמוד" on every main screen, with steps that adapt to what the page shows.
- 2026-11-01 — Notifications (D-097): bell with unread count and list, pop-ups for new leads and WhatsApp, events from the site form, WhatsApp, quotes and task reminders.
- 2026-11-03 — Management app in English (default) with a Hebrew switch (D-100): ~1,200 strings translated, LTR/RTL by language, locale-aware dates, English e2e journey.
- 2026-11-03 — Appointments calendar with free time slots (D-101): day/week time grid, opening hours, click a free slot to book.
- 2026-11-03 — WhatsApp booking bot (D-102): service → day → free time → confirm in WhatsApp lists, booked into the calendar; switch on the Conversations page; server-side free times in the business time zone.
- 2026-11-03 — Editable booking-bot messages (D-103): five messages with placeholders, insert buttons, live preview and restore-default.
- 2026-11-03 — Floating help button (D-104): page tour, product tour and quick search in one corner menu, replacing the header and menu tour buttons.
- 2026-11-03 — Animated help character (D-105) replaces the "?" icon; one-time hello bubble.
- 2026-11-03 — Booking-bot showcase (D-106): message + link + up to 3 photos for customers who don't book (cancel, team, no times, stopped mid-way), "See our work" option, once a day.
- 2026-11-03 — Bot per industry (D-107): 5 new industries, industry default messages, and an event-request flow (type → date → part of day → guests → area) for DJs, catering and photographers.
- 2026-11-04 — Bot personal touch (D-108): event businesses ask "check a date or personal chat" first, wanting a person or two misunderstandings hand over, dates not held unless chosen, pause the bot per customer from the lead.
- 2026-11-06 — Email on free hosting (D-120): off by default (no more slow sign-up), Brevo over HTTPS when set up; SMTP fails fast.
- 2026-11-05 — Free test hosting ready (D-119): Render + Neon + Gmail, sites under /s/<name>, images in Postgres; steps in docs/DEPLOY.md.
- 2026-11-05 — Wider pages with smaller margins (D-118).
- 2026-11-05 — Page header (title and buttons) moved into the panel on Customers & leads, Quotes and Appointments (D-117).
- 2026-11-05 — Toolbar and content in one panel on Customers & leads, Quotes and Appointments (D-116).
- 2026-11-05 — Dropdowns: own chevron set in from the edge (both directions); stage dropdowns translated in English.
- 2026-11-05 — Leads board: white bordered columns with a line under each title, stronger card borders (and a slightly stronger border colour app-wide).
- 2026-11-05 — Leads board: always-visible side scrollbar and "earlier / later stages" arrow buttons when stages are out of view.
- 2026-11-05 — New logo: a target with a dart, open mark in the app, on a blue square as the tab icon (D-115).
- 2026-11-05 — Admin-style shell (D-114): white top bar (search, flags, bell, user), white sidebar in sections with a colour tile per feature, brighter blue, grey canvas.
- 2026-11-05 — Dashboard welcome is a light header with a slim progress bar instead of the blue banner (D-113).
- 2026-11-05 — Design made more professional (D-112): calm blue banner, soft tints instead of strong colours, no confetti or emoji.
- 2026-11-05 — Bright light-blue design (D-111): blue brand with coral highlights, light blue menu, colourful dashboard (banner with the helper, coloured number cards, stage tags).
- 2026-11-04 — Language switch is flag buttons at the top corner opposite the menu (desktop page top, mobile drawer, sign-in pages) instead of "English / עברית" text (D-110).
- 2026-11-04 — Save button for the bot settings on Conversations (D-109), with unsaved-changes notice and discard.
- 2026-11-03 — Page tours updated on every screen (dashboard incl. bell, language and helper; leads; lead; tasks; quotes; reports; settings). Conversations explains the inbox, the booking bot and each of its settings; Appointments explains the calendar, free times, colours and pending requests.
