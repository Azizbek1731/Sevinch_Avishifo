import { Gender, ResultFlag, type LocalizedNameInput, type ReferenceRangeInput } from '@avishifo/shared';

export type UiLocale = 'uz' | 'ru' | 'en';

/** Pick the localized variant of a {uz, ru?, en?} name (uz is first-class fallback). */
export function localizedName(name: LocalizedNameInput, locale: UiLocale): string {
  if (locale === 'ru' && name.ru) return name.ru;
  if (locale === 'en' && name.en) return name.en;
  return name.uz;
}

/** Short single-letter flag marker: H (high) / L (low) / A (abnormal). */
export function flagMark(flag: ResultFlag): string {
  switch (flag) {
    case ResultFlag.HIGH:
      return 'H';
    case ResultFlag.LOW:
      return 'L';
    case ResultFlag.ABNORMAL:
      return 'A';
    default:
      return '';
  }
}

/** Tailwind text color for a result flag: H red, L blue, A red. */
export function flagClass(flag: ResultFlag): string {
  switch (flag) {
    case ResultFlag.HIGH:
    case ResultFlag.ABNORMAL:
      return 'text-destructive';
    case ResultFlag.LOW:
      return 'text-primary';
    default:
      return '';
  }
}

/** Localized labels for {@link referenceText}; pass translated values from the caller. */
export interface ReferenceTextLabels {
  /** Label for a gender-restricted range, e.g. localized "Male"/"Female". */
  genderLabel: (gender: Gender) => string;
  /** Suffix after an age range, e.g. localized "y" (years). */
  yearsSuffix: string;
}

/** Human reference text from a parameter's ranges, e.g. "Male: 4.5–6.2; Female: 4–5.5". */
export function referenceText(ranges: ReferenceRangeInput[], labels: ReferenceTextLabels): string {
  if (ranges.length === 0) return '—';
  return ranges
    .map((r) => {
      const parts: string[] = [];
      if (r.gender === Gender.MALE) parts.push(`${labels.genderLabel(Gender.MALE)}:`);
      else if (r.gender === Gender.FEMALE) parts.push(`${labels.genderLabel(Gender.FEMALE)}:`);
      const age =
        r.ageMinY !== undefined || r.ageMaxY !== undefined
          ? `(${r.ageMinY ?? 0}–${r.ageMaxY ?? '∞'} ${labels.yearsSuffix}) `
          : '';
      parts.push(`${age}${r.low}–${r.high}`);
      return parts.join(' ');
    })
    .join('; ');
}
