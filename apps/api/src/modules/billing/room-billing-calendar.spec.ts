import { describe, expect, it } from 'vitest';
import { nextRoomBillingDate, roomBillingDate, roomBillingDayCount } from './room-billing-calendar';

describe('room fees use Asia/Tashkent calendar dates', () => {
  it('starts a new day at local midnight, even with only a minute of elapsed time', () => {
    expect(roomBillingDate(new Date('2026-10-14T18:59:59Z'))).toBe('2026-10-14');
    expect(roomBillingDate(new Date('2026-10-14T19:00:00Z'))).toBe('2026-10-15');
    expect(roomBillingDayCount(new Date('2026-10-14T18:59:30Z'), new Date('2026-10-14T19:00:30Z'))).toBe(2);
  });

  it('counts the admission date and discharge date inclusively', () => {
    expect(roomBillingDayCount(new Date('2026-10-14T05:00:00Z'), new Date('2026-10-14T10:00:00Z'))).toBe(1);
    expect(roomBillingDayCount(new Date('2026-10-14T05:00:00Z'), new Date('2026-10-16T05:00:00Z'))).toBe(3);
  });

  it('advances cleanly over month, year and leap-day boundaries', () => {
    expect(nextRoomBillingDate('2026-12-31')).toBe('2027-01-01');
    expect(nextRoomBillingDate('2028-02-28')).toBe('2028-02-29');
    expect(nextRoomBillingDate('2028-02-29')).toBe('2028-03-01');
  });
});
