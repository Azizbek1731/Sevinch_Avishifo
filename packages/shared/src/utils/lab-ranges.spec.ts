import { describe, expect, it } from 'vitest';
import { Gender, LabValueType, PhysiologicalState, ResultFlag } from '../enums';
import type { ReferenceRangeInput } from '../schemas/lab';
import { ageInDays, computeResultFlag, flagValue, matchReferenceRange } from './lab-ranges';

/**
 * The reference-interval matcher and the auto-flagger.
 *
 * This is the one place in the product where a number becomes a clinical
 * statement, so the cases below are the ones where picking the wrong interval
 * would put a wrong word — "high", "normal" — next to a right number: a
 * newborn's haemoglobin band on an adult, a non-pregnant TSH band on a woman in
 * her second trimester, a cycle-phase band on a patient whose cycle nobody
 * recorded.
 */

const YEARS = (y: number): number => Math.round(y * 365);

// ------------------------------------------------------------------ matching

describe('matchReferenceRange', () => {
  it('falls back to the plain adult interval when nothing more specific matches', () => {
    const ranges: ReferenceRangeInput[] = [
      { gender: Gender.FEMALE, low: 120, high: 150, label: 'women' },
      { low: 130, high: 160, label: 'adults' },
    ];
    // A male patient: the female row is out, the unqualified row is all that is left.
    expect(matchReferenceRange(ranges, { gender: Gender.MALE, ageDays: YEARS(40) })?.label).toBe(
      'adults',
    );
  });

  it('returns null when no interval covers the patient at all', () => {
    const ranges: ReferenceRangeInput[] = [{ gender: Gender.FEMALE, low: 120, high: 150 }];
    expect(matchReferenceRange(ranges, { gender: Gender.MALE, ageDays: YEARS(40) })).toBeNull();
  });

  it('prefers the sex-specific interval over the unqualified one', () => {
    const ranges: ReferenceRangeInput[] = [
      { low: 130, high: 160, label: 'adults' },
      { gender: Gender.FEMALE, low: 120, high: 150, label: 'women' },
    ];
    expect(matchReferenceRange(ranges, { gender: Gender.FEMALE, ageDays: YEARS(40) })?.label).toBe(
      'women',
    );
    // Order in the array must not decide it — the qualifier does.
    expect(
      matchReferenceRange([...ranges].reverse(), { gender: Gender.FEMALE, ageDays: YEARS(40) })
        ?.label,
    ).toBe('women');
  });

  // Age bands are in DAYS because a newborn's haemoglobin band changes inside the
  // first week of life, which whole years cannot express at all.
  describe('age bands in days', () => {
    const ranges: ReferenceRangeInput[] = [
      { ageMinDays: 0, ageMaxDays: 3, low: 145, high: 225, label: 'newborn 1-3d' },
      { ageMinDays: 3, ageMaxDays: 30, low: 135, high: 215, label: 'newborn 3-30d' },
      { ageMinDays: 30, ageMaxDays: 365, low: 100, high: 140, label: 'infant 1-12m' },
      { ageMinDays: 6570, low: 130, high: 160, label: 'adult' },
    ];

    it('selects the newborn interval on day 1', () => {
      expect(matchReferenceRange(ranges, { ageDays: 1 })?.label).toBe('newborn 1-3d');
    });

    it('selects the infant interval at 6 months', () => {
      expect(matchReferenceRange(ranges, { ageDays: 182 })?.label).toBe('infant 1-12m');
    });

    it('treats the upper age bound as EXCLUSIVE', () => {
      // A baby exactly 3 days old belongs to the NEXT band, not the one that
      // names 3 as its ceiling. Getting this backwards double-claims every
      // boundary day and makes two intervals fight over the same patient.
      expect(matchReferenceRange(ranges, { ageDays: 2 })?.label).toBe('newborn 1-3d');
      expect(matchReferenceRange(ranges, { ageDays: 3 })?.label).toBe('newborn 3-30d');
      expect(matchReferenceRange(ranges, { ageDays: 29 })?.label).toBe('newborn 3-30d');
      expect(matchReferenceRange(ranges, { ageDays: 30 })?.label).toBe('infant 1-12m');
    });

    it('leaves an age gap unmatched rather than guessing the nearest band', () => {
      // 365 days .. 6570 days is not covered above; the caller must be able to
      // tell "no norm for this age" from "normal".
      expect(matchReferenceRange(ranges, { ageDays: YEARS(8) })).toBeNull();
    });
  });

  describe('physiological state', () => {
    const adultFemale: ReferenceRangeInput = {
      gender: Gender.FEMALE,
      ageMinDays: 6570,
      ageMaxDays: 23725,
      low: 0.4,
      high: 4,
      label: 'adult women',
    };

    it('prefers a trimester interval over the plain adult-female one', () => {
      const ranges: ReferenceRangeInput[] = [
        adultFemale,
        {
          gender: Gender.FEMALE,
          state: PhysiologicalState.PREGNANCY_T2,
          low: 0.2,
          high: 3,
          label: 'pregnancy T2',
        },
      ];
      const ctx = {
        gender: Gender.FEMALE,
        ageDays: YEARS(30),
        state: PhysiologicalState.PREGNANCY_T2,
      };
      expect(matchReferenceRange(ranges, ctx)?.label).toBe('pregnancy T2');
      // The age-bounded adult row scores on two bounds; the state must still win.
      expect(matchReferenceRange([...ranges].reverse(), ctx)?.label).toBe('pregnancy T2');
    });

    it('still matches a generic PREGNANCY interval when the order names a trimester', () => {
      // A catalogue that only carries the coarse pregnancy interval must not be
      // silently skipped just because the desk recorded which trimester it is.
      const ranges: ReferenceRangeInput[] = [
        adultFemale,
        {
          gender: Gender.FEMALE,
          state: PhysiologicalState.PREGNANCY,
          low: 0.1,
          high: 3.5,
          label: 'pregnancy',
        },
      ];
      for (const state of [
        PhysiologicalState.PREGNANCY,
        PhysiologicalState.PREGNANCY_T1,
        PhysiologicalState.PREGNANCY_T2,
        PhysiologicalState.PREGNANCY_T3,
      ]) {
        expect(
          matchReferenceRange(ranges, { gender: Gender.FEMALE, ageDays: YEARS(30), state })?.label,
        ).toBe('pregnancy');
      }
    });

    it('does not read a trimester interval as covering a non-pregnant patient', () => {
      const ranges: ReferenceRangeInput[] = [
        adultFemale,
        {
          gender: Gender.FEMALE,
          state: PhysiologicalState.PREGNANCY_T2,
          low: 0.2,
          high: 3,
          label: 'pregnancy T2',
        },
      ];
      expect(
        matchReferenceRange(ranges, { gender: Gender.FEMALE, ageDays: YEARS(30) })?.label,
      ).toBe('adult women');
    });

    it('skips a cycle-phase interval when the order carries no state', () => {
      // Nobody wrote down where in her cycle the specimen was drawn, so a luteal
      // band is a guess — and a guessed band is a guessed flag.
      const ranges: ReferenceRangeInput[] = [
        { gender: Gender.FEMALE, state: PhysiologicalState.LUTEAL, low: 5, high: 25, label: 'luteal' },
        { gender: Gender.FEMALE, state: PhysiologicalState.FOLLICULAR, low: 1, high: 12, label: 'follicular' },
      ];
      expect(matchReferenceRange(ranges, { gender: Gender.FEMALE, ageDays: YEARS(30) })).toBeNull();
      expect(
        matchReferenceRange(ranges, {
          gender: Gender.FEMALE,
          ageDays: YEARS(30),
          state: PhysiologicalState.LUTEAL,
        })?.label,
      ).toBe('luteal');
    });
  });

  it('matches only age-free intervals for a patient with no date of birth', () => {
    const ranges: ReferenceRangeInput[] = [
      { ageMinDays: 0, ageMaxDays: 30, low: 145, high: 225, label: 'newborn' },
      { ageMinDays: 6570, low: 130, high: 160, label: 'adult (age-bounded)' },
      { gender: Gender.MALE, low: 128, high: 162, label: 'men (no age bounds)' },
    ];
    // ageDays null: an age-bounded interval cannot be claimed for an unknown age.
    expect(matchReferenceRange(ranges, { gender: Gender.MALE, ageDays: null })?.label).toBe(
      'men (no age bounds)',
    );
    expect(
      matchReferenceRange(ranges.slice(0, 2), { gender: Gender.MALE, ageDays: null }),
    ).toBeNull();
  });

  it('does not let an unbounded "from 0 days" row outrank the plain adult interval', () => {
    // A real catalogue defect: a row labelled "newborns" whose upper age the
    // source never gave. From 0 days with no ceiling it excludes nobody, so it
    // must never beat the adult interval for a 35-year-old — and catalogues list
    // the newborn row FIRST, youngest band up, which is the case that bites.
    const ranges: ReferenceRangeInput[] = [
      { ageMinDays: 0, low: 145, high: 225, label: 'newborns (no upper bound)' },
      { low: 130, high: 160, label: 'adults' },
    ];
    const ctx = { gender: Gender.MALE, ageDays: YEARS(35) };
    expect(matchReferenceRange(ranges, ctx)?.label).toBe('adults');
    expect(matchReferenceRange([...ranges].reverse(), ctx)?.label).toBe('adults');
  });

  describe('legacy years-based bounds', () => {
    const ranges: ReferenceRangeInput[] = [
      { ageMinY: 0, ageMaxY: 17, low: 1, high: 2, label: 'children' },
      { ageMinY: 18, ageMaxY: 65, low: 3, high: 4, label: 'adults' },
      { ageMinY: 66, low: 5, high: 6, label: 'seniors' },
    ];

    it('resolves rows written before the years to days switch', () => {
      expect(matchReferenceRange(ranges, { ageDays: YEARS(10) })?.label).toBe('children');
      expect(matchReferenceRange(ranges, { ageDays: YEARS(18) })?.label).toBe('adults');
      expect(matchReferenceRange(ranges, { ageDays: YEARS(70) })?.label).toBe('seniors');
    });

    it('treats the legacy ageMaxY as INCLUSIVE', () => {
      // "18-65 лет" in the source means through the patient's 65th year, so a
      // patient on their 65th birthday — and the day before their 66th — is
      // still an adult, not a senior.
      expect(matchReferenceRange(ranges, { ageDays: YEARS(65) })?.label).toBe('adults');
      expect(matchReferenceRange(ranges, { ageDays: YEARS(66) - 1 })?.label).toBe('adults');
      expect(matchReferenceRange(ranges, { ageDays: YEARS(66) })?.label).toBe('seniors');
    });
  });
});

// ------------------------------------------------------------------ flagging

describe('computeResultFlag', () => {
  const range: ReferenceRangeInput = {
    low: 4,
    high: 9,
    criticalLow: 1.5,
    criticalHigh: 30,
  };

  it('flags LOW, NORMAL and HIGH against the interval', () => {
    expect(computeResultFlag('3.9', range)).toBe(ResultFlag.LOW);
    expect(computeResultFlag('4', range)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('6.5', range)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('9', range)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('9.1', range)).toBe(ResultFlag.HIGH);
  });

  it('lets a panic value win over a merely abnormal one', () => {
    // A critical value is still critical when it is also, trivially, "low".
    expect(computeResultFlag('1.4', range)).toBe(ResultFlag.CRITICAL_LOW);
    expect(computeResultFlag('30.1', range)).toBe(ResultFlag.CRITICAL_HIGH);
    // The panic threshold itself is inside the norm; only past it does it fire.
    expect(computeResultFlag('1.5', range)).toBe(ResultFlag.LOW);
    expect(computeResultFlag('30', range)).toBe(ResultFlag.HIGH);
  });

  it('never invents the missing side of a one-sided interval', () => {
    // "< 0.15 g/24h" has no floor: no amount of protein-free urine is LOW.
    const upperOnly: ReferenceRangeInput = { high: 0.15 };
    expect(computeResultFlag('0', upperOnly)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('0.14', upperOnly)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('0.16', upperOnly)).toBe(ResultFlag.HIGH);

    // "> 1.018" has no ceiling.
    const lowerOnly: ReferenceRangeInput = { low: 1.018 };
    expect(computeResultFlag('1.05', lowerOnly)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('999', lowerOnly)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('1.010', lowerOnly)).toBe(ResultFlag.LOW);
  });

  it('never auto-flags a qualitative parameter', () => {
    // The norm is free text in whichever language the tech types; a guessed
    // "abnormal" on a normal smear is worse than no flag at all.
    const textRange: ReferenceRangeInput = { textNorm: 'Отрицательно', low: 4, high: 9 };
    expect(computeResultFlag('Положительно', textRange, LabValueType.TEXT)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('99', textRange, LabValueType.TEXT)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('99', textRange, LabValueType.ENUM)).toBe(ResultFlag.NORMAL);
    // Same number, same interval, NUMERIC — that one does flag.
    expect(computeResultFlag('99', textRange, LabValueType.NUMERIC)).toBe(ResultFlag.HIGH);
  });

  it('reads a comma decimal the way the tech typed it', () => {
    // Uzbek and Russian keyboards produce "4,5"; it must not silently become NaN
    // and land on the report as NORMAL.
    expect(computeResultFlag('4,5', range)).toBe(computeResultFlag('4.5', range));
    expect(computeResultFlag('3,9', range)).toBe(ResultFlag.LOW);
    expect(computeResultFlag('9,1', range)).toBe(ResultFlag.HIGH);
    expect(computeResultFlag(' 12,3 ', range)).toBe(ResultFlag.HIGH);
  });

  it('stays NORMAL when there is nothing to compare against', () => {
    expect(computeResultFlag('7', null)).toBe(ResultFlag.NORMAL);
    expect(computeResultFlag('nima ekan', range)).toBe(ResultFlag.NORMAL);
  });
});

describe('flagValue', () => {
  it('matches then flags, and hands back the interval it used', () => {
    const ranges: ReferenceRangeInput[] = [
      { gender: Gender.FEMALE, ageMinDays: 6570, low: 0.4, high: 4, label: 'adult women' },
      {
        gender: Gender.FEMALE,
        state: PhysiologicalState.PREGNANCY_T2,
        low: 0.2,
        high: 3,
        label: 'pregnancy T2',
      },
    ];
    const woman = { gender: Gender.FEMALE, ageDays: YEARS(30) };

    // 4.2 µIU/mL: high for a non-pregnant woman, and the interval quoted beside
    // it on the report has to be the one the flag actually came from.
    const plain = flagValue('4.2', ranges, woman);
    expect(plain.flag).toBe(ResultFlag.HIGH);
    expect(plain.range?.label).toBe('adult women');

    // 0.3 µIU/mL is the same number read two ways: below the non-pregnant floor,
    // comfortably inside the second-trimester one.
    expect(flagValue('0.3', ranges, woman).flag).toBe(ResultFlag.LOW);
    const pregnant = flagValue('0.3', ranges, {
      ...woman,
      state: PhysiologicalState.PREGNANCY_T2,
    });
    expect(pregnant.flag).toBe(ResultFlag.NORMAL);
    expect(pregnant.range?.label).toBe('pregnancy T2');

    // And 3.5 runs the other way.
    expect(flagValue('3.5', ranges, woman).flag).toBe(ResultFlag.NORMAL);
    expect(
      flagValue('3.5', ranges, { ...woman, state: PhysiologicalState.PREGNANCY_T2 }).flag,
    ).toBe(ResultFlag.HIGH);
  });
});

// ------------------------------------------------------------------- ageInDays

describe('ageInDays', () => {
  it('counts whole calendar days in UTC', () => {
    expect(ageInDays('2026-08-20', new Date('2026-08-21T00:30:00Z'))).toBe(1);
    // A clock offset inside the same calendar day must not age a newborn.
    expect(ageInDays('2026-08-20', new Date('2026-08-20T23:59:00Z'))).toBe(0);
    expect(ageInDays('2025-08-22', new Date('2026-08-22T09:00:00Z'))).toBe(365);
  });

  it('is null when the patient has no usable date of birth', () => {
    expect(ageInDays(null)).toBeNull();
    expect(ageInDays(undefined)).toBeNull();
    expect(ageInDays('not a date')).toBeNull();
    // A dob in the future is not an age.
    expect(ageInDays('2030-01-01', new Date('2026-08-22T00:00:00Z'))).toBeNull();
  });
});
