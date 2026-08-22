import { Gender, LabValueType, PhysiologicalState, ResultFlag } from '../enums';
import type { ReferenceRangeInput } from '../schemas/lab';

/** Days per year/month used everywhere age bounds are converted. */
const DAYS_PER_YEAR = 365;

/** Who the result belongs to, as far as a reference interval is concerned. */
export interface PatientContext {
  gender?: Gender | null;
  /** Age in days at collection time; null when the patient has no date of birth. */
  ageDays?: number | null;
  state?: PhysiologicalState | null;
}

/** Whole days from `dob` to `at`, or null when either is missing. */
export function ageInDays(dob: Date | string | null | undefined, at?: Date): number | null {
  if (!dob) return null;
  const born = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(born.getTime())) return null;
  const ref = at ?? new Date();
  // Compare calendar days in UTC so a clock offset can never shift a newborn's band.
  const a = Date.UTC(born.getUTCFullYear(), born.getUTCMonth(), born.getUTCDate());
  const b = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const days = Math.floor((b - a) / 86_400_000);
  return days < 0 ? null : days;
}

/** Lower age bound in days, accepting rows written before the years→days switch. */
export function rangeAgeMin(r: ReferenceRangeInput): number | undefined {
  if (r.ageMinDays !== undefined) return r.ageMinDays;
  if (r.ageMinY !== undefined) return Math.round(r.ageMinY * DAYS_PER_YEAR);
  return undefined;
}

/** Upper age bound in days (exclusive). Legacy `ageMaxY` was inclusive, so it gains a year. */
export function rangeAgeMax(r: ReferenceRangeInput): number | undefined {
  if (r.ageMaxDays !== undefined) return r.ageMaxDays;
  if (r.ageMaxY !== undefined) return Math.round((r.ageMaxY + 1) * DAYS_PER_YEAR);
  return undefined;
}

const PREGNANCY_STATES: readonly PhysiologicalState[] = [
  PhysiologicalState.PREGNANCY,
  PhysiologicalState.PREGNANCY_T1,
  PhysiologicalState.PREGNANCY_T2,
  PhysiologicalState.PREGNANCY_T3,
];

export function isPregnancy(state: PhysiologicalState | null | undefined): boolean {
  return state !== null && state !== undefined && PREGNANCY_STATES.includes(state);
}

/** Does a range's physiological qualifier apply to this patient? */
function stateApplies(r: ReferenceRangeInput, ctx: PatientContext): boolean {
  if (r.state === undefined) return true; // unqualified rows apply to everyone
  if (r.state === ctx.state) return true;
  // A generic "pregnancy" interval still applies when a trimester is known, so a
  // catalogue that only gives the coarse interval is not silently skipped.
  return r.state === PhysiologicalState.PREGNANCY && isPregnancy(ctx.state);
}

function matches(r: ReferenceRangeInput, ctx: PatientContext): boolean {
  if (r.gender !== undefined && r.gender !== ctx.gender) return false;
  const min = rangeAgeMin(r);
  const max = rangeAgeMax(r);
  const age = ctx.ageDays ?? null;
  // An age-bounded interval cannot be claimed for a patient whose age is unknown:
  // guessing would attach a newborn's haemoglobin band to an adult.
  if (min !== undefined && (age === null || age < min)) return false;
  if (max !== undefined && (age === null || age >= max)) return false;
  return stateApplies(r, ctx);
}

/**
 * How specific a matching interval is. The physiological state outranks everything:
 * when a woman is in her second trimester, the trimester interval is the right answer
 * even though the plain adult-female one also matches.
 */
function specificity(r: ReferenceRangeInput): number {
  const min = rangeAgeMin(r);
  const max = rangeAgeMax(r);
  // "From 0 days, no upper bound" excludes nobody, so it must not outrank a plain adult
  // interval — otherwise a row labelled "newborns" whose upper age the source never gave
  // would claim every patient in the clinic.
  const qualifiers = (r.state !== undefined ? 4 : 0) + (r.gender !== undefined ? 2 : 0);
  // "From day 0, no ceiling" excludes nobody, so despite its paediatric label the row is
  // no more specific than a plain adult interval. Scoring it merely EQUAL is not enough:
  // catalogues list age bands youngest first, so a tie would hand every adult the newborn
  // band by array order alone. It is scored strictly below an honestly unqualified row,
  // which still leaves it selectable when it is the only interval there is.
  if (max === undefined && (min === undefined || min === 0)) {
    return qualifiers + (min === 0 ? -1 : 0);
  }
  return qualifiers + (min !== undefined ? 1 : 0) + (max !== undefined ? 1 : 0);
}

/** The interval that applies to this patient, or null when none does. */
export function matchReferenceRange(
  ranges: readonly ReferenceRangeInput[],
  ctx: PatientContext,
): ReferenceRangeInput | null {
  let best: ReferenceRangeInput | null = null;
  // Below every possible score, so even a demoted row is chosen when it is the only match.
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const r of ranges) {
    if (!matches(r, ctx)) continue;
    const score = specificity(r);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** Parse an entered value the way a lab tech types it ("4,5", " 12.3 ", "<0.5"). */
export function parseNumericValue(value: string): number | null {
  const cleaned = value.trim().replace(',', '.').replace(/^[<>≤≥]=?\s*/, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Flag one entered value against its interval.
 *
 * Critical bounds are tested first: a panic value is still a panic value when it also
 * happens to be merely high. Qualitative parameters are never auto-flagged — the norm is
 * free text in whichever language the tech types, and a guessed "abnormal" on a normal
 * smear is worse than no flag at all. Their expected wording is shown beside the field.
 */
export function computeResultFlag(
  value: string,
  range: ReferenceRangeInput | null,
  valueType: LabValueType = LabValueType.NUMERIC,
): ResultFlag {
  if (valueType !== LabValueType.NUMERIC) return ResultFlag.NORMAL;
  const n = parseNumericValue(value);
  if (n === null || !range) return ResultFlag.NORMAL;
  // A panic threshold that falls INSIDE this interval's own normal band cannot be right
  // for this patient and is ignored. The catalogue states one critical pair per analyte,
  // taken from adult practice, while some age bands legitimately run past it — newborn
  // haemoglobin is 145-225 g/L against a critical line of 200 — and applied literally
  // every healthy newborn would be reported as a panic value. Faithful data, safe rule.
  const criticalHigh =
    range.criticalHigh !== undefined &&
    (range.high === undefined || range.criticalHigh >= range.high)
      ? range.criticalHigh
      : undefined;
  const criticalLow =
    range.criticalLow !== undefined &&
    (range.low === undefined || range.criticalLow <= range.low)
      ? range.criticalLow
      : undefined;
  if (criticalLow !== undefined && n < criticalLow) return ResultFlag.CRITICAL_LOW;
  if (criticalHigh !== undefined && n > criticalHigh) return ResultFlag.CRITICAL_HIGH;
  if (range.low !== undefined && n < range.low) return ResultFlag.LOW;
  if (range.high !== undefined && n > range.high) return ResultFlag.HIGH;
  return ResultFlag.NORMAL;
}

/** Convenience: match then flag, in one call. */
export function flagValue(
  value: string,
  ranges: readonly ReferenceRangeInput[],
  ctx: PatientContext,
  valueType: LabValueType = LabValueType.NUMERIC,
): { flag: ResultFlag; range: ReferenceRangeInput | null } {
  const range = matchReferenceRange(ranges, ctx);
  return { flag: computeResultFlag(value, range, valueType), range };
}

/** "4.0–9.0", "< 0.15", "> 1.018", or the qualitative wording. */
export function formatRangeBounds(r: ReferenceRangeInput): string {
  if (r.low !== undefined && r.high !== undefined) return `${r.low}–${r.high}`;
  if (r.high !== undefined) return `< ${r.high}`;
  if (r.low !== undefined) return `> ${r.low}`;
  return r.textNorm ?? '—';
}
