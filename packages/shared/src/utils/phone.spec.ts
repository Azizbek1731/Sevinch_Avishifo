import { describe, expect, it } from 'vitest';
import { formatPhone, isValidPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('keeps an already-normalized number', () => {
    expect(normalizePhone('+998901234567')).toBe('+998901234567');
  });

  it('strips spaces and dashes', () => {
    expect(normalizePhone('+998 90 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('998 90 123 45 67')).toBe('+998901234567');
  });

  it('accepts a bare 9-digit national number', () => {
    expect(normalizePhone('901234567')).toBe('+998901234567');
    expect(normalizePhone('90 123 45 67')).toBe('+998901234567');
  });

  it('accepts a 998-prefixed 12-digit number without plus', () => {
    expect(normalizePhone('998901234567')).toBe('+998901234567');
  });

  it('accepts parentheses and other punctuation', () => {
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('+998901234567');
  });

  it('rejects wrong lengths', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('9012345678')).toBeNull(); // 10 digits, no 998 prefix
    expect(normalizePhone('99890123456')).toBeNull(); // 11 digits
    expect(normalizePhone('9989012345678')).toBeNull(); // 13 digits
  });

  it('rejects non-Uzbek country codes', () => {
    expect(normalizePhone('+7 900 123 45 67')).toBeNull();
    expect(normalizePhone('+1 202 555 0134')).toBeNull();
  });

  it('rejects empty and letter-only input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('phone')).toBeNull();
  });

  it('a 12-digit number not starting with 998 is rejected', () => {
    expect(normalizePhone('997901234567')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('formats a normalized number for display', () => {
    expect(formatPhone('+998901234567')).toBe('+998 90 123-45-67');
  });

  it('round-trips with normalizePhone', () => {
    expect(normalizePhone(formatPhone('+998971112233'))).toBe('+998971112233');
  });

  it('returns non-matching input unchanged', () => {
    expect(formatPhone('901234567')).toBe('901234567');
    expect(formatPhone('garbage')).toBe('garbage');
  });
});

describe('isValidPhone', () => {
  it('accepts only the normalized +998XXXXXXXXX form', () => {
    expect(isValidPhone('+998901234567')).toBe(true);
    expect(isValidPhone('998901234567')).toBe(false);
    expect(isValidPhone('+998 90 123-45-67')).toBe(false);
    expect(isValidPhone('+99890123456')).toBe(false);
  });
});
