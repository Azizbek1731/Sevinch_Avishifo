import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ScheduleExceptionType } from '@avishifo/shared';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { DEFAULT_SLOT_MINUTES, SlotsService, isoWeekdayOf } from './slots.service';

/**
 * Fixed test day: Monday 2027-01-04 (Asia/Tashkent = UTC+5, no DST).
 * Local 09:00 on that date is 2027-01-04T04:00:00.000Z.
 */
const DATE = '2027-01-04';
const utc = (time: string) => `${DATE}T${time}:00.000Z`;

interface DbMock {
  doctorSchedule: { findMany: Mock };
  scheduleException: { findMany: Mock };
  service: { findFirst: Mock };
  appointment: { findMany: Mock };
}

function makeService(): { svc: SlotsService; db: DbMock } {
  const db: DbMock = {
    doctorSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    scheduleException: { findMany: vi.fn().mockResolvedValue([]) },
    service: { findFirst: vi.fn().mockResolvedValue(null) },
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = { db } as unknown as PrismaService;
  return { svc: new SlotsService(prisma), db };
}

const schedule = (over: Record<string, unknown> = {}) => ({
  id: 'sch-1',
  clinicId: 'c1',
  branchId: 'b1',
  doctorUserId: 'd1',
  weekday: 1,
  startTime: '09:00',
  endTime: '10:00',
  slotMinutes: 15,
  isActive: true,
  ...over,
});

const input = { doctorUserId: 'd1', branchId: 'b1', date: DATE };

describe('isoWeekdayOf', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoWeekdayOf('2027-01-04')).toBe(1); // Monday
    expect(isoWeekdayOf('2027-01-09')).toBe(6); // Saturday
    expect(isoWeekdayOf('2027-01-10')).toBe(7); // Sunday
  });
});

describe('SlotsService.getFreeSlots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Well before the test day → nothing is "in the past".
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns [] when the doctor has no schedule for the weekday', async () => {
    const { svc, db } = makeService();
    expect(await svc.getFreeSlots(input)).toEqual([]);
    expect(db.doctorSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ doctorUserId: 'd1', branchId: 'b1', weekday: 1, isActive: true }),
      }),
    );
    // Short-circuits before touching exceptions/appointments.
    expect(db.scheduleException.findMany).not.toHaveBeenCalled();
  });

  it('generates slots from the weekday window in Asia/Tashkent, returned as UTC', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    const slots = await svc.getFreeSlots(input);
    expect(slots).toEqual([
      { startAt: utc('04:00'), endAt: utc('04:15') },
      { startAt: utc('04:15'), endAt: utc('04:30') },
      { startAt: utc('04:30'), endAt: utc('04:45') },
      { startAt: utc('04:45'), endAt: utc('05:00') },
    ]);
  });

  it('merges multiple windows sorted by start time', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([
      schedule({ startTime: '09:00', endTime: '09:30' }),
      schedule({ id: 'sch-2', startTime: '14:00', endTime: '14:30' }),
    ]);
    const slots = await svc.getFreeSlots(input);
    expect(slots.map((s) => s.startAt)).toEqual([
      utc('04:00'),
      utc('04:15'),
      utc('09:00'), // 14:00 local
      utc('09:15'),
    ]);
  });

  it('drops slots that do not fully fit inside the window', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule({ startTime: '09:00', endTime: '09:50' })]);
    const slots = await svc.getFreeSlots(input);
    // 09:45 + 15min = 10:00 > 09:50 → excluded.
    expect(slots.map((s) => s.startAt)).toEqual([utc('04:00'), utc('04:15'), utc('04:30')]);
  });

  it.each([
    ScheduleExceptionType.DAY_OFF,
    ScheduleExceptionType.VACATION,
    ScheduleExceptionType.SICK_LEAVE,
  ])('removes the whole day on a %s exception', async (type) => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    db.scheduleException.findMany.mockResolvedValue([{ id: 'ex-1', type, startTime: null, endTime: null }]);
    expect(await svc.getFreeSlots(input)).toEqual([]);
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });

  it('CUSTOM_HOURS replaces the scheduled window for the day', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    db.scheduleException.findMany.mockResolvedValue([
      { id: 'ex-1', type: ScheduleExceptionType.CUSTOM_HOURS, startTime: '11:00', endTime: '11:30' },
    ]);
    const slots = await svc.getFreeSlots(input);
    // Only the replacement window (11:00-11:30 local = 06:00-06:30 UTC).
    expect(slots).toEqual([
      { startAt: utc('06:00'), endAt: utc('06:15') },
      { startAt: utc('06:15'), endAt: utc('06:30') },
    ]);
  });

  it('subtracts overlapping non-cancelled appointments', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    db.appointment.findMany.mockResolvedValue([
      // 09:15–09:30 local booked; partial overlap with 09:30 slot? no — exact fit.
      { startAt: new Date(utc('04:15')), endAt: new Date(utc('04:30')) },
    ]);
    const slots = await svc.getFreeSlots(input);
    expect(slots.map((s) => s.startAt)).toEqual([utc('04:00'), utc('04:30'), utc('04:45')]);
  });

  it('a partially-overlapping appointment blocks every touched slot', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    db.appointment.findMany.mockResolvedValue([
      // 09:10–09:20 local overlaps both the 09:00 and 09:15 slots.
      { startAt: new Date(`${DATE}T04:10:00.000Z`), endAt: new Date(`${DATE}T04:20:00.000Z`) },
    ]);
    const slots = await svc.getFreeSlots(input);
    expect(slots.map((s) => s.startAt)).toEqual([utc('04:30'), utc('04:45')]);
  });

  it('never returns past slots', async () => {
    const { svc, db } = makeService();
    // "Now" is 09:20 local on the requested day.
    vi.setSystemTime(new Date(`${DATE}T04:20:00.000Z`));
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    const slots = await svc.getFreeSlots(input);
    // 09:00 and 09:15 already started → excluded; 09:30+ remain.
    expect(slots.map((s) => s.startAt)).toEqual([utc('04:30'), utc('04:45')]);
  });

  it('uses the service duration as slot length when serviceId is given', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    db.service.findFirst.mockResolvedValue({ durationMin: 30 });
    const slots = await svc.getFreeSlots({ ...input, serviceId: 'svc-1' });
    expect(slots).toEqual([
      { startAt: utc('04:00'), endAt: utc('04:30') },
      { startAt: utc('04:30'), endAt: utc('05:00') },
    ]);
  });

  it('falls back to the window slotMinutes when the service is unknown', async () => {
    const { svc, db } = makeService();
    db.doctorSchedule.findMany.mockResolvedValue([schedule()]);
    db.service.findFirst.mockResolvedValue(null);
    const slots = await svc.getFreeSlots({ ...input, serviceId: 'missing' });
    expect(slots).toHaveLength(4); // 15-minute grid from the schedule row
  });

  it('exports a sane default slot length', () => {
    expect(DEFAULT_SLOT_MINUTES).toBe(15);
  });
});
