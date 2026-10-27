# Feature backlog

Ordered by business value and dependencies. **Status:** Planned · Design · In progress · QA · Done · Blocked.
Updated by the orchestrator after every completed task. Specs: `docs/features/Fxx.md`.

Smallest complete customer journey: **register → onboard → build site → publish → lead → CRM** (F01–F08).

| ID  | Feature                                                | Value              | Depends on        | Parallel with | Pipeline                            | Status   |
| --- | ------------------------------------------------------ | ------------------ | ----------------- | ------------- | ----------------------------------- | -------- |
| F00 | [Platform foundation](features/F00.md)                 | Prerequisite       | —                 | —             | Orchestrator                        | **Done** |
| F01 | [Authentication & sessions](features/F01.md)           | Core               | F00               | —             | Architect → Backend ∥ Frontend → QA | **Done** |
| F02 | [Business onboarding, tenancy & RBAC](features/F02.md) | Core               | F01               | —             | Architect → Backend ∥ Frontend → QA | **Done** |
| F03 | [App shell, navigation & dashboard](features/F03.md)   | Core               | F02 contract      | F02 backend   | Frontend → QA                       | **Done** |
| F04 | [Site builder](features/F04.md)                        | Core               | F02, F03          | F05 backend   | Full pipeline                       | **Done** |
| F05 | [Media & file storage](features/F05.md)                | Core-adjacent      | F02               | F04           | Architect → Backend → Frontend → QA | **Done** |
| F06 | [Publishing & public serving](features/F06.md)         | Core               | F04 (+F05 images) | F07 backend   | Full pipeline                       | **Done** |
| F07 | [Lead capture forms](features/F07.md)                  | Core               | F06, F02          | F06           | Full pipeline                       | Planned  |
| F08 | [CRM core](features/F08.md)                            | Core (journey end) | F07               | —             | Full pipeline                       | Planned  |
| F09 | Team invitations & member management                   | High               | F02               | F04–F08       | Backend ∥ Frontend → QA             | Planned  |
| F10 | Tasks / follow-ups                                     | High               | F08               | F11 spike     | Full pipeline                       | Planned  |
| F11 | Custom domains + HTTPS                                 | High               | F06 + POC spike   | F12           | Spike → full pipeline               | Planned  |
| F12 | WhatsApp connection & inbox                            | High               | F08 + POC spike   | F11           | Spike → full pipeline               | Planned  |
| F13 | Plans, trial, billing & quotas                         | High               | F02, O-004        | F14           | Full pipeline                       | Planned  |
| F14 | Data export, deletion & retention                      | Beta-required      | F08, O-007        | F13           | Full pipeline                       | Planned  |
| F15 | Ops hardening: monitoring, backups, audit views        | Beta-required      | F00               | any           | Backend → QA                        | Planned  |
| F16 | AI agent (suggestions first) + hard budget             | Medium             | F12, F13          | F17–F19       | Full pipeline                       | Planned  |
| F17 | Appointments / calendar                                | Medium             | F08               | F16           | Full pipeline                       | Planned  |
| F18 | Quotes                                                 | Medium             | F08               | F16           | Full pipeline                       | Planned  |
| F19 | Preset automations                                     | Medium             | F08, F10          | F16           | Full pipeline                       | Planned  |
| F20 | Reports & analytics                                    | Medium             | F08               | F16           | Full pipeline                       | Planned  |
| F21 | Platform admin console (audited support access)        | Medium             | F02, F15          | any           | Full pipeline                       | Planned  |

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
