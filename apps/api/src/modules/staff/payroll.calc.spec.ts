import { describe, expect, it } from 'vitest';
import { calcAccrual, periodRange, type AccrualLine, type AccrualRule } from './payroll.calc';

const rule = (over: Partial<AccrualRule> & Pick<AccrualRule, 'type' | 'value'>): AccrualRule => ({
  serviceId: null,
  serviceCategoryId: null,
  ...over,
});

const line = (over: Partial<AccrualLine> = {}): AccrualLine => ({
  serviceId: 'svc-1',
  serviceCategoryId: 'cat-1',
  quantity: 1,
  lineTotal: '100000.00',
  ...over,
});

describe('calcAccrual', () => {
  it('returns zeros for no rules', () => {
    const r = calcAccrual([], [line()]);
    expect(r.base.toFixed(2)).toBe('0.00');
    expect(r.bonus.toFixed(2)).toBe('0.00');
    expect(r.breakdown).toEqual([]);
  });

  // ------------------------------------------------------------ FIXED_SALARY

  it('FIXED_SALARY adds the full value to base regardless of lines', () => {
    const r = calcAccrual([rule({ type: 'FIXED_SALARY', value: '3000000' })], []);
    expect(r.base.toFixed(2)).toBe('3000000.00');
    expect(r.bonus.toFixed(2)).toBe('0.00');
    expect(r.breakdown).toEqual([
      { ruleType: 'FIXED_SALARY', basis: 'monthly salary', amount: '3000000.00' },
    ]);
  });

  it('FIXED_SALARY rounds the value to 2 decimal places', () => {
    const r = calcAccrual([rule({ type: 'FIXED_SALARY', value: '1234.567' })], []);
    expect(r.base.toFixed(2)).toBe('1234.57');
  });

  it('two FIXED_SALARY rules accumulate', () => {
    const r = calcAccrual(
      [rule({ type: 'FIXED_SALARY', value: '1000000' }), rule({ type: 'FIXED_SALARY', value: '500000' })],
      [],
    );
    expect(r.base.toFixed(2)).toBe('1500000.00');
    expect(r.breakdown).toHaveLength(2);
  });

  // --------------------------------------------------------- REVENUE_PERCENT

  it('REVENUE_PERCENT without scope covers every line', () => {
    const r = calcAccrual(
      [rule({ type: 'REVENUE_PERCENT', value: '10' })],
      [line({ lineTotal: '1500000.00' }), line({ serviceId: 'svc-2', lineTotal: '1000000.00' })],
    );
    expect(r.bonus.toFixed(2)).toBe('250000.00');
    expect(r.base.toFixed(2)).toBe('0.00');
    expect(r.breakdown[0]).toEqual({
      ruleType: 'REVENUE_PERCENT',
      basis: '10.00% of 2500000.00',
      amount: '250000.00',
    });
  });

  it('REVENUE_PERCENT rounds the contribution to 2dp', () => {
    const r = calcAccrual(
      [rule({ type: 'REVENUE_PERCENT', value: '12.5' })],
      [line({ lineTotal: '333.33' })],
    );
    // 333.33 * 12.5% = 41.66625 → 41.67
    expect(r.bonus.toFixed(2)).toBe('41.67');
  });

  it('REVENUE_PERCENT scoped to a serviceId only counts matching lines', () => {
    const r = calcAccrual(
      [rule({ type: 'REVENUE_PERCENT', value: '20', serviceId: 'svc-1' })],
      [
        line({ serviceId: 'svc-1', lineTotal: '200000.00' }),
        line({ serviceId: 'svc-2', lineTotal: '999999.00' }),
        line({ serviceId: null, lineTotal: '50000.00' }),
      ],
    );
    expect(r.bonus.toFixed(2)).toBe('40000.00');
  });

  it('REVENUE_PERCENT scoped to a category counts every line of the category', () => {
    const r = calcAccrual(
      [rule({ type: 'REVENUE_PERCENT', value: '10', serviceCategoryId: 'cat-1' })],
      [
        line({ serviceId: 'svc-1', serviceCategoryId: 'cat-1', lineTotal: '100000.00' }),
        line({ serviceId: 'svc-2', serviceCategoryId: 'cat-1', lineTotal: '100000.00' }),
        line({ serviceId: 'svc-3', serviceCategoryId: 'cat-2', lineTotal: '777777.00' }),
        line({ serviceId: null, serviceCategoryId: null, lineTotal: '5000.00' }),
      ],
    );
    expect(r.bonus.toFixed(2)).toBe('20000.00');
  });

  it('serviceId scope wins over serviceCategoryId when both are set', () => {
    const r = calcAccrual(
      [rule({ type: 'REVENUE_PERCENT', value: '10', serviceId: 'svc-1', serviceCategoryId: 'cat-1' })],
      [
        line({ serviceId: 'svc-1', serviceCategoryId: 'cat-1', lineTotal: '100000.00' }),
        // Same category, different service — must NOT match (serviceId is exact).
        line({ serviceId: 'svc-2', serviceCategoryId: 'cat-1', lineTotal: '900000.00' }),
      ],
    );
    expect(r.bonus.toFixed(2)).toBe('10000.00');
  });

  it('REVENUE_PERCENT with no matching lines contributes 0.00', () => {
    const r = calcAccrual(
      [rule({ type: 'REVENUE_PERCENT', value: '25', serviceId: 'svc-none' })],
      [line({ serviceId: 'svc-1', lineTotal: '100000.00' })],
    );
    expect(r.bonus.toFixed(2)).toBe('0.00');
    expect(r.breakdown[0]?.amount).toBe('0.00');
  });

  // --------------------------------------------------------- PER_SERVICE_FEE

  it('PER_SERVICE_FEE multiplies the fee by total quantity in scope', () => {
    const r = calcAccrual(
      [rule({ type: 'PER_SERVICE_FEE', value: '15000', serviceCategoryId: 'cat-1' })],
      [
        line({ serviceCategoryId: 'cat-1', quantity: 2 }),
        line({ serviceId: 'svc-2', serviceCategoryId: 'cat-1', quantity: 3 }),
        line({ serviceId: 'svc-9', serviceCategoryId: 'cat-9', quantity: 100 }),
      ],
    );
    expect(r.bonus.toFixed(2)).toBe('75000.00');
    expect(r.breakdown[0]).toEqual({
      ruleType: 'PER_SERVICE_FEE',
      basis: '15000.00 x 5',
      amount: '75000.00',
    });
  });

  it('PER_SERVICE_FEE with zero matching quantity contributes 0.00', () => {
    const r = calcAccrual([rule({ type: 'PER_SERVICE_FEE', value: '15000', serviceId: 'x' })], []);
    expect(r.bonus.toFixed(2)).toBe('0.00');
  });

  // ------------------------------------------------------------------ combos

  it('combines all three rule types into base + bonus with a full breakdown', () => {
    const r = calcAccrual(
      [
        rule({ type: 'FIXED_SALARY', value: '2000000' }),
        rule({ type: 'REVENUE_PERCENT', value: '10', serviceCategoryId: 'cat-1' }),
        rule({ type: 'PER_SERVICE_FEE', value: '5000', serviceId: 'svc-2' }),
      ],
      [
        line({ serviceId: 'svc-1', serviceCategoryId: 'cat-1', quantity: 1, lineTotal: '300000.00' }),
        line({ serviceId: 'svc-2', serviceCategoryId: 'cat-2', quantity: 4, lineTotal: '400000.00' }),
      ],
    );
    expect(r.base.toFixed(2)).toBe('2000000.00');
    // 10% of 300000 = 30000, plus 5000 × 4 = 20000.
    expect(r.bonus.toFixed(2)).toBe('50000.00');
    expect(r.breakdown.map((b) => b.ruleType)).toEqual([
      'FIXED_SALARY',
      'REVENUE_PERCENT',
      'PER_SERVICE_FEE',
    ]);
  });

  it('all-zero inputs stay zero', () => {
    const r = calcAccrual(
      [
        rule({ type: 'FIXED_SALARY', value: '0' }),
        rule({ type: 'REVENUE_PERCENT', value: '0' }),
        rule({ type: 'PER_SERVICE_FEE', value: '0' }),
      ],
      [line({ quantity: 5, lineTotal: '100000.00' })],
    );
    expect(r.base.toFixed(2)).toBe('0.00');
    expect(r.bonus.toFixed(2)).toBe('0.00');
  });
});

describe('periodRange', () => {
  it('maps "YYYY-MM" to a UTC month interval [start, next month)', () => {
    const { start, end } = periodRange('2026-07');
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rolls December into January of the next year', () => {
    const { start, end } = periodRange('2026-12');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects invalid periods', () => {
    expect(() => periodRange('2026-13')).toThrow();
    expect(() => periodRange('2026-00')).toThrow();
    expect(() => periodRange('garbage')).toThrow();
  });
});
