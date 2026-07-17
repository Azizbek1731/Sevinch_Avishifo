import { Injectable } from '@nestjs/common';
import { TicketStatus, type QueueStatsPayload } from '@avishifo/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventsService } from '../../core/realtime/events.service';
import { todayTashkentUtcDate } from './queue.util';

/**
 * Live queue metrics (spec §M5): patients waiting, average wait time today,
 * per-doctor load — recomputed after every queue mutation and broadcast to the
 * branch queue room and the clinic-wide dashboard room.
 */
@Injectable()
export class QueueStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Recompute today's stats for a branch and emit `queue.stats.updated`. */
  async emitStats(branchId: string, clinicId?: string): Promise<void> {
    const { payload, clinicId: derivedClinicId } = await this.compute(branchId);
    this.events.toBranchQueues(branchId, 'queue.stats.updated', payload);
    const cid = clinicId ?? derivedClinicId;
    if (cid) this.events.toClinic(cid, 'queue.stats.updated', payload);
  }

  private async compute(
    branchId: string,
  ): Promise<{ payload: QueueStatsPayload; clinicId: string | null }> {
    const date = todayTashkentUtcDate();
    const tickets = await this.prisma.db.queueTicket.findMany({
      where: { branchId, queue: { date } },
      select: {
        clinicId: true,
        status: true,
        doctorUserId: true,
        createdAt: true,
        calledAt: true,
        doctor: { select: { fullName: true } },
      },
    });

    const waiting = tickets.filter((t) => t.status === TicketStatus.WAITING).length;

    const waitsMin: number[] = [];
    for (const t of tickets) {
      if (t.calledAt) waitsMin.push((t.calledAt.getTime() - t.createdAt.getTime()) / 60_000);
    }
    const avgWaitMin =
      waitsMin.length === 0
        ? 0
        : Number((waitsMin.reduce((sum, m) => sum + m, 0) / waitsMin.length).toFixed(1));

    const perDoctor = new Map<string, QueueStatsPayload['perDoctor'][number]>();
    for (const t of tickets) {
      if (!t.doctorUserId) continue;
      let row = perDoctor.get(t.doctorUserId);
      if (!row) {
        row = {
          doctorUserId: t.doctorUserId,
          doctorName: t.doctor?.fullName ?? '',
          waiting: 0,
          inRoom: 0,
          doneToday: 0,
        };
        perDoctor.set(t.doctorUserId, row);
      }
      if (t.status === TicketStatus.WAITING) row.waiting += 1;
      else if (t.status === TicketStatus.IN_ROOM) row.inRoom += 1;
      else if (t.status === TicketStatus.DONE) row.doneToday += 1;
    }

    return {
      payload: { branchId, waiting, avgWaitMin, perDoctor: [...perDoctor.values()] },
      clinicId: tickets[0]?.clinicId ?? null,
    };
  }
}
