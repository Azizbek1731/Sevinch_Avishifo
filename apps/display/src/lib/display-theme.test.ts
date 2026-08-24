import { describe, expect, it } from 'vitest';
import {
  DAY_ENDS_AT,
  DAY_STARTS_AT,
  isDaytime,
  resolveDisplayTheme,
} from './display-theme';

const at = (hour: number, minute = 0): Date => new Date(2026, 7, 25, hour, minute);

describe('display day/night', () => {
  it('treats the clinic day as day', () => {
    expect(isDaytime(at(DAY_STARTS_AT))).toBe(true);
    expect(isDaytime(at(12))).toBe(true);
    expect(isDaytime(at(DAY_ENDS_AT - 1, 59))).toBe(true);
  });

  it('treats closing time and the small hours as night', () => {
    expect(isDaytime(at(DAY_ENDS_AT))).toBe(false);
    expect(isDaytime(at(23))).toBe(false);
    expect(isDaytime(at(3))).toBe(false);
    expect(isDaytime(at(DAY_STARTS_AT - 1, 59))).toBe(false);
  });

  it('honours a manual choice whatever the clock says', () => {
    expect(resolveDisplayTheme('day', at(2))).toBe('day');
    expect(resolveDisplayTheme('night', at(12))).toBe('night');
  });

  it('follows the clock on auto', () => {
    expect(resolveDisplayTheme('auto', at(9))).toBe('day');
    expect(resolveDisplayTheme('auto', at(22))).toBe('night');
  });

  it('crosses over exactly at the boundary, not an hour either side', () => {
    expect(resolveDisplayTheme('auto', at(DAY_STARTS_AT - 1, 59))).toBe('night');
    expect(resolveDisplayTheme('auto', at(DAY_STARTS_AT, 0))).toBe('day');
    expect(resolveDisplayTheme('auto', at(DAY_ENDS_AT - 1, 59))).toBe('day');
    expect(resolveDisplayTheme('auto', at(DAY_ENDS_AT, 0))).toBe('night');
  });
});
