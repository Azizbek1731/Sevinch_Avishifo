import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatUZS,
  fromTiyin,
  isZeroMoney,
  subMoney,
  toTiyin,
} from './money';

describe('toTiyin', () => {
  it('parses whole and fractional strings', () => {
    expect(toTiyin('0')).toBe(0n);
    expect(toTiyin('12')).toBe(1200n);
    expect(toTiyin('12.3')).toBe(1230n);
    expect(toTiyin('12.34')).toBe(1234n);
  });

  it('parses negative amounts', () => {
    expect(toTiyin('-5.25')).toBe(-525n);
    expect(toTiyin('-0.01')).toBe(-1n);
  });

  it('accepts numbers via toFixed(2) rounding', () => {
    expect(toTiyin(12)).toBe(1200n);
    expect(toTiyin(0.1 + 0.2)).toBe(30n); // float noise rounded away
    expect(toTiyin(1.005)).toBe(toTiyin(Number((1.005).toFixed(2))));
  });

  it('handles amounts beyond Number.MAX_SAFE_INTEGER tiyin', () => {
    expect(toTiyin('92233720368547758.07')).toBe(9223372036854775807n);
  });

  it('throws on invalid strings', () => {
    expect(() => toTiyin('abc')).toThrow(/Invalid money/);
    expect(() => toTiyin('')).toThrow(/Invalid money/);
    expect(() => toTiyin('1,50')).toThrow(/Invalid money/);
    expect(() => toTiyin('1.234')).toThrow(/Invalid money/); // 3 fraction digits
    expect(() => toTiyin('.5')).toThrow(/Invalid money/);
    expect(() => toTiyin('1.')).toThrow(/Invalid money/);
    expect(() => toTiyin('+5.00')).toThrow(/Invalid money/);
  });

  it('tolerates surrounding whitespace', () => {
    expect(toTiyin(' 10.50 ')).toBe(1050n);
  });
});

describe('fromTiyin', () => {
  it('renders two fraction digits always', () => {
    expect(fromTiyin(0n)).toBe('0.00');
    expect(fromTiyin(5n)).toBe('0.05');
    expect(fromTiyin(1234n)).toBe('12.34');
    expect(fromTiyin(120000n)).toBe('1200.00');
  });

  it('renders negative amounts', () => {
    expect(fromTiyin(-1n)).toBe('-0.01');
    expect(fromTiyin(-525n)).toBe('-5.25');
  });

  it('round-trips with toTiyin', () => {
    for (const s of ['0.00', '0.07', '99.99', '-12.34', '1500000.00']) {
      expect(fromTiyin(toTiyin(s))).toBe(s);
    }
  });
});

describe('addMoney / subMoney', () => {
  it('adds amounts without float drift', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('1.99', '2.01')).toBe('4.00');
  });

  it('adds any number of amounts', () => {
    expect(addMoney('1.00', '2.00', '3.50')).toBe('6.50');
    expect(addMoney()).toBe('0.00');
  });

  it('subtracts into negative territory', () => {
    expect(subMoney('5.00', '7.25')).toBe('-2.25');
    expect(subMoney('7.25', '5.00')).toBe('2.25');
  });

  it('propagates invalid input errors', () => {
    expect(() => addMoney('1.00', 'nope')).toThrow(/Invalid money/);
    expect(() => subMoney('x', '1.00')).toThrow(/Invalid money/);
  });
});

describe('compareMoney / isZeroMoney', () => {
  it('orders amounts', () => {
    expect(compareMoney('1.00', '2.00')).toBe(-1);
    expect(compareMoney('2.00', '1.00')).toBe(1);
    expect(compareMoney('2.00', '2.00')).toBe(0);
    expect(compareMoney('-1.00', '0.00')).toBe(-1);
  });

  it('treats different renderings of the same value as equal', () => {
    expect(compareMoney('2', '2.00')).toBe(0);
    expect(compareMoney('2.5', '2.50')).toBe(0);
  });

  it('detects zero', () => {
    expect(isZeroMoney('0')).toBe(true);
    expect(isZeroMoney('0.00')).toBe(true);
    expect(isZeroMoney('0.01')).toBe(false);
  });
});

describe('formatUZS', () => {
  it('groups thousands with spaces and appends the currency', () => {
    expect(formatUZS('1500000.00')).toBe("1 500 000 so'm");
    expect(formatUZS('999.00')).toBe("999 so'm");
    expect(formatUZS('0.00')).toBe("0 so'm");
  });

  it('shows the fraction only when non-zero', () => {
    expect(formatUZS('1500000.50')).toBe("1 500 000.50 so'm");
    expect(formatUZS('0.05')).toBe("0.05 so'm");
  });

  it('formats negative amounts', () => {
    expect(formatUZS('-1234.00')).toBe("-1 234 so'm");
    expect(formatUZS('-1234.56')).toBe("-1 234.56 so'm");
  });

  it('can omit the currency suffix', () => {
    expect(formatUZS('1500000.00', { withCurrency: false })).toBe('1 500 000');
  });

  it('accepts numbers', () => {
    expect(formatUZS(2500000)).toBe("2 500 000 so'm");
  });
});
