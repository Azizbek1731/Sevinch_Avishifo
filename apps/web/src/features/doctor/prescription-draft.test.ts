import { describe, expect, it } from 'vitest';
import { replacePrescriptionsSchema } from '@avishifo/shared';
import type { VisitPrescription } from './api';
import {
  combinePrescription,
  emptyPrescription,
  isInfusionPrescription,
  prescriptionDraft,
  prescriptionGroupRange,
  prescriptionSyncAction,
  serializePrescriptionDraft,
} from './prescription-draft';

const stored = (patch: Partial<VisitPrescription> = {}): VisitPrescription => ({
  id: 'rx',
  drugName: 'Stored medicine',
  drugId: null,
  dosage: 'original dose',
  frequency: 'original frequency',
  durationDays: 7,
  instructions: 'original instructions',
  strength: null,
  form: null,
  quantity: null,
  route: null,
  dripRate: null,
  durationText: null,
  combineWithPrevious: false,
  sortOrder: 0,
  createdAt: null,
  drug: null,
  ...patch,
});
const draft = (name: string, combined = false) => ({
  ...emptyPrescription(),
  drugName: name,
  combineWithPrevious: combined,
});

describe('prescription draft serialization', () => {
  it('preserves legacy prescriptions beyond new-editor addition limits', () => {
    const previous = Array.from({ length: 45 }, (_, index) =>
      stored({
        id: String(index),
        drugName: 'N'.repeat(400),
        dosage: 'D'.repeat(400),
        frequency: 'F'.repeat(400),
        instructions: 'I'.repeat(4000),
        durationDays: 5000,
      }),
    );
    const payload = serializePrescriptionDraft(prescriptionDraft(previous, 'Previous physio'), 9);
    expect(payload.items).toHaveLength(45);
    expect(payload.items[0]).toMatchObject({
      drugName: previous[0]!.drugName,
      dosage: previous[0]!.dosage,
      frequency: previous[0]!.frequency,
      instructions: previous[0]!.instructions,
      durationDays: 5000,
    });
    expect(payload.items[0]?.durationText).toBeUndefined();
    expect(payload.expectedRevision).toBe(9);
    expect(replacePrescriptionsSchema.safeParse(payload).success).toBe(true);
  });

  it('replaces legacy duration only after a doctor enters free-text duration', () => {
    const values = prescriptionDraft([stored()], null);
    values.items[0]!.durationText = 'custom duration';
    expect(serializePrescriptionDraft(values, 0).items[0]).toMatchObject({
      durationText: 'custom duration',
      durationDays: undefined,
    });
  });

  it('strips independent fields from combined children before strict API validation', () => {
    const values = prescriptionDraft(
      [
        stored(),
        stored({
          drugName: 'Ingredient',
          combineWithPrevious: true,
          strength: 'entered strength',
          form: 'stale form',
          quantity: 'stale quantity',
          route: 'stale route',
          dripRate: 'stale drip',
        }),
      ],
      null,
    );
    const payload = serializePrescriptionDraft(values, 0);
    expect(payload.items[1]).toEqual({
      drugName: 'Ingredient',
      drugId: undefined,
      strength: 'entered strength',
      combineWithPrevious: true,
    });
    expect(replacePrescriptionsSchema.safeParse(payload).success).toBe(true);
  });

  it('does not restore cleared administration fields when an ingredient is detached', () => {
    const original = prescriptionDraft([stored()], null).items[0]!;
    // The editor applies changes as a patch, so clears must be explicit.
    const grouped = { ...original, ...combinePrescription(original, true) };
    const detached = combinePrescription(grouped, false);
    expect(detached.durationDays).toBeUndefined();
    expect(detached.dosage).toBe('');
    expect(detached.frequency).toBe('');
    expect(detached.instructions).toBe('');
    expect(detached.drugName).toBe(original.drugName);
  });

  it.each(['v/i', 'в/в', ''])(
    'preserves an existing drip rate with an unclassified route %j',
    (route) => {
      const values = prescriptionDraft(
        [stored({ route, dripRate: 'recorded rate' })],
        'Only physiotherapy changed',
      );
      expect(isInfusionPrescription(values.items, 0)).toBe(true);
      expect(serializePrescriptionDraft(values, 0).items[0]?.dripRate).toBe('recorded rate');
    },
  );

  it('keeps the base drip rate after the last ingredient is removed', () => {
    const values = prescriptionDraft(
      [
        stored({ dripRate: 'recorded rate' }),
        stored({ drugName: 'Ingredient', combineWithPrevious: true }),
      ],
      null,
    );
    values.items.splice(1, 1);
    expect(isInfusionPrescription(values.items, 0)).toBe(true);
    expect(serializePrescriptionDraft(values, 0).items[0]?.dripRate).toBe('recorded rate');
    values.items[0]!.dripRate = '';
    expect(serializePrescriptionDraft(values, 0).items[0]?.dripRate).toBeUndefined();
  });

  it('keeps partially filled unnamed rows for validation instead of losing entered directions', () => {
    const values = {
      items: [{ ...emptyPrescription(), dosage: 'entered instructions' }],
      physiotherapy: '',
    };
    const payload = serializePrescriptionDraft(values, 0);
    expect(payload.items).toHaveLength(1);
    expect(replacePrescriptionsSchema.safeParse(payload).success).toBe(false);
  });
});

describe('prescription group and revision lifecycle', () => {
  it('removes the entire base group without attaching its children to another drug', () => {
    const items = [
      draft('First base'),
      draft('Second base'),
      draft('Ingredient one', true),
      draft('Ingredient two', true),
      draft('Last base'),
    ];
    expect(prescriptionGroupRange(items, 1)).toEqual([1, 2, 3]);
    const remaining = items.filter((_, index) => !prescriptionGroupRange(items, 1).includes(index));
    expect(remaining.map((item) => item.drugName)).toEqual(['First base', 'Last base']);
    expect(remaining.every((item) => !item.combineWithPrevious)).toBe(true);
    expect(prescriptionGroupRange(items, 2)).toEqual([2]);
  });

  it('never hydrates over unsaved or in-flight edits, and ignores stale responses after saving', () => {
    expect(prescriptionSyncAction(2, 3, true, false)).toBe('conflict');
    expect(prescriptionSyncAction(2, 3, false, true)).toBe('conflict');
    expect(prescriptionSyncAction(2, 3, false, false)).toBe('hydrate');
    expect(prescriptionSyncAction(3, 2, false, false)).toBe('ignore');
    expect(prescriptionSyncAction(3, 3, true, false)).toBe('ignore');
  });
});
