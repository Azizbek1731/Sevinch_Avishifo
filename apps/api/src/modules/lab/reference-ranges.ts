import type { Prisma } from '@prisma/client';
import {
  Gender,
  PhysiologicalState,
  referenceRangeSchema,
  type ReferenceRangeInput,
} from '@avishifo/shared';

const isGender = (v: unknown): v is Gender => v === Gender.MALE || v === Gender.FEMALE;
const isState = (v: unknown): v is PhysiologicalState =>
  typeof v === 'string' && Object.values(PhysiologicalState).includes(v as PhysiologicalState);

/**
 * Read a parameter's stored reference intervals.
 *
 * The column is JSON, so rows written by an older build, by a hand-edit, or by a future
 * import all land here. A row that does not parse is DROPPED rather than repaired: an
 * interval we cannot read is one we must not flag a patient against, and a silently
 * half-parsed bound would be worse than no bound at all.
 */
export function parseReferenceRanges(raw: Prisma.JsonValue): ReferenceRangeInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ReferenceRangeInput[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    const num = (k: string): number | undefined =>
      typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : undefined;
    const str = (k: string): string | undefined =>
      typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : undefined;

    const candidate: ReferenceRangeInput = {
      ...(isGender(o['gender']) ? { gender: o['gender'] } : {}),
      ...(isState(o['state']) ? { state: o['state'] } : {}),
      ...(num('ageMinDays') !== undefined ? { ageMinDays: num('ageMinDays') } : {}),
      ...(num('ageMaxDays') !== undefined ? { ageMaxDays: num('ageMaxDays') } : {}),
      ...(num('ageMinY') !== undefined ? { ageMinY: num('ageMinY') } : {}),
      ...(num('ageMaxY') !== undefined ? { ageMaxY: num('ageMaxY') } : {}),
      ...(num('low') !== undefined ? { low: num('low') } : {}),
      ...(num('high') !== undefined ? { high: num('high') } : {}),
      ...(num('criticalLow') !== undefined ? { criticalLow: num('criticalLow') } : {}),
      ...(num('criticalHigh') !== undefined ? { criticalHigh: num('criticalHigh') } : {}),
      ...(str('textNorm') !== undefined ? { textNorm: str('textNorm') } : {}),
      ...(str('label') !== undefined ? { label: str('label') } : {}),
      ...(str('note') !== undefined ? { note: str('note') } : {}),
    };
    const parsed = referenceRangeSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
