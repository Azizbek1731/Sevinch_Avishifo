import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { TenantContext } from './tenant-context';

/**
 * Models auto-scoped by clinicId. Any model listed here gets the tenant filter
 * injected into every top-level query and clinicId injected into creates.
 *
 * NOT listed (handled manually, with care): Clinic, User, AuthSession, OtpCode,
 * Icd10Code, SubscriptionPlan, DrugDirectory (global+clinic mix), AuditLog.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Branch',
  'Room',
  'StaffProfile',
  'UserBranch',
  'Patient',
  'PatientDocument',
  'MedicalRecordAccess',
  'PatientConsent',
  'DoctorSchedule',
  'ScheduleException',
  'Appointment',
  'AppointmentService',
  'Queue',
  'QueueTicket',
  'Visit',
  'VisitVital',
  'Diagnosis',
  'Prescription',
  'Referral',
  'VisitTemplate',
  'VisitAmendment',
  'ServiceCategory',
  'Service',
  'ServicePrice',
  'ServicePackage',
  'PackageItem',
  'DiscountRule',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'Refund',
  'PatientBalanceTransaction',
  'CashierShift',
  'ExpenseCategory',
  'Expense',
  'LabTest',
  'LabTestParameter',
  'LabOrder',
  'LabOrderItem',
  'LabResult',
  'LabResultValue',
  'Supplier',
  'InventoryItem',
  'StockBatch',
  'StockMovement',
  'CompensationRule',
  'PayrollAccrual',
  'NotificationTemplate',
  'NotificationLog',
  'TelegramLink',
  'InAppNotification',
  'Feedback',
  'ClinicCounter',
  'FeatureFlag',
  'ClinicSubscription',
]);

type AnyArgs = {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function injectIntoData(data: unknown, clinicId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((d) => ({ ...(d as Record<string, unknown>), clinicId }));
  }
  return { ...(data as Record<string, unknown>), clinicId };
}

/**
 * Structural tenant isolation (spec §4): every top-level Prisma operation on a
 * tenant-scoped model is filtered/stamped with the current clinicId. Nested
 * writes are NOT covered — services must set clinicId on nested creates.
 */
export function createTenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          const store = TenantContext.get();
          if (store?.bypassTenant) return query(args);
          const clinicId = store?.clinicId;
          if (!clinicId) {
            throw new Error(
              `Tenant context missing for ${model}.${operation}. ` +
                'Wrap the call in TenantContext.run(...) or use prisma.unscoped with justification.',
            );
          }

          const a = (args ?? {}) as AnyArgs;
          switch (operation) {
            case 'create':
              a.data = injectIntoData(a.data, clinicId);
              break;
            case 'createMany':
            case 'createManyAndReturn':
              a.data = injectIntoData(a.data, clinicId);
              break;
            case 'upsert':
              a.where = { ...(a.where ?? {}), clinicId };
              a.create = { ...(a.create ?? {}), clinicId };
              break;
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'update':
            case 'delete':
              // Prisma 5+ allows non-unique fields alongside the unique filter.
              a.where = { ...(a.where ?? {}), clinicId };
              break;
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'updateMany':
            case 'deleteMany':
              a.where = { AND: [{ clinicId }, a.where ?? {}] };
              break;
            default:
              // queryRaw etc. never reach here (no model); anything new fails safe:
              throw new Error(`Unhandled operation "${operation}" on tenant model ${model}`);
          }
          return query(args);
        },
      },
    },
  });
}

export function createExtendedClient(base: PrismaClient) {
  return base.$extends(createTenantExtension());
}

export type TenantPrismaClient = ReturnType<typeof createExtendedClient>;
