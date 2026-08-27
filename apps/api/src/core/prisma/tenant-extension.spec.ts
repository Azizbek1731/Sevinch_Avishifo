import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TENANT_MODELS } from './tenant-extension';

/**
 * A model that carries clinicId but is missing from TENANT_MODELS runs every
 * query unscoped — one clinic reads another clinic's rows. That is exactly how
 * the whole ward module (Admission, TreatmentOrder, …) leaked: it shipped after
 * the list was written and nobody added it.
 *
 * This reads the schema rather than naming models, so the next module to be
 * added is caught the day it lands instead of in production.
 */
const INTENTIONALLY_UNSCOPED = new Set([
  // Resolved from the JWT before a tenant context exists.
  'User',
  // Global dictionary with an optional per-clinic tail.
  'DrugDirectory',
  // Written by the audit interceptor, which sets clinicId itself and must be
  // able to record cross-tenant access attempts.
  'AuditLog',
]);

function modelsWithClinicId(): string[] {
  const schema = readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');
  const out: string[] = [];
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(schema)) !== null) {
    const [, name, body] = m;
    if (name !== undefined && body !== undefined && /^\s*clinicId\s+String/m.test(body)) {
      out.push(name);
    }
  }
  return out;
}

describe('tenant scoping covers every tenant model', () => {
  it('finds the models in the schema at all', () => {
    expect(modelsWithClinicId().length).toBeGreaterThan(50);
  });

  it('leaves no clinicId-bearing model unscoped by accident', () => {
    const unlisted = modelsWithClinicId().filter(
      (name) => !TENANT_MODELS.has(name) && !INTENTIONALLY_UNSCOPED.has(name),
    );
    expect(unlisted).toEqual([]);
  });

  it('scopes the ward, whose absence leaked inpatients across clinics', () => {
    for (const name of [
      'Admission',
      'AdmissionDailyNote',
      'TreatmentOrder',
      'TreatmentAdministration',
      'ChargeItem',
    ]) {
      expect(TENANT_MODELS.has(name), `${name} must be tenant-scoped`).toBe(true);
    }
  });

  it('does not list a model the schema no longer has', () => {
    const known = new Set(modelsWithClinicId());
    const stale = [...TENANT_MODELS].filter((name) => !known.has(name));
    expect(stale).toEqual([]);
  });
});
