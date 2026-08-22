import {
  ResultFlag,
  formatRangeBounds,
  type Gender,
  type LocalizedNameInput,
  type PhysiologicalState,
  type ReferenceRangeInput,
} from '@avishifo/shared';

export type UiLocale = 'uz' | 'ru' | 'en';

/** Pick the localized variant of a {uz, ru?, en?} name (uz is first-class fallback). */
export function localizedName(name: LocalizedNameInput, locale: UiLocale): string {
  if (locale === 'ru' && name.ru) return name.ru;
  if (locale === 'en' && name.en) return name.en;
  return name.uz;
}

/** Short marker beside a value: H/L for out of range, !! for a panic value. */
export function flagMark(flag: ResultFlag): string {
  switch (flag) {
    case ResultFlag.HIGH:
      return 'H';
    case ResultFlag.LOW:
      return 'L';
    case ResultFlag.CRITICAL_HIGH:
      return 'H!!';
    case ResultFlag.CRITICAL_LOW:
      return 'L!!';
    case ResultFlag.ABNORMAL:
      return 'A';
    default:
      return '';
  }
}

/** Colour for a result flag. A panic value is bold — it must not read like a mild high. */
export function flagClass(flag: ResultFlag): string {
  switch (flag) {
    case ResultFlag.CRITICAL_HIGH:
    case ResultFlag.CRITICAL_LOW:
      return 'font-bold text-destructive';
    case ResultFlag.HIGH:
    case ResultFlag.ABNORMAL:
      return 'text-destructive';
    case ResultFlag.LOW:
      return 'text-primary';
    default:
      return '';
  }
}

export function isCriticalFlag(flag: ResultFlag): boolean {
  return flag === ResultFlag.CRITICAL_HIGH || flag === ResultFlag.CRITICAL_LOW;
}

/** Localized labels for {@link referenceText}; pass translated values from the caller. */
export interface ReferenceTextLabels {
  genderLabel: (gender: Gender) => string;
  stateLabel: (state: PhysiologicalState) => string;
  /** Suffix after an age range, e.g. localized "y" (years). */
  yearsSuffix: string;
  /** Suffix for an age range given in days, e.g. localized "d". */
  daysSuffix: string;
  /** Suffix for an age range given in months, e.g. localized "mo". */
  monthsSuffix: string;
}

/** A day count as the shortest unit that stays exact: 14 d, 6 mo, 18 y. */
function ageText(days: number, labels: ReferenceTextLabels): string {
  if (days === 0) return `0`;
  if (days % 365 === 0) return `${days / 365}${labels.yearsSuffix}`;
  if (days % 30 === 0) return `${days / 30}${labels.monthsSuffix}`;
  return `${days}${labels.daysSuffix}`;
}

/** "4.0–9.0" for one interval, with its qualifiers when it has any. */
export function rangeText(r: ReferenceRangeInput, labels: ReferenceTextLabels): string {
  const parts: string[] = [];
  if (r.gender) parts.push(labels.genderLabel(r.gender));
  if (r.state) parts.push(labels.stateLabel(r.state));

  const min = r.ageMinDays ?? (r.ageMinY !== undefined ? r.ageMinY * 365 : undefined);
  const max = r.ageMaxDays ?? (r.ageMaxY !== undefined ? (r.ageMaxY + 1) * 365 : undefined);
  if (min !== undefined || max !== undefined) {
    const from = min !== undefined ? ageText(min, labels) : '0';
    const to = max !== undefined ? ageText(max, labels) : '∞';
    parts.push(`${from}–${to}`);
  }
  const bounds = formatRangeBounds(r);
  return parts.length > 0 ? `${parts.join(' ')}: ${bounds}` : bounds;
}

/** Human reference text from a parameter's intervals, one line per interval. */
export function referenceText(
  ranges: readonly ReferenceRangeInput[],
  labels: ReferenceTextLabels,
): string {
  if (ranges.length === 0) return '—';
  return ranges.map((r) => rangeText(r, labels)).join('; ');
}
