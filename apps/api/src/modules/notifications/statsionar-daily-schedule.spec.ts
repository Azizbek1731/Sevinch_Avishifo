import { describe, expect, it } from 'vitest';
import {
  msUntilNextStatsionarReport,
  statsionarReportSlot,
} from './statsionar-daily-schedule';

describe('statsionarReportSlot', () => {
  it('uses today after 16:30 Tashkent', () => {
    // 2026-11-03 16:30 Tashkent = 11:30 UTC
    expect(statsionarReportSlot(new Date('2026-11-03T11:30:00.000Z'))).toBe('2026-11-03');
    expect(statsionarReportSlot(new Date('2026-11-03T12:00:00.000Z'))).toBe('2026-11-03');
  });

  it('uses previous day before 16:30 Tashkent', () => {
    // 2026-11-03 16:29 Tashkent = 11:29 UTC
    expect(statsionarReportSlot(new Date('2026-11-03T11:29:00.000Z'))).toBe('2026-11-02');
  });
});

describe('msUntilNextStatsionarReport', () => {
  it('waits until the next 16:30 after the slot instant', () => {
    // Exactly 16:30 → full day
    expect(msUntilNextStatsionarReport(new Date('2026-11-03T11:30:00.000Z'))).toBe(
      24 * 60 * 60_000,
    );
  });

  it('counts minutes before 16:30', () => {
    // 15:30 Tashkent = 10:30 UTC → 60 minutes
    expect(msUntilNextStatsionarReport(new Date('2026-11-03T10:30:00.000Z'))).toBe(60 * 60_000);
  });
});
