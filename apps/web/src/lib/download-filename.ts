/**
 * Prefer RFC 5987 filename*=UTF-8''… from Content-Disposition; fall back to
 * filename="…"; then to a caller-provided default.
 */
export function filenameFromContentDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  if (!header) return fallback;
  const utf8 = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"+|"+$/g, ''));
    } catch {
      /* keep looking */
    }
  }
  const plain = header.match(/filename\s*=\s*("([^"]+)"|([^;]+))/i);
  const value = (plain?.[2] ?? plain?.[3] ?? '').trim();
  return value || fallback;
}
