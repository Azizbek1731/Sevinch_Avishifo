/**
 * Uzbek phone input masking, shared by the staff panel and the patient portal
 * so both enforce exactly one shape: +998 XX XXX-XX-XX.
 *
 * The UI never lets a malformed number be typed — everything that is not a
 * digit is dropped and the national part is capped at 9 — so validation errors
 * become impossible rather than merely reported.
 */

/** National digits only (max 9), tolerating a pasted +998 / 998 prefix. */
export function toNationalDigits(input: string): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  // A pasted "+998901234567" / "998901234567" carries the country code.
  const national = digits.length > 9 && digits.startsWith('998') ? digits.slice(3) : digits;
  return national.slice(0, 9);
}

/** "901234567" → "90 123-45-67" (partial input formats as far as it goes). */
export function formatNationalPhone(input: string): string {
  const d = toNationalDigits(input);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length <= 7) return `${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7)}`;
}

/**
 * Masked display value → the wire value `+998XXXXXXXXX`.
 * Returns '' while the number is incomplete, so a half-typed number fails
 * validation instead of silently reaching the API.
 */
export function phoneWireValue(input: unknown): string {
  const d = toNationalDigits(String(input ?? ''));
  return d.length === 9 ? `+998${d}` : '';
}

/** Same, but an empty box means "not provided" rather than "invalid". */
export function phoneWireValueOptional(input: unknown): string | undefined {
  const d = toNationalDigits(String(input ?? ''));
  if (d.length === 0) return undefined;
  return d.length === 9 ? `+998${d}` : '';
}
