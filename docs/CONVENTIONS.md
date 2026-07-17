# AviShifo — Engineering Conventions (read before writing any code)

This document is the binding contract for every module/feature author. The master
specification lives in `avishifo-crm-prompt.md`. When in doubt: spec first, then this file,
then the simplest option (note it in `DECISIONS.md`).

## Monorepo

```
apps/api       @avishifo/api       NestJS 11 backend (REST /api/v1 + Socket.IO)
apps/web       @avishifo/web       Next.js 15 staff panel + super-admin
apps/display   @avishifo/display   TV queue display (Next.js, fullscreen)
apps/portal    @avishifo/portal    Patient portal + online booking
packages/shared @avishifo/shared   Zod schemas, enums, permissions, socket events, types, utils
packages/config @avishifo/config   tsconfig presets
```

- Import shared code ONLY as `@avishifo/shared` (never relative across packages).
- TypeScript strict everywhere. `any` is forbidden (ESLint error). Use `unknown` + narrowing.
- All money values: `Prisma.Decimal` in DB, **string** over the wire, never `number` floats.
- All timestamps: UTC ISO strings over the wire; display in `Asia/Tashkent`.
- Phone numbers stored normalized: `+998XXXXXXXXX` (13 chars). Use `normalizePhone()` from shared.

## Backend (apps/api)

### Module layout

Every feature is a NestJS module under `apps/api/src/modules/<name>/`:

```
modules/patients/
├── patients.module.ts        # exports PatientsModule
├── patients.controller.ts    # thin: parse/validate → service → return
├── patients.service.ts       # ALL business logic here
├── dto/                      # zod-derived DTOs via createZodDto (nestjs-zod)
└── ...                       # extra services/processors as needed
```

- Controllers contain **no business logic**. Services never import controllers.
- Register the module in `apps/api/src/app.module.ts` imports array.

### Validation

- Zod schemas live in `packages/shared/src/schemas/<module>.ts` and are the single source
  of truth (frontend reuses them with react-hook-form).
- In Nest, wrap them: `class CreatePatientDto extends createZodDto(createPatientSchema) {}`
  (global `ZodValidationPipe` is already installed — just type controller params with the DTO).

### Auth, tenancy, RBAC (already implemented in core — USE, do not reimplement)

Concrete import paths (from a file in `src/modules/<name>/`):

```ts
import { Public, RequirePermissions, CurrentUser, ActiveBranch } from '../../common/decorators';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { EventsService } from '../../core/realtime/events.service';
import { AuditService } from '../../core/audit/audit.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { RedisService } from '../../core/redis/redis.service';
import { ErrorCode, createPatientSchema /* etc */ } from '@avishifo/shared';
```

- `JwtAuthGuard` is global. Public endpoints: `@Public()` decorator.
- Permissions: `@RequirePermissions('patients.read')` — permission strings come from
  `PERMISSIONS` in `@avishifo/shared`. Never invent new strings inline; add them to shared.
- `@CurrentUser() user: AuthUser` → (id, clinicId, branchIds, role, permissions).
- Active branch: `@ActiveBranch() branchId: string` reads `x-branch-id` header (validated).
- **Tenancy**: use `this.prisma.db.<model>` — it auto-injects `clinicId` on every
  top-level query/create for tenant-scoped models from `TenantContext` (ALS). Do NOT add
  `clinicId` filters manually. **Exception: nested writes** — `create` nested inside
  another create is NOT auto-stamped, so nested-create payloads must include
  `clinicId: TenantContext.requireClinicId()` explicitly.
- `this.prisma.unscoped.<model>` bypasses isolation — only for platform scope
  (super-admin, auth login lookups, system jobs), always justified in a comment.
- Background jobs: enqueue with `{ clinicId, ... }` payload; workers wrap the handler in
  `TenantContext.run({ clinicId }, async () => { ... })`. Same for WS event handlers.
- Counters: `sequence.nextFormatted('mrn', 'P')` → "P-000001" (atomic per clinic).

### Responses & errors

- Global interceptor wraps returns into `{ success: true, data }`.
  - Return plain data for single objects.
  - For lists return `paginated(items, { page, limit, total })` from `common/pagination`.
- Errors: `throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404, details?)`.
  Error codes are defined in `@avishifo/shared` (`ErrorCode`) — add new codes there.
- Prisma `Decimal` values must be serialized to strings in responses (`decimal.toFixed(2)`).
- Never leak PHI (names, phones) into log lines or URLs. Log ids only.

### Database

- Schema: `apps/api/prisma/schema.prisma`. PKs `@default(uuid(7))`. Money `@db.Decimal(14, 2)`.
- Timestamps `@db.Timestamptz(6)`. Statuses are Prisma enums mirrored in shared enums.
- Migrations via `prisma migrate dev` only. Never edit applied migrations.
- Heavy aggregates: raw SQL via `prisma.$queryRaw` in report services (typed rows).

### Audit

- Call `auditService.log({ action, entity, entityId, before, after })` for mutations on:
  patients, visits, invoices, payments, refunds, users, settings, queue transfers.
  (`clinicId`/`userId`/ip come from context automatically.)

### WebSocket

- One gateway: `apps/api/src/modules/queue/` + `EventsService` (`events.service.ts` in
  core `realtime/` module) that any service can inject to emit typed events:
  `events.toBranchQueues(branchId, 'queue.ticket.updated', payload)`.
- Event names/payloads are typed in `@avishifo/shared` (`ServerToClientEvents`).
  WS is notification transport only — REST remains the source of truth.

## Frontend (apps/web)

### Layout

```
src/
├── app/[locale]/(auth)/login/...        # public auth pages
├── app/[locale]/(app)/...               # protected shell: sidebar+topbar
├── components/ui/                       # shadcn components (do not hand-edit style system)
├── components/...                       # shared app components
├── features/<name>/                     # feature folders: components/, hooks/, api.ts
├── lib/api-client.ts                    # apiFetch + typed helpers (envelope-aware)
├── lib/socket.ts + hooks/use-socket.ts  # typed socket.io client
├── i18n/ + messages/{uz,ru,en}.json     # next-intl
└── stores/                              # zustand (UI state only)
```

- Server state = TanStack Query only. Query keys: `[module, ...params]` (e.g. `['patients', {page}]`).
- After WS event → `queryClient.invalidateQueries` or targeted cache patch. Never treat WS as source of truth.
- Forms: react-hook-form + `zodResolver(schemaFromShared)`.
- All user-facing strings via `useTranslations()` — add keys to `messages/uz.json` (+ru, en).
  uz-Latn is the default locale. Keys: `module.screen.label` style.
- Mutations show toast (sonner) on success/error; destructive ops use `<ConfirmDialog>`.
- Money display: `formatUZS()` from shared. Dates: `formatTz()` helpers in `lib/dates.ts`.

## Testing

- Unit (Vitest): colocate as `*.spec.ts` next to services. Test pure business logic
  (billing math, slot engine, queue transitions, compensation calc).
- API e2e (Vitest + Supertest): `apps/api/test/*.e2e-spec.ts` against a real Postgres.
- Frontend smoke: Playwright in `apps/web/e2e/`.

## Git

- Conventional Commits: `feat(api): patient merge endpoint`, `fix(web): queue board reorder`.
- Small, reviewable increments.
