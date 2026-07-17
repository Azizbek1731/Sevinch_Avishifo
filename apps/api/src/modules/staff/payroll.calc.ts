import { Prisma, type CompensationType } from '@prisma/client';

/**
 * Pure payroll accrual math (spec §M11) — no I/O, unit-testable in isolation.
 *
 * FIXED_SALARY      → base  += value                        (no pro-rating)
 * REVENUE_PERCENT   → bonus += value% × Σ lineTotal (scope) (paid/partially-paid invoices)
 * PER_SERVICE_FEE   → bonus += value × Σ quantity   (scope)
 *
 * Scope: rule.serviceId (exact service) wins over rule.serviceCategoryId
 * (whole category); both null = every line of the doctor.
 */

export interface AccrualRule {
  type: CompensationType;
  /** FIXED_SALARY: monthly amount; REVENUE_PERCENT: 0-100; PER_SERVICE_FEE: fee. */
  value: Prisma.Decimal | string;
  serviceId: string | null;
  serviceCategoryId: string | null;
}

export interface AccrualLine {
  serviceId: string | null;
  /** Category of the billed service (null for free-form lines). */
  serviceCategoryId: string | null;
  quantity: number;
  lineTotal: Prisma.Decimal | string;
}

export interface AccrualBreakdownRow {
  ruleType: CompensationType;
  /** Human-readable computation basis, e.g. "10.00% of 2500000.00". */
  basis: string;
  /** Rule contribution as a 2-dp decimal string. */
  amount: string;
}

export interface AccrualResult {
  base: Prisma.Decimal;
  bonus: Prisma.Decimal;
  breakdown: AccrualBreakdownRow[];
}

function matchesScope(rule: AccrualRule, line: AccrualLine): boolean {
  if (rule.serviceId) return line.serviceId === rule.serviceId;
  if (rule.serviceCategoryId) return line.serviceCategoryId === rule.serviceCategoryId;
  return true;
}

export function calcAccrual(
  rules: readonly AccrualRule[],
  lines: readonly AccrualLine[],
): AccrualResult {
  let base = new Prisma.Decimal(0);
  let bonus = new Prisma.Decimal(0);
  const breakdown: AccrualBreakdownRow[] = [];

  for (const rule of rules) {
    const value = new Prisma.Decimal(rule.value);

    if (rule.type === 'FIXED_SALARY') {
      const amount = value.toDecimalPlaces(2);
      base = base.add(amount);
      breakdown.push({ ruleType: rule.type, basis: 'monthly salary', amount: amount.toFixed(2) });
      continue;
    }

    const scoped = lines.filter((l) => matchesScope(rule, l));

    if (rule.type === 'REVENUE_PERCENT') {
      const revenue = scoped.reduce(
        (acc, l) => acc.add(new Prisma.Decimal(l.lineTotal)),
        new Prisma.Decimal(0),
      );
      const amount = revenue.mul(value).div(100).toDecimalPlaces(2);
      bonus = bonus.add(amount);
      breakdown.push({
        ruleType: rule.type,
        basis: `${value.toFixed(2)}% of ${revenue.toFixed(2)}`,
        amount: amount.toFixed(2),
      });
      continue;
    }

    // PER_SERVICE_FEE
    const count = scoped.reduce((acc, l) => acc + l.quantity, 0);
    const amount = value.mul(count).toDecimalPlaces(2);
    bonus = bonus.add(amount);
    breakdown.push({
      ruleType: rule.type,
      basis: `${value.toFixed(2)} x ${count}`,
      amount: amount.toFixed(2),
    });
  }

  return { base, bonus, breakdown };
}

/** "2026-07" → UTC [start of month, start of next month). */
export function periodRange(period: string): { start: Date; end: Date } {
  const parts = period.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid accrual period "${period}" (expected YYYY-MM)`);
  }
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
