import { describe, expect, it } from 'vitest';
import {
  formatStatsionarReportDateUz,
  parseStatsionarReportDate,
  tashkentDayBounds,
} from './statsionar-xlsx.helper';

describe('parseStatsionarReportDate', () => {
  it('accepts DD.MM.YYYY and YYYY-MM-DD', () => {
    expect(parseStatsionarReportDate('03.11.2026')).toBe('2026-11-03');
    expect(parseStatsionarReportDate('3/11/2026')).toBe('2026-11-03');
    expect(parseStatsionarReportDate('2026-11-03')).toBe('2026-11-03');
  });

  it('rejects invalid calendar days', () => {
    expect(parseStatsionarReportDate('31.02.2026')).toBeNull();
    expect(parseStatsionarReportDate('not-a-date')).toBeNull();
  });
});

describe('tashkentDayBounds', () => {
  it('uses +05:00 day edges', () => {
    const { start, end } = tashkentDayBounds('2026-11-03');
    expect(start.toISOString()).toBe('2026-11-02T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-03T18:59:59.999Z');
  });
});

describe('formatStatsionarReportDateUz', () => {
  it('formats for captions', () => {
    expect(formatStatsionarReportDateUz('2026-11-03')).toBe('03.11.2026');
  });
});
