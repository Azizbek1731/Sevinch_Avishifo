import { describe, expect, it } from 'vitest';
import { formatPrescriptionGroup, groupPrescriptionItems } from './prescriptions';

const labels = { days: (count: number) => `${count} kun`, dripUnit: 'tomchi/daqiqa' };

describe('prescription groups', () => {
  it('keeps row order, starts an orphaned combined item safely and does not mutate inputs', () => {
    const items = [
      { drugName: 'First', combineWithPrevious: true },
      { drugName: 'Additive', combineWithPrevious: true },
      { drugName: 'Separate', combineWithPrevious: false },
    ];
    expect(groupPrescriptionItems(items)).toEqual([[items[0], items[1]], [items[2]]]);
    expect(items).toHaveLength(3);
    expect(groupPrescriptionItems([])).toEqual([]);
  });

  it('preserves a legacy dosage as instructions without inventing strength or Latin names', () => {
    expect(
      formatPrescriptionGroup(
        [
          {
            drugName: 'Аспирин',
            dosage: '1 tabletka',
            frequency: 'kuniga 2 mahal',
            durationDays: 5,
            instructions: 'Ovqatdan keyin',
          },
        ],
        labels,
      ),
    ).toEqual({
      components: ['Аспирин'],
      dtd: '',
      mixed: false,
      signature: '1 tabletka, kuniga 2 mahal, 5 kun, Ovqatdan keyin',
    });
  });

  it('formats a mixture using only its base directions and preferred free-text duration', () => {
    expect(
      formatPrescriptionGroup(
        [
          {
            drugName: 'Sol. Natrii chloridi',
            strength: '0,9% — 200 ml',
            quantity: 'N. 5',
            form: 'flac.',
            dosage: '200 ml',
            route: 'v/i',
            dripRate: '30',
            frequency: 'kuniga 1 marta',
            durationDays: 5,
            durationText: '3–5 kun',
            instructions: 'Shifokor nazoratida',
          },
          {
            drugName: 'Sol. Acidi ascorbinici',
            strength: '5% — 2 ml',
            combineWithPrevious: true,
            dosage: 'CHILD DOSE',
            frequency: 'CHILD FREQUENCY',
            quantity: '99',
            form: 'CHILD FORM',
            route: 'CHILD ROUTE',
            durationText: 'CHILD DURATION',
            dripRate: '99',
            instructions: 'CHILD NOTE',
          },
        ],
        labels,
      ),
    ).toEqual({
      components: ['Sol. Natrii chloridi 0,9% — 200 ml', 'Sol. Acidi ascorbinici 5% — 2 ml'],
      dtd: 'M. D.t.d. N. 5 in flac.',
      mixed: true,
      signature: '200 ml, v/i, 30 tomchi/daqiqa, kuniga 1 marta, 3–5 kun, Shifokor nazoratida',
    });
  });

  it('supports mixtures without dispensing fields and an empty group', () => {
    expect(formatPrescriptionGroup([{ drugName: 'A' }, { drugName: 'B' }], labels).dtd).toBe(
      'M. D.',
    );
    expect(formatPrescriptionGroup([], labels)).toEqual({
      components: [],
      dtd: '',
      signature: '',
      mixed: false,
    });
  });
});
