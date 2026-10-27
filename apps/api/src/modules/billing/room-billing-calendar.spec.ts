import { describe, expect, it } from 'vitest';
import {
  dueRoomPeriodStarts,
  nextRoomBillingDate,
  nextRoomPeriodAt,
  roomBillingDate,
  roomBillingDayCount,
} from './room-billing-calendar';

describe('room fees use rolling 24h periods from admission', () => {
  it('labels periods with Asia/Tashkent calendar dates', () => {
    expect(roomBillingDate(new Date('2026-10-14T18:59:59Z'))).toBe('2026-10-14');
    expect(roomBillingDate(new Date('2026-10-14T19:00:00Z'))).toBe('2026-10-15');
  });

  it('counts full 24h blocks from the admission instant', () => {
    const admitted = new Date('2026-10-14T10:00:00Z');
    expect(roomBillingDayCount(admitted, new Date('2026-10-14T10:00:00Z'))).toBe(1);
    expect(roomBillingDayCount(admitted, new Date('2026-10-15T09:59:59Z'))).toBe(1);
    expect(roomBillingDayCount(admitted, new Date('2026-10-15T10:00:00Z'))).toBe(2);
    expect(roomBillingDayCount(admitted, new Date('2026-10-16T10:00:00Z'))).toBe(3);
  });

  it('does not start a new calendar day charge after one minute across midnight', () => {
    const admitted = new Date('2026-10-14T18:59:30Z');
    expect(roomBillingDayCount(admitted, new Date('2026-10-14T19:00:30Z'))).toBe(1);
    expect(roomBillingDayCount(admitted, nextRoomPeriodAt(admitted))).toBe(2);
  });

  it('lists due period starts inclusively through the cutoff', () => {
    const start = new Date('2026-10-14T10:00:00Z');
    expect(dueRoomPeriodStarts(start, start)).toEqual([start]);
    expect(dueRoomPeriodStarts(start, nextRoomPeriodAt(start))).toEqual([
      start,
      nextRoomPeriodAt(start),
    ]);
    expect(dueRoomPeriodStarts(nextRoomPeriodAt(start), start)).toEqual([]);
  });

  it('still advances calendar labels over month boundaries', () => {
    expect(nextRoomBillingDate('2026-12-31')).toBe('2027-01-01');
  });
});
