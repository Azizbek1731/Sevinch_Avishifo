import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  formatTicketNumber,
  NotificationEvent,
  QUEUE_NEAR_THRESHOLD,
  QueueKind,
  TicketPriority,
  TicketStatus,
  UserRole,
  type QueueQueryInput,
  type QueueTicketPayload,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { EventsService } from '../../core/realtime/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueStatsService } from './queue-stats.service';
import {
  dateOnlyToUtc,
  ticketInclude,
  toTicketPayload,
  todayTashkentUtcDate,
  type TicketWithRefs,
} from './queue.util';

/** Cross-module contract input (kind/priority optional — defaulted here). */
export interface EnqueueServiceInput {
  patientId: string;
  branchId: string;
  doctorUserId?: string;
  kind?: QueueKind;
  priority?: TicketPriority;
  appointmentId?: string;
}

export interface CallNextOptions {
  roomId?: string;
}

export interface QueueListItem {
  id: string;
  branchId: string;
  kind: QueueKind;
  doctorUserId: string | null;
  doctorName: string | null;
  prefix: string;
  date: string; // "YYYY-MM-DD"
  lastNumber: number;
  isOpen: boolean;
  tickets: QueueTicketPayload[];
}

/** Delegates shared by the tenant client and its interactive-transaction client. */
type QueueDb = Pick<PrismaService['db'], 'queue' | 'queueTicket'>;

/** Re-queue offset when recalling a skipped ticket ("after next 2 waiting"). */
const DEFAULT_RECALL_OFFSET = 2;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly stats: QueueStatsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ enqueue

  async enqueue(
    input: EnqueueServiceInput,
  ): Promise<{ id: string; ticketNumber: string; queueId: string }> {
    const kind = input.kind ?? QueueKind.DOCTOR;
    const priority = input.priority ?? TicketPriority.NORMAL;
    if (kind === QueueKind.DOCTOR && !input.doctorUserId) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'doctorUserId is required for DOCTOR queues',
        400,
      );
    }

    // Tenant-scoped lookups double as cross-tenant guards (foreign ids resolve to null).
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: input.branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    const queue = await this.findOrCreateTodayQueue(input.branchId, kind, input.doctorUserId ?? null);
    if (!queue.isOpen) throw new AppException(ErrorCode.QUEUE_CLOSED, 'Queue is closed', 409);

    let ticket: TicketWithRefs;
    try {
      ticket = await this.prisma.db.$transaction(async (tx) => {
        const { lastNumber } = await tx.queue.update({
          where: { id: queue.id },
          data: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const position = await this.computeInsertPosition(tx, queue.id, priority);
        return tx.queueTicket.create({
          data: {
            // Required by Prisma's input type; the tenant extension re-stamps the same value.
            clinicId: TenantContext.requireClinicId(),
            queueId: queue.id,
            branchId: input.branchId,
            patientId: input.patientId,
            doctorUserId: queue.doctorUserId ?? input.doctorUserId ?? null,
            appointmentId: input.appointmentId,
            number: lastNumber,
            position,
            priority,
          },
          include: ticketInclude,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(ErrorCode.CONFLICT, 'Appointment already has a queue ticket', 409);
      }
      throw err;
    }

    const payload = toTicketPayload(ticket, null);
    this.broadcastTicket('queue.ticket.created', payload);
    await this.stats.emitStats(payload.branchId, ticket.clinicId);
    return { id: ticket.id, ticketNumber: payload.ticketNumber, queueId: queue.id };
  }

  // ------------------------------------------------------------ call / transitions

  async callNext(queueId: string, opts: CallNextOptions = {}): Promise<QueueTicketPayload> {
    const queue = await this.prisma.db.queue.findFirst({ where: { id: queueId } });
    if (!queue) throw new AppException(ErrorCode.QUEUE_NOT_FOUND, 'Queue not found', 404);

    // EMERGENCY tickets first, then everyone else by position.
    const next =
      (await this.prisma.db.queueTicket.findFirst({
        where: { queueId, status: TicketStatus.WAITING, priority: TicketPriority.EMERGENCY },
        orderBy: { position: 'asc' },
        select: { id: true },
      })) ??
      (await this.prisma.db.queueTicket.findFirst({
        where: { queueId, status: TicketStatus.WAITING },
        orderBy: { position: 'asc' },
        select: { id: true },
      }));
    if (!next) {
      throw new AppException(ErrorCode.TICKET_NOT_FOUND, 'No waiting tickets in this queue', 404);
    }

    const roomNumber = await this.roomNumberOf(opts.roomId ?? null);
    const updated = await this.prisma.db.queueTicket.update({
      where: { id: next.id },
      data: { status: TicketStatus.CALLED, calledAt: new Date(), roomId: opts.roomId ?? null },
      include: ticketInclude,
    });

    const payload = toTicketPayload(updated, roomNumber);
    this.broadcastCalled(payload, roomNumber, false);
    this.broadcastTicket('queue.ticket.updated', payload);
    await this.stats.emitStats(payload.branchId, updated.clinicId);
    await this.notifyTurnNear(queueId, updated.clinicId, updated.queue.prefix);
    return payload;
  }

  async start(ticketId: string): Promise<QueueTicketPayload> {
    return this.transition(ticketId, [TicketStatus.CALLED], TicketStatus.IN_ROOM, {
      startedAt: new Date(),
    });
  }

  async finish(ticketId: string): Promise<QueueTicketPayload> {
    return this.transition(
      ticketId,
      [TicketStatus.CALLED, TicketStatus.IN_ROOM],
      TicketStatus.DONE,
      { finishedAt: new Date() },
    );
  }

  async skip(ticketId: string): Promise<QueueTicketPayload> {
    return this.transition(
      ticketId,
      [TicketStatus.WAITING, TicketStatus.CALLED],
      TicketStatus.SKIPPED,
      { skippedAt: new Date() },
    );
  }

  /**
   * Recall: a CALLED ticket is re-announced (repeat=true); a SKIPPED ticket is
   * re-queued after the next `clinic.settings.queueAutoRecallPosition` waiting
   * tickets (default 2).
   */
  async recall(ticketId: string): Promise<QueueTicketPayload> {
    const ticket = await this.requireTicket(ticketId);

    if (ticket.status === TicketStatus.CALLED) {
      const roomNumber = await this.roomNumberOf(ticket.roomId);
      const payload = toTicketPayload(ticket, roomNumber);
      this.broadcastCalled(payload, roomNumber, true);
      return payload;
    }
    if (ticket.status !== TicketStatus.SKIPPED) {
      throw new AppException(
        ErrorCode.TICKET_INVALID_TRANSITION,
        'Only SKIPPED or CALLED tickets can be recalled',
        409,
      );
    }

    const offset = await this.recallOffset(ticket.clinicId);
    const waiting = await this.prisma.db.queueTicket.findMany({
      where: { queueId: ticket.queueId, status: TicketStatus.WAITING },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    const anchor = waiting[offset];
    let position: number;
    if (anchor) {
      position = anchor.position;
      await this.prisma.db.queueTicket.updateMany({
        where: { queueId: ticket.queueId, status: TicketStatus.WAITING, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
    } else {
      const agg = await this.prisma.db.queueTicket.aggregate({
        where: { queueId: ticket.queueId },
        _max: { position: true },
      });
      position = (agg._max.position ?? 0) + 1;
    }

    const updated = await this.prisma.db.queueTicket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.WAITING, position, calledAt: null, roomId: null },
      include: ticketInclude,
    });
    return this.finishMutation(updated);
  }

  // ------------------------------------------------------------ manage

  async reorder(ticketId: string, position: number): Promise<QueueTicketPayload> {
    const ticket = await this.requireTicket(ticketId);
    const from = ticket.position;
    if (position < from) {
      await this.prisma.db.queueTicket.updateMany({
        where: { queueId: ticket.queueId, position: { gte: position, lt: from } },
        data: { position: { increment: 1 } },
      });
    } else if (position > from) {
      await this.prisma.db.queueTicket.updateMany({
        where: { queueId: ticket.queueId, position: { gt: from, lte: position } },
        data: { position: { decrement: 1 } },
      });
    }
    const updated = await this.prisma.db.queueTicket.update({
      where: { id: ticketId },
      data: { position },
      include: ticketInclude,
    });
    return this.finishMutation(updated);
  }

  async transfer(ticketId: string, targetDoctorUserId: string): Promise<QueueTicketPayload> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.status !== TicketStatus.WAITING) {
      throw new AppException(
        ErrorCode.TICKET_INVALID_TRANSITION,
        'Only WAITING tickets can be transferred',
        409,
      );
    }
    // User is not tenant-auto-scoped — filter by the ticket's clinicId explicitly.
    const doctor = await this.prisma.db.user.findFirst({
      where: {
        id: targetDoctorUserId,
        clinicId: ticket.clinicId,
        role: UserRole.DOCTOR,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!doctor) throw new AppException(ErrorCode.NOT_FOUND, 'Target doctor not found', 404);
    if (ticket.doctorUserId === targetDoctorUserId) {
      return toTicketPayload(ticket, await this.roomNumberOf(ticket.roomId));
    }

    const targetQueue = await this.findOrCreateTodayQueue(
      ticket.branchId,
      QueueKind.DOCTOR,
      targetDoctorUserId,
    );
    if (!targetQueue.isOpen) {
      throw new AppException(ErrorCode.QUEUE_CLOSED, 'Target queue is closed', 409);
    }

    const previousDoctorUserId = ticket.doctorUserId;
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const { lastNumber } = await tx.queue.update({
        where: { id: targetQueue.id },
        data: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
      });
      const position = await this.computeInsertPosition(
        tx,
        targetQueue.id,
        ticket.priority,
        ticket.id,
      );
      return tx.queueTicket.update({
        where: { id: ticketId },
        data: {
          queueId: targetQueue.id,
          doctorUserId: targetDoctorUserId,
          number: lastNumber,
          position,
        },
        include: ticketInclude,
      });
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'QueueTicket',
      entityId: ticketId,
      before: {
        queueId: ticket.queueId,
        doctorUserId: previousDoctorUserId,
        number: ticket.number,
      },
      after: {
        queueId: updated.queueId,
        doctorUserId: updated.doctorUserId,
        number: updated.number,
      },
    });

    const payload = await this.finishMutation(updated);
    // The previous doctor's board must drop the ticket too.
    if (previousDoctorUserId && previousDoctorUserId !== targetDoctorUserId) {
      this.events.toDoctor(previousDoctorUserId, 'queue.ticket.updated', { ticket: payload });
    }
    return payload;
  }

  async setPriority(ticketId: string, priority: TicketPriority): Promise<QueueTicketPayload> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.priority === priority) {
      return toTicketPayload(ticket, await this.roomNumberOf(ticket.roomId));
    }
    let position = ticket.position;
    if (ticket.status === TicketStatus.WAITING) {
      position = await this.computeInsertPosition(
        this.prisma.db,
        ticket.queueId,
        priority,
        ticket.id,
      );
    }
    const updated = await this.prisma.db.queueTicket.update({
      where: { id: ticketId },
      data: { priority, position },
      include: ticketInclude,
    });
    return this.finishMutation(updated);
  }

  // ------------------------------------------------------------ reads

  async getQueues(query: QueueQueryInput): Promise<PaginatedResult<QueueListItem>> {
    const date = query.date ? dateOnlyToUtc(query.date) : todayTashkentUtcDate();
    const queues = await this.prisma.db.queue.findMany({
      where: {
        branchId: query.branchId,
        date,
        ...(query.doctorUserId ? { doctorUserId: query.doctorUserId } : {}),
      },
      orderBy: [{ kind: 'asc' }, { prefix: 'asc' }],
      include: {
        doctor: { select: { fullName: true } },
        tickets: { include: ticketInclude, orderBy: { position: 'asc' } },
      },
    });
    const rooms = await this.roomNumberMap(query.branchId);
    const items: QueueListItem[] = queues.map((q) => ({
      id: q.id,
      branchId: q.branchId,
      kind: q.kind,
      doctorUserId: q.doctorUserId,
      doctorName: q.doctor?.fullName ?? null,
      prefix: q.prefix,
      date: q.date.toISOString().slice(0, 10),
      lastNumber: q.lastNumber,
      isOpen: q.isOpen,
      tickets: q.tickets.map((t) =>
        toTicketPayload(t, t.roomId ? (rooms.get(t.roomId) ?? null) : null),
      ),
    }));
    return paginated(items, { page: 1, limit: items.length, total: items.length });
  }

  /** Today's tickets (all statuses) for a branch — the `queue.snapshot` payload. */
  async getSnapshot(branchId: string): Promise<QueueTicketPayload[]> {
    const date = todayTashkentUtcDate();
    const tickets = await this.prisma.db.queueTicket.findMany({
      where: { branchId, queue: { date } },
      orderBy: { position: 'asc' },
      include: ticketInclude,
    });
    const rooms = await this.roomNumberMap(branchId);
    return tickets.map((t) => toTicketPayload(t, t.roomId ? (rooms.get(t.roomId) ?? null) : null));
  }

  // ------------------------------------------------------------ internals

  private async findOrCreateTodayQueue(
    branchId: string,
    kind: QueueKind,
    doctorUserId: string | null,
  ) {
    const date = todayTashkentUtcDate();
    const found = await this.prisma.db.queue.findFirst({
      where: { branchId, date, kind, doctorUserId },
    });
    if (found) return found;

    const prefix = await this.nextPrefix(branchId, date, kind);
    try {
      return await this.prisma.db.queue.create({
        data: {
          // Required by Prisma's input type; the tenant extension re-stamps the same value.
          clinicId: TenantContext.requireClinicId(),
          branchId,
          date,
          kind,
          doctorUserId,
          prefix,
        },
      });
    } catch (err) {
      // Lost a concurrent create race on unique (branchId, date, kind, doctorUserId).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.db.queue.findFirst({
          where: { branchId, date, kind, doctorUserId },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  private async nextPrefix(branchId: string, date: Date, kind: QueueKind): Promise<string> {
    if (kind === QueueKind.LAB) return 'L';
    if (kind === QueueKind.CUSTOM) return 'C';
    // DOCTOR queues get 'A', 'B', 'C'… by creation order within the branch/day.
    const existing = await this.prisma.db.queue.count({
      where: { branchId, date, kind: QueueKind.DOCTOR },
    });
    return String.fromCharCode(65 + Math.min(existing, 25));
  }

  /**
   * Insert position for a new/re-prioritized WAITING ticket:
   * NORMAL → tail; EMERGENCY → before the first waiting ticket; PRIORITY →
   * before the first NORMAL waiting ticket. Later waiting tickets are shifted.
   */
  private async computeInsertPosition(
    db: QueueDb,
    queueId: string,
    priority: TicketPriority,
    excludeTicketId?: string,
  ): Promise<number> {
    const notSelf = excludeTicketId ? { id: { not: excludeTicketId } } : {};
    const agg = await db.queueTicket.aggregate({
      where: { queueId, ...notSelf },
      _max: { position: true },
    });
    const tail = (agg._max.position ?? 0) + 1;
    if (priority === TicketPriority.NORMAL) return tail;

    const anchor = await db.queueTicket.findFirst({
      where: {
        queueId,
        status: TicketStatus.WAITING,
        ...(priority === TicketPriority.PRIORITY ? { priority: TicketPriority.NORMAL } : {}),
        ...notSelf,
      },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    if (!anchor) return tail;

    await db.queueTicket.updateMany({
      where: {
        queueId,
        status: TicketStatus.WAITING,
        position: { gte: anchor.position },
        ...notSelf,
      },
      data: { position: { increment: 1 } },
    });
    return anchor.position;
  }

  private async transition(
    ticketId: string,
    from: readonly TicketStatus[],
    to: TicketStatus,
    patch: Prisma.QueueTicketUpdateInput,
  ): Promise<QueueTicketPayload> {
    const ticket = await this.requireTicket(ticketId);
    if (!from.includes(ticket.status)) {
      throw new AppException(
        ErrorCode.TICKET_INVALID_TRANSITION,
        `Cannot move ticket from ${ticket.status} to ${to}`,
        409,
      );
    }
    const updated = await this.prisma.db.queueTicket.update({
      where: { id: ticketId },
      data: { status: to, ...patch },
      include: ticketInclude,
    });
    return this.finishMutation(updated);
  }

  /** Emit `queue.ticket.updated` + refreshed stats after any ticket mutation. */
  private async finishMutation(updated: TicketWithRefs): Promise<QueueTicketPayload> {
    const payload = toTicketPayload(updated, await this.roomNumberOf(updated.roomId));
    this.broadcastTicket('queue.ticket.updated', payload);
    await this.stats.emitStats(payload.branchId, updated.clinicId);
    return payload;
  }

  private async requireTicket(ticketId: string): Promise<TicketWithRefs> {
    const ticket = await this.prisma.db.queueTicket.findFirst({
      where: { id: ticketId },
      include: ticketInclude,
    });
    if (!ticket) throw new AppException(ErrorCode.TICKET_NOT_FOUND, 'Ticket not found', 404);
    return ticket;
  }

  private async roomNumberOf(roomId: string | null): Promise<string | null> {
    if (!roomId) return null;
    const room = await this.prisma.db.room.findFirst({
      where: { id: roomId },
      select: { number: true },
    });
    return room?.number ?? null;
  }

  private async roomNumberMap(branchId: string): Promise<Map<string, string>> {
    const rooms = await this.prisma.db.room.findMany({
      where: { branchId },
      select: { id: true, number: true },
    });
    return new Map(rooms.map((r) => [r.id, r.number]));
  }

  private broadcastTicket(
    event: 'queue.ticket.created' | 'queue.ticket.updated',
    ticket: QueueTicketPayload,
  ): void {
    const p = { ticket };
    this.events.toBranchQueues(ticket.branchId, event, p);
    this.events.toBranchDisplay(ticket.branchId, event, p);
    if (ticket.doctorUserId) this.events.toDoctor(ticket.doctorUserId, event, p);
  }

  private broadcastCalled(ticket: QueueTicketPayload, room: string | null, repeat: boolean): void {
    const p = { ticket, room, repeat };
    this.events.toBranchQueues(ticket.branchId, 'queue.ticket.called', p);
    this.events.toBranchDisplay(ticket.branchId, 'queue.ticket.called', p);
    if (ticket.doctorUserId) this.events.toDoctor(ticket.doctorUserId, 'queue.ticket.called', p);
  }

  /** QUEUE_TURN_NEAR: notify patients now ≤ 2 tickets ahead (spec §M13). */
  private async notifyTurnNear(queueId: string, clinicId: string, prefix: string): Promise<void> {
    try {
      const waiting = await this.prisma.db.queueTicket.findMany({
        where: { queueId, status: TicketStatus.WAITING },
        orderBy: { position: 'asc' },
        select: { number: true, patientId: true, priority: true },
      });
      const ordered = [
        ...waiting.filter((t) => t.priority === TicketPriority.EMERGENCY),
        ...waiting.filter((t) => t.priority !== TicketPriority.EMERGENCY),
      ].slice(0, QUEUE_NEAR_THRESHOLD + 1);
      await Promise.all(
        ordered.map((t, ahead) =>
          this.notifications.enqueueEvent({
            event: NotificationEvent.QUEUE_TURN_NEAR,
            clinicId,
            patientId: t.patientId,
            vars: { ticket_number: formatTicketNumber(prefix, t.number), ahead: String(ahead) },
          }),
        ),
      );
    } catch (err) {
      // Notifications must never break the call flow. Ids only — no PHI in logs.
      this.logger.warn(`QUEUE_TURN_NEAR dispatch failed for queue ${queueId}: ${(err as Error).message}`);
    }
  }

  /** clinic.settings.queueAutoRecallPosition, defaulting to "after next 2 waiting". */
  private async recallOffset(clinicId: string): Promise<number> {
    // Clinic is not a tenant-auto-scoped model; we read only our own clinic row by PK.
    const clinic = await this.prisma.db.clinic.findUnique({
      where: { id: clinicId },
      select: { settings: true },
    });
    const settings: unknown = clinic?.settings;
    const value =
      settings !== null && typeof settings === 'object' && !Array.isArray(settings)
        ? (settings as Record<string, unknown>)['queueAutoRecallPosition']
        : undefined;
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value
      : DEFAULT_RECALL_OFFSET;
  }
}
