import { PHONE_REGEX } from '../constants';

/**
 * Normalize any user-entered Uzbek phone to `+998XXXXXXXXX`.
 * Accepts "+998 90 123-45-67", "90 123 45 67", "998901234567" etc.
 * Returns null if the input cannot be a valid +998 number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string;
  if (digits.length === 12 && digits.startsWith('998')) national = digits.slice(3);
  else if (digits.length === 9) national = digits;
  else return null;
  const normalized = `+998${national}`;
  return PHONE_REGEX.test(normalized) ? normalized : null;
}

/** "+998901234567" → "+998 90 123-45-67" */
export function formatPhone(phone: string): string {
  const m = phone.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return phone;
  return `+998 ${m[1]} ${m[2]}-${m[3]}-${m[4]}`;
}

export function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone);
}
