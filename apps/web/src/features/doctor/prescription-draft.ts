import type { AddPrescriptionInput, ReplacePrescriptionsInput } from '@avishifo/shared';
import type { VisitPrescription } from './api';

export interface PrescriptionDraftItem {
  drugName: string;
  drugId?: string;
  strength: string;
  form: string;
  quantity: string;
  dosage: string;
  route: string;
  dripRate: string;
  frequency: string;
  durationText: string;
  durationDays?: number;
  instructions: string;
  combineWithPrevious: boolean;
}
export interface PrescriptionDraft {
  items: PrescriptionDraftItem[];
  physiotherapy: string;
}
export function emptyPrescription(): PrescriptionDraftItem {
  return {
    drugName: '',
    drugId: undefined,
    durationDays: undefined,
    strength: '',
    form: '',
    quantity: '',
    dosage: '',
    route: '',
    dripRate: '',
    frequency: '',
    durationText: '',
    instructions: '',
    combineWithPrevious: false,
  };
}
export function prescriptionDraft(
  items: readonly VisitPrescription[],
  physiotherapy: string | null,
): PrescriptionDraft {
  return {
    items: items.map((item, index) => ({
      ...emptyPrescription(),
      drugName: item.drugName,
      drugId: item.drugId ?? undefined,
      strength: item.strength ?? '',
      form: item.form ?? '',
      quantity: item.quantity ?? '',
      dosage: item.dosage ?? '',
      route: item.route ?? '',
      dripRate: item.dripRate ?? '',
      frequency: item.frequency ?? '',
      durationText: item.durationText ?? '',
      durationDays: item.durationDays ?? undefined,
      instructions: item.instructions ?? '',
      combineWithPrevious: index > 0 && Boolean(item.combineWithPrevious),
    })),
    physiotherapy: physiotherapy ?? '',
  };
}
export function combinePrescription(
  item: PrescriptionDraftItem,
  combined: boolean,
): PrescriptionDraftItem {
  if (!combined) return { ...item, combineWithPrevious: false };
  // Never keep hidden administration values which could reappear after ungrouping.
  return {
    ...emptyPrescription(),
    drugName: item.drugName,
    drugId: item.drugId,
    strength: item.strength,
    combineWithPrevious: true,
  };
}
export function prescriptionGroupRange(
  items: readonly PrescriptionDraftItem[],
  index: number,
): number[] {
  if (!items[index]) return [];
  const indices = [index];
  if (items[index]!.combineWithPrevious) return indices;
  for (let next = index + 1; next < items.length && items[next]!.combineWithPrevious; next++)
    indices.push(next);
  return indices;
}
export function isInfusionPrescription(
  items: readonly PrescriptionDraftItem[],
  index: number,
): boolean {
  const item = items[index];
  return Boolean(
    item &&
    !item.combineWithPrevious &&
    (item.dripRate.trim() ||
      items[index + 1]?.combineWithPrevious ||
      /tomchila|томчила|капельн|infusion|drip|инфуз/i.test(item.route)),
  );
}
const optionalText = (text: string): string | undefined => text.trim() || undefined;
export function serializePrescriptionDraft(
  draft: PrescriptionDraft,
  revision: number,
): ReplacePrescriptionsInput {
  return {
    expectedRevision: revision,
    physiotherapy: draft.physiotherapy.trim(),
    // Keep partial rows: validation should flag a missing name, never silently drop its directions.
    items: draft.items.map((item, index): AddPrescriptionInput => {
      const identity = {
        drugName: item.drugName.trim(),
        drugId: item.drugId,
        strength: optionalText(item.strength),
      };
      if (index > 0 && item.combineWithPrevious) return { ...identity, combineWithPrevious: true };
      return {
        ...identity,
        combineWithPrevious: false,
        form: optionalText(item.form),
        quantity: optionalText(item.quantity),
        dosage: optionalText(item.dosage),
        route: optionalText(item.route),
        dripRate: optionalText(item.dripRate),
        frequency: optionalText(item.frequency),
        durationText: optionalText(item.durationText),
        durationDays: optionalText(item.durationText) ? undefined : item.durationDays,
        instructions: optionalText(item.instructions),
      };
    }),
  };
}
/** A refetch may hydrate only a pristine draft; stale responses after save are ignored. */
export function prescriptionSyncAction(
  loadedRevision: number,
  incomingRevision: number,
  dirty: boolean,
  pending: boolean,
): 'ignore' | 'hydrate' | 'conflict' {
  if (incomingRevision <= loadedRevision) return 'ignore';
  return dirty || pending ? 'conflict' : 'hydrate';
}
