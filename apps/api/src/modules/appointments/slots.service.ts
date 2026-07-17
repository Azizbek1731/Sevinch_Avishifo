import { Injectable } from '@nestjs/common';
import { fromZonedTime } from 'date-fns-tz';
import { AppointmentStatus, ScheduleExceptionType, TIMEZONE } from '@avishifo/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface GetFreeSlotsInput {
  doctorUserId: string;
  branchId: string;
  /** Calendar date in Asia/Tashkent, "YYYY-MM-DD". */
  date: string;
  serviceId?: string;
}

export interface FreeSlot {
  /** UTC ISO string. */
  startAt: string;
  /** UTC ISO string. */
  endAt: string;
}

interface SlotWindow {
  /** "HH:mm" local (Asia/Tashkent) window start. */
  start: string;
  /** "HH:mm" local (Asia/Tashkent) window end. */
  end: string;
  slotMinutes: number;
}

export const DEFAULT_SLOT_MINUTES = 15;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** ISO weekday (1 = Mon .. 7 = Sun) of a "YYYY-MM-DD" calendar date. */
export function isoWeekdayOf(date: string): number {
  const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * Slot engine (spec §M4): builds a doctor's free slots for one calendar day
 * from DoctorSchedule weekly templates, applies ScheduleException rows
 * (day-off types remove the day, CUSTOM_HOURS replaces the window) and
 * subtracts existing non-cancelled appointments. All computations are done in
 * Asia/Tashkent and returned as UTC ISO strings.
 */
@Injectable()
export class SlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFreeSlots(i: GetFreeSlotsInput): Promise<FreeSlot[]> {
    const weekday = isoWeekdayOf(i.date);

    const schedules = await this.prisma.db.doctorSchedule.findMany({
      where: {
        doctorUserId: i.doctorUserId,
        branchId: i.branchId,
        weekday,
        isActive: true,
      },
      orderBy: { startTime: 'asc' },
    });
    if (schedules.length === 0) return [];

    // ScheduleException.dateFrom/dateTo are DATE columns (UTC-midnight Dates).
    const day = new Date(`${i.date}T00:00:00.000Z`);
    const exceptions = await this.prisma.db.scheduleException.findMany({
      where: {
        doctorUserId: i.doctorUserId,
        dateFrom: { lte: day },
        dateTo: { gte: day },
      },
    });

    // DAY_OFF / VACATION / SICK_LEAVE remove the whole day.
    if (exceptions.some((e) => e.type !== ScheduleExceptionType.CUSTOM_HOURS)) {
      return [];
    }

    let serviceDuration: number | null = null;
    if (i.serviceId) {
      const service = await this.prisma.db.service.findFirst({
        where: { id: i.serviceId },
        select: { durationMin: true },
      });
      serviceDuration = service?.durationMin ?? null;
    }

    const defaultSlotMinutes = schedules[0]?.slotMinutes ?? DEFAULT_SLOT_MINUTES;

    // CUSTOM_HOURS replaces the scheduled window(s) for this day.
    const customWindows: SlotWindow[] = exceptions
      .filter((e) => e.type === ScheduleExceptionType.CUSTOM_HOURS)
      .flatMap((e) =>
        e.startTime && e.endTime
          ? [{ start: e.startTime, end: e.endTime, slotMinutes: defaultSlotMinutes }]
          : [],
      );

    const windows: SlotWindow[] =
      customWindows.length > 0
        ? customWindows
        : schedules.map((s) => ({
            start: s.startTime,
            end: s.endTime,
            slotMinutes: s.slotMinutes,
          }));

    // Existing non-cancelled appointments of this doctor overlapping the day.
    const dayStart = fromZonedTime(`${i.date}T00:00:00`, TIMEZONE);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const busy = await this.prisma.db.appointment.findMany({
      where: {
        doctorUserId: i.doctorUserId,
        status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      select: { startAt: true, endAt: true },
    });

    const now = Date.now();
    const slots: FreeSlot[] = [];
    for (const w of windows) {
      const slotLen = serviceDuration ?? w.slotMinutes;
      if (slotLen <= 0) continue;
      const lenMs = slotLen * MINUTE_MS;
      const windowStart = fromZonedTime(`${i.date}T${w.start}:00`, TIMEZONE).getTime();
      const windowEnd = fromZonedTime(`${i.date}T${w.end}:00`, TIMEZONE).getTime();
      for (let start = windowStart; start + lenMs <= windowEnd; start += lenMs) {
        const end = start + lenMs;
        // Never return past slots.
        if (start < now) continue;
        if (busy.some((b) => start < b.endAt.getTime() && end > b.startAt.getTime())) continue;
        slots.push({
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
        });
      }
    }

    slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return slots;
  }
}
