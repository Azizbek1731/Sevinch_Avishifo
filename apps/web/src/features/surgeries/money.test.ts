import { describe, expect, it } from 'vitest';
import { payoutPreview, usagePreview } from './money';

describe('surgery money previews', () => {
  it('calculates percentage from the operation fee, rounded half up to tiyin', () => {
    expect(payoutPreview('1000.05', 'PERCENT', '10')).toBe('100.01');
    expect(payoutPreview('999999999999.99', 'PERCENT', '33.33')).toBe('333300000000.00');
  });
  it('supports a fixed fee and rejects invalid rates or precision', () => {
    expect(payoutPreview('100', 'FIXED', '250.50')).toBe('250.50');
    expect(payoutPreview('100', 'PERCENT', '100.01')).toBeNull();
    expect(payoutPreview('100', 'FIXED', '0')).toBeNull();
    expect(payoutPreview('100', 'FIXED', '1.001')).toBeNull();
  });
  it('rounds fractional material quantities without floating-point loss', () => {
    expect(usagePreview('0.125', '12.20')).toBe('1.53');
    expect(usagePreview('0.001', '5.00')).toBe('0.01');
    expect(usagePreview('12.5', '4000')).toBe('50000.00');
    expect(usagePreview('0', '5000')).toBeNull();
    expect(usagePreview('1.0001', '5')).toBeNull();
  });
});
