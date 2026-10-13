import { describe, expect, it } from 'vitest';
import { addPrescriptionSchema, replacePrescriptionsSchema } from './visit';

describe('rich consultation prescription validation', () => {
  it('preserves legacy dosage and defaults ordinary prescriptions to separate groups', () => {
    expect(addPrescriptionSchema.parse({ drugName: '  Sinov dori  ', dosage: ' 5 ml ' })).toEqual({
      drugName: 'Sinov dori',
      dosage: ' 5 ml ',
      combineWithPrevious: false,
    });
  });

  it('requires real names and bounds new text fields and revision values', () => {
    for (const drugName of ['', '   ', 'x'])
      expect(addPrescriptionSchema.safeParse({ drugName }).success).toBe(false);
    for (const [field, limit] of Object.entries({
      strength: 100,
      form: 100,
      quantity: 100,
      route: 100,
      dripRate: 100,
      durationText: 200,
    }))
      expect(
        addPrescriptionSchema.safeParse({ drugName: 'Dori', [field]: 'x'.repeat(limit + 1) })
          .success,
      ).toBe(false);
    for (const expectedRevision of [-1, 0.5, 2147483647])
      expect(replacePrescriptionsSchema.safeParse({ expectedRevision, items: [] }).success).toBe(
        false,
      );
    expect(
      replacePrescriptionsSchema.safeParse({
        expectedRevision: 0,
        items: Array.from({ length: 41 }, () => ({
          drugName: 'Dori',
          dosage: 'x'.repeat(201),
          frequency: 'x'.repeat(201),
          instructions: 'x'.repeat(2001),
          durationDays: 5000,
        })),
      }).success,
    ).toBe(true);
    expect(
      replacePrescriptionsSchema.safeParse({
        expectedRevision: 0,
        items: [],
        physiotherapy: 'x'.repeat(10001),
      }).success,
    ).toBe(false);
  });

  it('keeps independent directions only on the mixture base', () => {
    const ingredient = { drugName: 'Qo‘shimcha', strength: '1%', combineWithPrevious: true };
    expect(addPrescriptionSchema.safeParse(ingredient).success).toBe(true);
    for (const field of [
      'form',
      'quantity',
      'dosage',
      'route',
      'dripRate',
      'frequency',
      'durationText',
      'instructions',
    ]) {
      expect(
        addPrescriptionSchema.safeParse({ ...ingredient, [field]: 'must not survive' }).success,
      ).toBe(false);
      expect(addPrescriptionSchema.safeParse({ ...ingredient, [field]: ' ' }).success).toBe(true);
    }
    expect(addPrescriptionSchema.safeParse({ ...ingredient, durationDays: 3 }).success).toBe(false);
    expect(
      replacePrescriptionsSchema.safeParse({ expectedRevision: 0, items: [ingredient] }).success,
    ).toBe(false);
    expect(
      replacePrescriptionsSchema.safeParse({
        expectedRevision: 0,
        items: [{ drugName: 'Asos', route: 'test route' }, ingredient],
      }).success,
    ).toBe(true);
  });
});
