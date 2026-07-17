import type { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { formatTicketNumber, TIMEZONE, type QueueTicketPayload } from '@avishifo/shared';

/**
 * Today's calendar date in Asia/Tashkent represented as a UTC-midnight Date —
 * the canonical value stored in `Queue.date` (@db.Date).
 */
export function todayTashkentUtcDate(): Date {
  const day = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return new Date(`${day}T00:00:00.000Z`);
}

/** "2026-07-18" → UTC-midnight Date for `@db.Date` comparisons. */
export function dateOnlyToUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/** Relations needed to build a QueueTicketPayload from a ticket row. */
export const ticketInclude = {
  patient: { select: { fullName: true } },
  doctor: { select: { fullName: true } },
  queue: { select: { prefix: true } },
} satisfies Prisma.QueueTicketInclude;

export type TicketWithRefs = Prisma.QueueTicketGetPayload<{ include: typeof ticketInclude }>;

/** Map a ticket row (+ resolved room number) to the shared socket payload. */
export function toTicketPayload(t: TicketWithRefs, roomNumber: string | null): QueueTicketPayload {
  return {
    id: t.id,
    queueId: t.queueId,
    branchId: t.branchId,
    ticketNumber: formatTicketNumber(t.queue.prefix, t.number),
    status: t.status,
    priority: t.priority,
    patientId: t.patientId,
    patientName: t.patient.fullName,
    doctorUserId: t.doctorUserId,
    doctorName: t.doctor?.fullName ?? null,
    roomNumber,
    position: t.position,
    createdAt: t.createdAt.toISOString(),
    calledAt: t.calledAt ? t.calledAt.toISOString() : null,
  };
}
