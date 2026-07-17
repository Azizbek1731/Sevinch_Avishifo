import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  /** null = platform scope (SUPER_ADMIN, system jobs that opted out). */
  clinicId: string | null;
  userId?: string;
  role?: string;
  branchId?: string;
  ip?: string;
  userAgent?: string;
  /** When true, the Prisma tenant extension does not inject clinicId filters. */
  bypassTenant?: boolean;
}

const als = new AsyncLocalStorage<TenantStore>();

/**
 * Request/job-scoped tenant context. HTTP requests enter via TenantContextInterceptor;
 * WS handlers and BullMQ workers must call TenantContext.run(...) explicitly.
 */
export const TenantContext = {
  run<T>(store: TenantStore, fn: () => T): T {
    return als.run(store, fn);
  },
  get(): TenantStore | undefined {
    return als.getStore();
  },
  clinicId(): string | null {
    return als.getStore()?.clinicId ?? null;
  },
  requireClinicId(): string {
    const id = als.getStore()?.clinicId;
    if (!id) throw new Error('Tenant context is missing (no clinicId)');
    return id;
  },
};
