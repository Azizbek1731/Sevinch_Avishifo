/** "Alisher Karimov" → "A. Karimov" — compact form for the waiting column. */
export function shortDoctorName(fullName: string | null): string {
  if (fullName === null) return '';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  if (first === undefined || first.length === 0) return '';
  if (parts.length === 1) return first;
  const last = parts[parts.length - 1];
  if (last === undefined || last.length === 0) return first;
  return `${first.charAt(0)}. ${last}`;
}

/** "5" → "5-xona"; null/blank → null. */
export function roomLabel(roomNumber: string | null): string | null {
  if (roomNumber === null) return null;
  const trimmed = roomNumber.trim();
  return trimmed.length > 0 ? `${trimmed}-xona` : null;
}
