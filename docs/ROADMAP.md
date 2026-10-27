# Roadmap

Follows planning doc 08 (see D-006). A stage starts only after the previous stage's gate passes on staging.

| Stage                               | Features                                                                                                                | Gate (from doc 08)                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **0 — Foundation**                  | F00 Platform foundation · F01 Auth · F02 Onboarding, tenancy & RBAC · F03 App shell                                     | A user can't read another business's data; a version can be deployed and the DB restored in a test environment. |
| **1 — Site & leads** (core journey) | F04 Site builder · F05 Media · F06 Publishing · F07 Lead capture · F08 CRM core · F09 Team invites · F10 Tasks          | A business signs up, publishes a site, receives a lead and handles it, with no manual help from us.             |
| **2 — Domains & WhatsApp**          | POC spikes (domain + HTTPS, real WhatsApp number) · F11 Custom domains · F12 WhatsApp inbox                             | Messages in and out on a real number; duplicate events create no duplicates; disconnection shown clearly.       |
| **3 — Billing & Beta**              | F13 Plans, billing & quotas · F14 Export & deletion · F15 Ops hardening · F21 Admin console · Beta with 5–10 businesses | Can charge, change plan, cancel and export data per written policy.                                             |
| **4 — AI & advanced**               | F16 AI agent · F17 Appointments · F18 Quotes · F19 Automations · F20 Reports                                            | Exceeding the quota triggers no AI call; sensitive actions need approval.                                       |

**Core-journey milestone (end of F08):** one Playwright test covers register → onboard → build site →
publish to `x.lvh.me` → submit form → lead in the CRM with its source, and checks that a second
tenant can't see it.

**Not in the MVP (PRD §17.3):** free-form drag-and-drop builder, e-commerce, invoicing/accounting,
mass campaigns, voice calls, advanced call centre, unlimited AI.
