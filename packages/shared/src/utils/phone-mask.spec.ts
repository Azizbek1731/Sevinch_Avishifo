import { describe, expect, it } from 'vitest';
import {
  formatNationalPhone,
  phoneWireValue,
  phoneWireValueOptional,
  toNationalDigits,
} from './phone-mask';

describe('toNationalDigits', () => {
  it('keeps the 9 national digits', () => {
    expect(toNationalDigits('901234567')).toBe('901234567');
  });

  it('drops every non-digit', () => {
    expect(toNationalDigits('+998 90 123-45-67')).toBe('901234567');
    expect(toNationalDigits('(90) 123 45 67')).toBe('901234567');
  });

  it('strips a pasted country code', () => {
    expect(toNationalDigits('998901234567')).toBe('901234567');
    expect(toNationalDigits('+998901234567')).toBe('901234567');
  });

  it('keeps 99-operator numbers intact', () => {
    // 99 812 34 56 is a real national number that starts with "998" — it must
    // not be mistaken for a country code.
    expect(toNationalDigits('998123456')).toBe('998123456');
  });

  it('never exceeds 9 digits', () => {
    expect(toNationalDigits('9012345678901')).toHaveLength(9);
  });

  it('is empty for empty input', () => {
    expect(toNationalDigits('')).toBe('');
    expect(toNationalDigits('abc')).toBe('');
  });
});

describe('formatNationalPhone', () => {
  it('formats progressively as the user types', () => {
    expect(formatNationalPhone('9')).toBe('9');
    expect(formatNationalPhone('90')).toBe('90');
    expect(formatNationalPhone('901')).toBe('90 1');
    expect(formatNationalPhone('90123')).toBe('90 123');
    expect(formatNationalPhone('9012345')).toBe('90 123-45');
    expect(formatNationalPhone('901234567')).toBe('90 123-45-67');
  });

  it('is idempotent on already-formatted input', () => {
    expect(formatNationalPhone('90 123-45-67')).toBe('90 123-45-67');
  });
});

describe('phoneWireValue', () => {
  it('produces the normalized wire form only when complete', () => {
    expect(phoneWireValue('90 123-45-67')).toBe('+998901234567');
    expect(phoneWireValue('+998901234567')).toBe('+998901234567');
  });

  it('refuses a half-typed number rather than sending it', () => {
    expect(phoneWireValue('90 123')).toBe('');
    expect(phoneWireValue('')).toBe('');
  });
});

describe('phoneWireValueOptional', () => {
  it('treats an empty box as absent', () => {
    expect(phoneWireValueOptional('')).toBeUndefined();
    expect(phoneWireValueOptional('   ')).toBeUndefined();
  });

  it('still rejects an incomplete number', () => {
    expect(phoneWireValueOptional('90 12')).toBe('');
  });

  it('normalizes a complete number', () => {
    expect(phoneWireValueOptional('90 123-45-67')).toBe('+998901234567');
  });
});
