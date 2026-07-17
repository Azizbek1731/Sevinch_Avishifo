# AviShifo — Clinic CRM/HIS Full-Stack Development Prompt

> **How to use:** Feed this entire document to your AI coding assistant (Claude Code, etc.) as the master specification. Build phase by phase (see §14). Do not skip the architecture and conventions sections.

---

## 1. ROLE & MISSION

You are a **senior full-stack architect and developer** with 10+ years of experience building healthcare SaaS platforms (Epic, athenahealth, Medesk-class systems). You write production-grade, strictly-typed TypeScript, design normalized PostgreSQL schemas, and build real-time systems with WebSockets.

Your mission: build **AviShifo** — a multi-tenant SaaS CRM / clinic management system (practice management + lightweight EHR) for **private clinics in Uzbekistan**, from scratch, following this specification exactly.

---

## 2. PRODUCT VISION

AviShifo is a B2B SaaS platform. One deployment serves **many independent clinics** (tenants). Each clinic can have **multiple branches**, its own staff, patients, price list, and settings — fully isolated from other clinics.

**Core value propositions:**
1. **Live queue management** — real-time patient queue with TV-display screens in waiting rooms (WebSocket-driven, zero refresh).
2. **Full patient lifecycle** — registration → appointment → queue → visit → diagnosis → prescription → lab → payment → follow-up.
3. **Money control** — invoicing, cash/card/online payments (Payme, Click, Uzum), debt tracking, cashier shifts, doctor KPI/commission.
4. **Medical records** — structured visit notes (SOAP), ICD-10 diagnoses, prescriptions, lab results, document/file attachments, full medical history timeline.
5. **Patient engagement** — SMS (Eskiz.uz) + Telegram bot notifications, reminders, feedback collection, patient portal with online booking.
6. **Analytics** — revenue, patient flow, doctor performance, service popularity dashboards per branch and consolidated.

**Localization:** UI in **Uzbek (Latin)** by default, with **Russian** and **English**; optional Uzbek (Cyrillic). Currency: **UZS**. Timezone: **Asia/Tashkent (UTC+5)**. Phone format: +998.

---

## 3. TECH STACK (MANDATORY — do not substitute)

### Backend
| Concern | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5.x, `"strict": true` |
| Framework | **NestJS 10+** (modular monolith) |
| ORM | **Prisma** (schema-first, migrations) |
| Database | **PostgreSQL 16** |
| Cache / PubSub | **Redis 7** |
| Real-time | **Socket.IO** via NestJS Gateways (`@nestjs/websockets`) with Redis adapter (`@socket.io/redis-adapter`) for horizontal scaling |
| Background jobs | **BullMQ** (Redis-backed): SMS sending, Telegram messages, report generation, reminder scheduling |
| Validation | **Zod** (shared schemas package) + nestjs-zod |
| Auth | JWT (short-lived access + rotating refresh tokens), bcrypt/argon2 password hashing |
| File storage | Local disk in dev; S3-compatible interface (abstract `StorageService`) for production |
| API docs | OpenAPI/Swagger auto-generated (`@nestjs/swagger`) |
| Logging | pino (structured JSON logs), request-id correlation |

### Frontend
| Concern | Technology |
|---|---|
| Framework | **Next.js 15 (App Router)** + React 19 |
| Language | TypeScript strict |
| Styling | TailwindCSS + **shadcn/ui** components |
| Data fetching | **TanStack Query v5** (server state) |
| Client state | **Zustand** (UI state only) |
| Forms | react-hook-form + Zod resolvers (same shared schemas as backend) |
| Real-time | socket.io-client (thin typed wrapper hook `useSocket`) |
| Tables | TanStack Table (server-side pagination/sorting/filtering) |
| Charts | Recharts |
| Dates | date-fns + date-fns-tz (always Asia/Tashkent for display) |
| i18n | next-intl (uz-Latn default, ru, en; uz-Cyrl optional) |

### Monorepo & Tooling
```
pnpm workspaces + Turborepo
ESLint + Prettier (single config at root)
Vitest (unit), Supertest (API e2e), Playwright (frontend e2e)
Docker Compose for local dev (postgres, redis, mailhog)
GitHub Actions CI: lint → typecheck → test → build
Conventional Commits
```

### Monorepo layout
```
avishifo/
├── apps/
│   ├── api/                # NestJS backend
│   ├── web/                # Next.js app: clinic staff panel + super-admin panel
│   ├── display/            # Next.js (or lightweight Vite React) app: TV queue display (read-only, fullscreen)
│   └── portal/             # Next.js app: patient portal + online booking (Phase 3)
├── packages/
│   ├── shared/             # Zod schemas, shared TS types, enums, constants (single source of truth)
│   ├── ui/                 # shared shadcn-based UI components (optional)
│   └── config/             # eslint, tsconfig, tailwind presets
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 4. MULTI-TENANCY ARCHITECTURE

- **Row-level multi-tenancy**: every tenant-scoped table has `clinicId` (FK → `Clinic`). Branch-scoped tables additionally have `branchId`.
- A global NestJS **TenantGuard + TenantInterceptor** resolves the tenant from the authenticated user's JWT (`clinicId` claim) and injects it into a request-scoped context. **Every Prisma query for tenant data MUST be filtered by `clinicId`** — implement a Prisma client extension that automatically applies the `clinicId` filter to all tenant-scoped models to make cross-tenant leaks structurally impossible.
- `SUPER_ADMIN` (platform owner) operates outside tenant scope: manages clinics, subscription plans, and platform analytics.
- Uploaded files are stored under `/{clinicId}/{entity}/{uuid}` paths; download endpoints re-verify tenant ownership.
- WebSocket rooms are namespaced by tenant: `clinic:{clinicId}:branch:{branchId}:...` (see §10). The socket handshake authenticates JWT and the server only joins the client to rooms belonging to their clinic.

---

## 5. ROLES & PERMISSIONS (RBAC)

Implement role-based access control with a permission matrix (NestJS guards + decorators, e.g. `@RequirePermissions('patients.write')`).

| Role | Scope | Key capabilities |
|---|---|---|
| `SUPER_ADMIN` | Platform | Manage clinics/tenants, subscription plans, global analytics, impersonate for support (audited) |
| `CLINIC_OWNER` | Clinic | Everything within their clinic incl. finances, staff, settings, all branches |
| `CLINIC_ADMIN` | Clinic/branch | Staff & schedule management, price list, reports; no destructive finance ops |
| `DOCTOR` | Branch | Own schedule & queue, start/finish visits, clinical notes, diagnoses, prescriptions, lab orders, view own KPI |
| `NURSE` | Branch | Vitals entry, assist visits, view queue, limited patient info |
| `RECEPTIONIST` | Branch | Patient registration, appointments, queue control (add/call/skip), basic invoice creation |
| `CASHIER` | Branch | Payments, invoices, cashier shift open/close, refunds (with permission), debt collection |
| `LAB_TECH` | Branch | Lab order worklist, result entry, result approval |
| `ACCOUNTANT` | Clinic | Financial reports, expenses, payroll/commission review (read-heavy) |
| `PATIENT` | Portal | Own profile, medical history, appointments, invoices, online booking |

Rules:
- Permissions are granular strings (`module.action`), roles are permission bundles; allow per-user permission overrides.
- Doctors may only open clinical records of patients who have a visit/appointment with them (or within their branch, configurable per clinic).
- All permission checks enforced server-side; frontend only hides UI.

---

## 6. FUNCTIONAL MODULES (FULL SPECIFICATION)

Features below are synthesized from leading systems (Epic, athenahealth, AdvancedMD, Medesk, eClinicalWorks) and adapted to Uzbekistan's private-clinic market.

### M1 — Auth & User Management
- Login with phone number (+998...) or email + password; optional OTP via SMS for password reset.
- JWT access token (15 min) + refresh token rotation (httpOnly cookie); device/session list with remote logout.
- User profile: full name, phone, email, avatar, role(s), branch assignments, locale preference.
- Account states: active / suspended / archived. Failed-login throttling.

### M2 — Clinic & Branch Management (tenant admin)
- Clinic: name, legal name, INN/STIR, logo, contacts, subscription plan, status.
- Branches: name, address, geolocation, phone, working hours (per weekday), rooms/cabinets list.
- Rooms/Cabinets: number, name, type (consultation, procedure, lab, ultrasound...), assigned specialties.
- Clinic-level settings: default language, SMS sender name, queue behavior, invoice numbering format, VAT settings.

### M3 — Patient Management (Registry + EHR-lite)
- Patient card: MRN (auto number per clinic), full name, DOB, gender, phone(s), address, passport/ID (optional), blood group, allergies (structured list), chronic conditions, notes, photo, "how did you hear about us" source, tags (VIP, debtor, ...).
- Fast registration (< 30 seconds) for front desk: name + phone + DOB minimum; duplicate detection by phone/name+DOB with merge tool.
- **Medical history timeline**: chronological feed of all visits, diagnoses, prescriptions, lab results, uploaded files, payments — filterable by type/doctor/date.
- Document attachments: upload PDF/images (analyses from other clinics, ultrasound photos...), categorized, previewable.
- Consent tracking (personal data processing consent, signed date).
- Full-text patient search (name, phone, MRN) — use PostgreSQL `pg_trgm` GIN indexes; search-as-you-type < 100 ms.

### M4 — Appointments & Scheduling
- Calendar views: day / week per doctor, per room; branch-wide day board.
- Appointment: patient, doctor, service(s), room, start/end, status flow: `SCHEDULED → CONFIRMED → CHECKED_IN → IN_QUEUE → IN_PROGRESS → COMPLETED / NO_SHOW / CANCELLED`.
- Slot generation from doctor working schedules (templates per weekday + exceptions/vacations); slot length per service or per doctor.
- Conflict prevention (double-booking guard at DB level via exclusion constraint or transactional check).
- Recurring appointments (e.g., physiotherapy course: 10 sessions).
- Automated reminders: SMS/Telegram at T-24h and T-2h (BullMQ delayed jobs); confirmations via Telegram inline button updates status to CONFIRMED.
- No-show tracking and patient reliability score.
- Walk-in support: create appointment + enqueue in one action.

### M5 — LIVE QUEUE MANAGEMENT (WebSocket core — flagship module)
- Each branch has daily queues per doctor (and optionally per room/service, e.g. lab queue).
- Ticket: number (daily sequence per queue, e.g. A-013), patient, doctor, priority (normal / priority / emergency), status: `WAITING → CALLED → IN_ROOM → DONE / SKIPPED`, timestamps for each transition.
- Receptionist: add walk-in to queue, reorder, transfer between doctors, mark priority.
- Doctor screen: "Call next" button → status CALLED, patient name + room broadcast to displays; "Start" → IN_ROOM; "Finish" → DONE (opens visit form).
- Skipped patients can be re-called (configurable re-queue position).
- **TV Display app** (`apps/display`): fullscreen, shows now-serving tickets per room (big ticket number + room), recent called list, clinic branding, optional news ticker; text-to-speech announcement (browser SpeechSynthesis) in Uzbek/Russian: "Bemor A-013, 5-xonaga marhamat"; auto-reconnect WebSocket; works on a smart-TV browser.
- Live metrics on admin dashboard: patients waiting, average wait time today, per-doctor load — updated via WebSocket.
- Full spec of events in §10.

### M6 — Visits & Clinical Documentation (EHR)
- Visit opens from queue (doctor "Finish call" → visit form) or from appointment.
- **SOAP structure**: Subjective (complaints, anamnesis), Objective (examination, vitals: height, weight, BP, pulse, temp, SpO2), Assessment (diagnoses), Plan (treatment, prescriptions, referrals, next visit).
- **Diagnoses with ICD-10**: searchable ICD-10 directory (seed database with codes; uz/ru names where available), primary/secondary flags.
- **Prescriptions**: medication name (free text + local drug directory table for autocomplete), dosage, frequency, duration, instructions; printable prescription PDF with clinic letterhead.
- Referrals: to another specialist (creates draft appointment) or to lab (creates lab order).
- Visit templates per specialty (customizable by clinic): pre-filled field sets to speed up documentation.
- Print/PDF: visit summary ("vrach xulosasi") with letterhead, doctor signature line.
- Visits lock after N hours (configurable, default 24h); edits after lock create an audited amendment version (append-only history).

### M7 — Services & Price List
- Service catalog per clinic: code, name (multilingual), category (consultation, lab, ultrasound, procedure...), duration, price, VAT flag, active period.
- Branch-level price overrides. Price change history (effective-dated).
- Service packages/bundles (e.g., "Check-up standard" = N services at package price).
- Discount rules: percent/fixed, per patient tag (VIP), promo codes, max discount per role.

### M8 — Billing, Invoicing & Payments
- Invoice generated from visit services (auto) or manually; lines: service, qty, unit price, discount, total; invoice states: `DRAFT → ISSUED → PARTIALLY_PAID → PAID / CANCELLED / REFUNDED`.
- **Payment methods**: cash, bank card (terminal — recorded manually), **Payme**, **Click**, **Uzum** (merchant APIs — implement provider-agnostic `PaymentProvider` interface + webhook endpoints with signature verification; sandbox first).
- Partial payments and **debt tracking**: patient balance, debtors report, "pay later" with permission.
- Advance payments / deposits on patient account, applied to future invoices.
- **Cashier shifts**: open shift → all cash operations bound to shift → close shift with expected vs actual cash reconciliation report (X/Z style).
- Refunds with reason + permission + audit.
- Receipt printing (80mm thermal-friendly HTML/PDF template). Fiscalization: leave a clean `FiscalizationService` interface stub for future OFD integration (Uzbekistan online cash register law) — do not hard-code.
- Expenses module (simple): categories, amount, branch, date — for net revenue reporting.

### M9 — Laboratory Module
- Lab test catalog: name, code, specimen type, parameters (each with unit, reference range by gender/age), price link to service.
- Lab order lifecycle: `ORDERED → SPECIMEN_COLLECTED → IN_PROGRESS → RESULTED → APPROVED → DELIVERED`; barcode-friendly order number.
- Lab tech worklist (real-time via WebSocket lab queue); result entry with out-of-range auto-flagging (H/L markers).
- Result approval by authorized user; PDF result form with letterhead; auto-notify patient via SMS/Telegram "Natijangiz tayyor" with portal link; results attach to patient timeline.

### M10 — Inventory & Pharmacy (Phase 4, keep schema-ready)
- Items, units, batches with expiry dates, stock per branch, suppliers, purchase invoices, stock deduction on procedure/prescription sale, low-stock and expiry alerts.

### M11 — Staff, Schedules & Payroll/KPI
- Staff directory: role, specialty, license info, hire date, photo, linked user account.
- Working schedule templates (per weekday, shift times) + exceptions (vacation, sick leave) — feeds appointment slot engine.
- **Doctor compensation rules**: fixed salary, percent of own services revenue, or per-service fixed fee (configurable per doctor per service category); monthly accrual report; adjustments; export.
- KPI dashboard per doctor: patients seen, revenue generated, average visit duration, no-show rate, returning patient rate.

### M12 — Reporting & Analytics
- Dashboard (owner/admin): today: revenue, visits, new patients, current waiting count (live), by-branch toggle.
- Reports (all filterable by date range/branch/doctor, exportable to XLSX and PDF):
  1. Revenue by day/week/month; by service category; by doctor; by payment method.
  2. Patient flow: new vs returning, visits count, peak hours heatmap, source-of-patient report.
  3. Debtors report; advances report; cashier shift history.
  4. Doctor performance; service popularity; average wait time & service time (from queue timestamps).
  5. Lab turnaround times.
- Charts via Recharts; server aggregates via SQL (no client-side heavy lifting); consider materialized views for heavy aggregates refreshed nightly.

### M13 — Notifications (SMS / Telegram)
- Provider-agnostic `NotificationService` with channels: SMS (**Eskiz.uz** API), Telegram bot (grammY or Telegraf), in-app (WebSocket + notification center in UI).
- Template management per clinic with variables (`{{patient_name}}`, `{{time}}`, `{{clinic_name}}`), multilingual.
- Events: appointment created/reminder/cancelled, queue "your turn is near" (when ≤ 2 ahead — via Telegram), lab result ready, payment receipt, birthday greeting (optional marketing), debt reminder.
- Delivery log with status (queued/sent/delivered/failed) + retry with backoff via BullMQ.
- Telegram bot for patients: link account by phone, view upcoming appointments, live queue position, confirm/cancel appointment.

### M14 — Patient Portal & Online Booking (`apps/portal`, Phase 3)
- Patient auth via phone + OTP (SMS).
- Public clinic page: branches, doctors (photo, specialty, schedule), services with prices.
- Online booking: pick doctor/service → free slots (from slot engine) → book → SMS/Telegram confirmation; clinic-side toggle to require confirmation.
- Personal cabinet: upcoming/past appointments, medical history summary, lab results (PDF download), invoices/payments, feedback submission.

### M15 — Feedback & Reputation
- Post-visit rating request (SMS/Telegram link): 1–5 stars + comment, per doctor and clinic.
- Ratings dashboard; low-score alert to admin; optional public display of doctor's average rating on portal.

### M16 — Audit Log & Security Module
- Append-only audit log: who, when, action, entity, before/after diff (JSONB), IP, user-agent — for all mutations on sensitive entities (patients, visits, invoices, payments, users, settings).
- Audit viewer UI for CLINIC_OWNER and SUPER_ADMIN with filters.

### M17 — Super-Admin Panel (platform)
- Tenants list: create clinic + first owner account, plan assignment (subscription tiers with feature flags/limits: max branches, max users, modules on/off), suspend/activate.
- Platform analytics: active clinics, usage stats. Feature flags per clinic.

---

## 7. DATABASE SCHEMA (PostgreSQL + Prisma)

Design a normalized schema. Core models (add fields as needed; all tenant models include `clinicId`, timestamps `createdAt/updatedAt`, soft-delete `deletedAt` where noted):

```
Clinic, Branch, Room
User, StaffProfile, Role, Permission, UserRole, UserBranch
Patient (soft-delete), PatientDocument, PatientConsent
DoctorSchedule (template), ScheduleException
Appointment
Queue, QueueTicket
Visit, VisitVital, Diagnosis (→ Icd10Code), Prescription, Referral, VisitTemplate
Icd10Code (global directory), DrugDirectory (global/clinic)
ServiceCategory, Service, ServicePrice (effective-dated), ServicePackage, PackageItem, DiscountRule
Invoice, InvoiceLine, Payment, PatientBalanceTransaction, CashierShift, Refund, Expense, ExpenseCategory
LabTest, LabTestParameter, LabOrder, LabOrderItem, LabResult, LabResultValue
InventoryItem, StockBatch, StockMovement, Supplier (Phase 4)
CompensationRule, PayrollAccrual
NotificationTemplate, NotificationLog, TelegramLink
Feedback
AuditLog (append-only)
SubscriptionPlan, ClinicSubscription, FeatureFlag
```

Schema rules:
- Primary keys: `uuid` (v7 if available). Money: `DECIMAL(14,2)` — **never floats**. All timestamps `timestamptz` stored in UTC.
- Enums via Prisma enums for statuses.
- Indexes: `(clinicId, ...)` composite on every tenant table's frequent lookups; `pg_trgm` GIN on `Patient.fullName`, `Patient.phone`; unique `(clinicId, mrn)`; queue ticket unique `(queueId, ticketNumber)`; appointment overlap protection: transactional check with `SELECT ... FOR UPDATE` on the doctor's day (or Postgres exclusion constraint via raw migration on `tstzrange`).
- Migrations only through `prisma migrate`; never edit applied migrations; provide comprehensive `seed.ts` (see §13).

---

## 8. API CONVENTIONS

- REST under `/api/v1/...`; resource-oriented; plural nouns; nested only one level (`/patients/:id/visits`).
- Standard response envelope:
```json
{ "success": true, "data": ..., "meta": { "page": 1, "limit": 20, "total": 143 } }
{ "success": false, "error": { "code": "PATIENT_NOT_FOUND", "message": "...", "details": [] } }
```
- Pagination: `?page&limit` (default 20, max 100); filtering: explicit whitelisted query params; sorting: `?sort=createdAt:desc`.
- All input validated with shared Zod schemas from `packages/shared` (single source of truth reused by react-hook-form).
- Machine-readable stable error codes (frontend maps them to localized messages).
- Idempotency keys on payment-creating endpoints. Rate limiting per IP + per user (Redis).
- Swagger UI available in dev at `/api/docs`.

---

## 9. SECURITY & COMPLIANCE (medical data — non-negotiable)

1. Argon2id password hashing; JWT RS256; refresh rotation with reuse detection.
2. Strict tenant isolation (Prisma extension auto-filter, §4) + integration tests proving cross-tenant access is impossible.
3. RBAC enforced server-side on every route; object-level checks (e.g., doctor accessing a patient record requires relation).
4. Audit log on all sensitive mutations (§ M16).
5. Input sanitization; helmet; CORS allow-list; CSRF-safe (httpOnly cookies + SameSite); file upload validation (type sniffing, size limits, image re-encode); no PHI in logs or URLs.
6. Secrets via env only; provide `.env.example`; TLS assumed at Nginx.
7. Backups: document `pg_dump` nightly cron + retention; test-restore instructions in README.
8. Uzbekistan personal data law (O'zRQ-547): personal data stored on servers in Uzbekistan — note in deployment docs; consent tracking implemented (M3).

---

## 10. WEBSOCKET SPECIFICATION (Socket.IO)

**Connection:** `wss://.../socket.io`, auth via JWT in handshake `auth.token`. On connect, server validates and joins rooms strictly within the user's clinic.

**Rooms:**
```
clinic:{clinicId}                          — clinic-wide (admin dashboards)
branch:{branchId}:queues                   — all queue updates in branch (reception, displays)
branch:{branchId}:display                  — TV display channel
doctor:{doctorUserId}:queue                — a doctor's own queue
user:{userId}                              — personal notifications
labworklist:{branchId}                     — lab module
```

**Server → Client events (typed in packages/shared as `ServerToClientEvents`):**
```ts
queue.ticket.created      { ticket }               // new patient enqueued
queue.ticket.updated      { ticket }               // status/priority/order change
queue.ticket.called       { ticket, room, repeat } // display shows + TTS announce
queue.snapshot            { queueId, tickets[] }   // full state on join/reconnect
queue.stats.updated       { waiting, avgWaitMin, perDoctor[] }
appointment.updated       { appointment }          // calendar live refresh
notification.new          { notification }         // in-app notification center
lab.order.updated         { order }                // worklist live refresh
invoice.paid              { invoiceId, amount }    // cashier/owner dashboards
```

**Client → Server events (`ClientToServerEvents`):**
```ts
queue.subscribe   { branchId }        // display/reception join
queue.callNext    { queueId }         // doctor action → emits queue.ticket.called
queue.finish      { ticketId }        // → DONE + opens visit
queue.skip        { ticketId }
queue.recall      { ticketId }
```

Rules:
- WS is a **notification transport**, not the source of truth: every event handler on the client refetches or patches TanStack Query cache; on reconnect, client requests `queue.snapshot`.
- All mutations also available via REST (WS optional path for doctor actions is allowed but REST must exist).
- Use Redis adapter so multiple API instances broadcast correctly.
- Heartbeat/reconnect handled by Socket.IO defaults; display app shows connection status dot and auto-recovers.

---

## 11. FRONTEND UX REQUIREMENTS

- Layout: left sidebar (role-based menu), topbar with branch switcher, global patient search (Cmd/Ctrl+K), notification bell (live), user menu with locale switch.
- Key screens: Reception dashboard (today's appointments + live queue side by side, one-click enqueue), Doctor cockpit (my queue + current visit form), Cashier screen (invoice list, quick pay, shift panel), Owner dashboard (live KPIs), Patient card (tabbed: overview / timeline / visits / labs / files / invoices), Calendar, Settings.
- Fully responsive; reception & doctor screens optimized for desktop; owner dashboard usable on mobile.
- Loading skeletons, optimistic updates where safe, empty states with helpful actions, toasts for all mutations, confirm dialogs for destructive ops.
- Forms: instant Zod validation, phone input mask +998 (## ###-##-##), date pickers with Uzbek locale.
- Print stylesheets for: prescription, visit summary, lab result, receipt, invoice — clean A4/80mm layouts with clinic letterhead.
- Accessibility: keyboard navigation on queue actions, sufficient contrast; TV display readable from 5+ meters (huge type).
- Dark mode optional (nice-to-have, not priority).

---

## 12. NON-FUNCTIONAL REQUIREMENTS

- p95 API latency < 300 ms for CRUD, patient search < 100 ms server time.
- Queue event propagation (action → display update) < 1 s.
- Support 50+ concurrent staff users per clinic, 100+ tenant clinics on one deployment (design for horizontal scaling of `api` behind Nginx; stateless except Redis/Postgres).
- Graceful degradation: if WS drops, UI polls every 15 s and shows offline indicator.
- Testing minimum: unit tests for services with business logic (billing math, slot engine, queue transitions, compensation calc), e2e API tests for auth/tenant-isolation/appointments/queue/payments happy paths + critical edge cases, one Playwright smoke flow (login → register patient → enqueue → call → visit → invoice → pay).
- Code quality: no `any`, ESLint clean, feature-module folder structure in both apps, no business logic in controllers/components (services/hooks).

---

## 13. SEED DATA (for demo & development)

`prisma/seed.ts` must create: 1 super-admin; 2 demo clinics ("Shifo Med Servis" — 2 branches, "Nur Klinika" — 1 branch); per clinic: owner, admin, 4 doctors (kardiolog, pediatr, nevrolog, UTT), 2 receptionists, 1 cashier, 1 lab tech; 30 services in categories with realistic UZS prices; 3 packages; ICD-10 top-200 common codes (uz/ru names); 15 lab tests with parameters & reference ranges; 50 fake patients (uzbek names, +998 phones); appointments spread over ±7 days; today's live queues with tickets in mixed states; invoices/payments history for 30 days (for charts); notification templates in uz/ru. Document demo logins in README.

---

## 14. DEVELOPMENT PHASES (build in this order; each phase ends runnable)

**Phase 0 — Foundation (scaffold):** monorepo, docker-compose (pg+redis), NestJS+Prisma+config+logging, Next.js+Tailwind+shadcn, shared package with first Zod schemas, CI, auth (login/refresh/me), RBAC skeleton, seed v0. ✅ *Definition of done: login works, protected route works, tenant guard proven by test.*

**Phase 1 — Core operations (MVP):** M2 clinics/branches/rooms, M3 patients (registry+search+documents), M4 appointments+slot engine+calendar, M5 **live queue + WebSocket + TV display app**, minimal M7 services. ✅ *DoD: full front-desk flow works live in two browser windows (reception + display + doctor).*

**Phase 2 — Clinical & money:** M6 visits/SOAP/ICD-10/prescriptions/print, M8 invoices+cash payments+shifts+debts, M9 laboratory, M13 notifications (Eskiz + Telegram bot + in-app). ✅ *DoD: patient journey ends with printed summary and paid invoice; SMS delivered in sandbox/log mode.*

**Phase 3 — Growth:** M12 analytics+exports, M11 staff schedules+compensation/KPI, M14 patient portal+online booking, Payme/Click/Uzum online payments, M15 feedback, M17 super-admin panel+plans.

**Phase 4 — Scale & polish:** M10 inventory, materialized views, load testing, backup automation, optional telemedicine hook, optional **AviRadiology integration point** (webhook/REST contract: send study order, receive report PDF into patient timeline — design the interface, implement stub).

For EVERY phase: update seed, update Swagger, write tests, update README (run instructions), demo checklist.

---

## 15. WORKING AGREEMENTS FOR THE AI DEVELOPER

1. Before coding each phase, output: brief plan, affected Prisma models, endpoints list, events list. Then implement.
2. Never invent scope beyond this spec without flagging it; if the spec is ambiguous, choose the simplest option and note the decision in `DECISIONS.md`.
3. All user-facing strings go through i18n from day one (uz-Latn default; ru; en keys may lag but structure must exist).
4. Every module = NestJS feature module (controller/service/repository) + matching frontend feature folder.
5. Commit style: Conventional Commits; small, reviewable increments.
6. At the end of each phase, provide: how-to-run steps, demo script (click path), and list of known limitations.

**Start now with Phase 0. Show me the plan first.**
