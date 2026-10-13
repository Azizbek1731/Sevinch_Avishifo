import { describe, expect, it } from 'vitest';
import { inputTiyin } from './payment-methods';

describe('money entry during payment splitting', () => {
  it('keeps typing states from throwing during render', () => {
    for (const value of ['', '.', '100.', '1.234', 'letters']) {
      expect(inputTiyin(value)).toBeNull();
    }
  });

  it('preserves tiyin without floating-point rounding', () => {
    expect(inputTiyin('999999999999.99')).toBe(99999999999999n);
    expect(inputTiyin('0.01')).toBe(1n);
    expect(inputTiyin('123.4')).toBe(12340n);
  });

  it('distinguishes zero from invalid input for amount validation', () => {
    expect(inputTiyin('0')).toBe(0n);
    expect(inputTiyin('0.00')).toBe(0n);
    expect(inputTiyin('')).not.toBe(0n);
  });
});
