import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ErrorCode, TicketPriority, TicketStatus } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import type { AuditService } from '../../core/audit/audit.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { EventsService } from '../../core/realtime/events.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { QueueStatsService } from './queue-stats.service';
import { QueueService } from './queue.service';
import type { TicketWithRefs } from './queue.util';

type Over = Partial<TicketWithRefs>;

function ticket(status: TicketStatus, over: Over = {}): TicketWithRefs {
  return {
    id: 't1',
    clinicId: 'c1',
    branchId: 'b1',
    queueId: 'q1',
    number: 1,
    patientId: 'p1',
    doctorUserId: 'd1',
    appointmentId: null,
    status,
    priority: TicketPriority.NORMAL,
    position: 1,
    roomId: null,
    calledAt: null,
    startedAt: null,
    finishedAt: null,
    skippedAt: null,
    createdAt: new Date('2026-07-18T05:00:00.000Z'),
    updatedAt: new Date('2026-07-18T05:00:00.000Z'),
    patient: { fullName: 'Test Patient' },
    doctor: { fullName: 'Dr Test' },
    queue: { prefix: 'A' },
    ...over,
  } as TicketWithRefs;
}

interface DbMock {
  queue: { findFirst: Mock; update: Mock; create: Mock; count: Mock };
  queueTicket: {
    findFirst: Mock;
    findMany: Mock;
    update: Mock;
    updateMany: Mock;
    aggregate: Mock;
    create: Mock;
  };
  room: { findFirst: Mock; findMany: Mock };
  clinic: { findUnique: Mock };
  user: { findFirst: Mock };
}

function build() {
  const db: DbMock = {
    queue: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    queueTicket: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    room: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    clinic: { findUnique: vi.fn().mockResolvedValue({ settings: {} }) },
    user: { findFirst: vi.fn() },
  };
  const events = {
    toBranchQueues: vi.fn(),
    toBranchDisplay: vi.fn(),
    toDoctor: vi.fn(),
    toClinic: vi.fn(),
  } as unknown as EventsService;
  const stats = { emitStats: vi.fn().mockResolvedValue(undefined) } as unknown as QueueStatsService;
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const notifications = {
    enqueueEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
  const prisma = { db } as unknown as PrismaService;
  const svc = new QueueService(prisma, events, stats, audit, notifications);
  return { svc, db, events, stats };
}

async function expectAppError(promise: Promise<unknown>, code: string, status: number) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppException);
  const e = caught as AppException;
  expect(e.code).toBe(code);
  expect(e.getStatus()).toBe(status);
}

describe('QueueService ticket transitions', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  // ------------------------------------------------------------------ start

  it('start: CALLED → IN_ROOM', async () => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(TicketStatus.CALLED));
    ctx.db.queueTicket.update.mockResolvedValue(ticket(TicketStatus.IN_ROOM));
    const payload = await ctx.svc.start('t1');
    expect(payload.status).toBe(TicketStatus.IN_ROOM);
    expect(ctx.db.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ status: TicketStatus.IN_ROOM, startedAt: expect.any(Date) }),
      }),
    );
    expect(ctx.events.toBranchQueues).toHaveBeenCalledWith(
      'b1',
      'queue.ticket.updated',
      expect.anything(),
    );
  });

  it.each([TicketStatus.WAITING, TicketStatus.DONE, TicketStatus.SKIPPED, TicketStatus.IN_ROOM])(
    'start: %s → IN_ROOM is rejected',
    async (from) => {
      ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
      await expectAppError(ctx.svc.start('t1'), ErrorCode.TICKET_INVALID_TRANSITION, 409);
      expect(ctx.db.queueTicket.update).not.toHaveBeenCalled();
    },
  );

  // ----------------------------------------------------------------- finish

  it.each([TicketStatus.CALLED, TicketStatus.IN_ROOM])('finish: %s → DONE', async (from) => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
    ctx.db.queueTicket.update.mockResolvedValue(ticket(TicketStatus.DONE));
    const payload = await ctx.svc.finish('t1');
    expect(payload.status).toBe(TicketStatus.DONE);
    expect(ctx.db.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TicketStatus.DONE, finishedAt: expect.any(Date) }),
      }),
    );
  });

  it.each([TicketStatus.WAITING, TicketStatus.DONE, TicketStatus.SKIPPED])(
    'finish: %s → DONE is rejected',
    async (from) => {
      ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
      await expectAppError(ctx.svc.finish('t1'), ErrorCode.TICKET_INVALID_TRANSITION, 409);
    },
  );

  // ------------------------------------------------------------------- skip

  it.each([TicketStatus.WAITING, TicketStatus.CALLED])('skip: %s → SKIPPED', async (from) => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
    ctx.db.queueTicket.update.mockResolvedValue(ticket(TicketStatus.SKIPPED));
    const payload = await ctx.svc.skip('t1');
    expect(payload.status).toBe(TicketStatus.SKIPPED);
  });

  it.each([TicketStatus.IN_ROOM, TicketStatus.DONE, TicketStatus.SKIPPED])(
    'skip: %s → SKIPPED is rejected',
    async (from) => {
      ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
      await expectAppError(ctx.svc.skip('t1'), ErrorCode.TICKET_INVALID_TRANSITION, 409);
    },
  );

  it('missing ticket → TICKET_NOT_FOUND', async () => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(null);
    await expectAppError(ctx.svc.start('nope'), ErrorCode.TICKET_NOT_FOUND, 404);
  });

  // ----------------------------------------------------------------- recall

  it('recall of a CALLED ticket re-announces without mutating', async () => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(TicketStatus.CALLED));
    const payload = await ctx.svc.recall('t1');
    expect(payload.status).toBe(TicketStatus.CALLED);
    expect(ctx.db.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.events.toBranchDisplay).toHaveBeenCalledWith(
      'b1',
      'queue.ticket.called',
      expect.objectContaining({ repeat: true }),
    );
  });

  it.each([TicketStatus.WAITING, TicketStatus.IN_ROOM, TicketStatus.DONE])(
    'recall: %s is rejected',
    async (from) => {
      ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
      await expectAppError(ctx.svc.recall('t1'), ErrorCode.TICKET_INVALID_TRANSITION, 409);
    },
  );

  it('recall of a SKIPPED ticket re-queues it after the next 2 waiting tickets', async () => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(TicketStatus.SKIPPED, { position: 1 }));
    // Waiting queue positions 4,5,6 → anchor = waiting[2] (position 6).
    ctx.db.queueTicket.findMany.mockResolvedValue([
      { position: 4 },
      { position: 5 },
      { position: 6 },
    ]);
    ctx.db.queueTicket.update.mockResolvedValue(
      ticket(TicketStatus.WAITING, { position: 6, calledAt: null }),
    );
    const payload = await ctx.svc.recall('t1');
    expect(payload.status).toBe(TicketStatus.WAITING);
    // Waiting tickets at/after the anchor are shifted down by one.
    expect(ctx.db.queueTicket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queueId: 'q1',
          status: TicketStatus.WAITING,
          position: { gte: 6 },
        }),
        data: { position: { increment: 1 } },
      }),
    );
    expect(ctx.db.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({
          status: TicketStatus.WAITING,
          position: 6,
          calledAt: null,
          roomId: null,
        }),
      }),
    );
  });

  it('recall of a SKIPPED ticket lands at the tail when fewer waiting than the offset', async () => {
    ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(TicketStatus.SKIPPED));
    ctx.db.queueTicket.findMany.mockResolvedValue([{ position: 4 }]); // waiting[2] undefined
    ctx.db.queueTicket.aggregate.mockResolvedValue({ _max: { position: 7 } });
    ctx.db.queueTicket.update.mockResolvedValue(ticket(TicketStatus.WAITING, { position: 8 }));
    const payload = await ctx.svc.recall('t1');
    expect(payload.status).toBe(TicketStatus.WAITING);
    expect(ctx.db.queueTicket.updateMany).not.toHaveBeenCalled();
    expect(ctx.db.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 8 }) }),
    );
  });

  // --------------------------------------------------------------- transfer

  it.each([TicketStatus.CALLED, TicketStatus.IN_ROOM, TicketStatus.DONE, TicketStatus.SKIPPED])(
    'transfer: %s is rejected (only WAITING can move)',
    async (from) => {
      ctx.db.queueTicket.findFirst.mockResolvedValue(ticket(from));
      await expectAppError(ctx.svc.transfer('t1', 'd2'), ErrorCode.TICKET_INVALID_TRANSITION, 409);
    },
  );

  // --------------------------------------------------------------- callNext

  it('callNext calls EMERGENCY tickets before everyone else', async () => {
    ctx.db.queue.findFirst.mockResolvedValue({ id: 'q1', isOpen: true, prefix: 'A' });
    ctx.db.queueTicket.findFirst
      .mockResolvedValueOnce({ id: 'emg-1' }) // EMERGENCY probe
      .mockResolvedValue(null);
    ctx.db.queueTicket.update.mockResolvedValue(
      ticket(TicketStatus.CALLED, {
        id: 'emg-1',
        priority: TicketPriority.EMERGENCY,
        calledAt: new Date(),
      }),
    );
    const payload = await ctx.svc.callNext('q1');
    expect(payload.status).toBe(TicketStatus.CALLED);
    expect(ctx.db.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emg-1' },
        data: expect.objectContaining({ status: TicketStatus.CALLED, calledAt: expect.any(Date) }),
      }),
    );
    // The first WAITING probe was restricted to EMERGENCY priority.
    expect(ctx.db.queueTicket.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { status: TicketStatus.WAITING, priority: TicketPriority.EMERGENCY },
    });
  });

  it('callNext falls back to the first WAITING ticket by position', async () => {
    ctx.db.queue.findFirst.mockResolvedValue({ id: 'q1', isOpen: true, prefix: 'A' });
    ctx.db.queueTicket.findFirst
      .mockResolvedValueOnce(null) // no EMERGENCY
      .mockResolvedValueOnce({ id: 't2' });
    ctx.db.queueTicket.update.mockResolvedValue(
      ticket(TicketStatus.CALLED, { id: 't2', calledAt: new Date() }),
    );
    const payload = await ctx.svc.callNext('q1');
    expect(payload.status).toBe(TicketStatus.CALLED);
    expect(ctx.db.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't2' } }),
    );
  });

  it('callNext with no waiting tickets → TICKET_NOT_FOUND', async () => {
    ctx.db.queue.findFirst.mockResolvedValue({ id: 'q1', isOpen: true, prefix: 'A' });
    ctx.db.queueTicket.findFirst.mockResolvedValue(null);
    await expectAppError(ctx.svc.callNext('q1'), ErrorCode.TICKET_NOT_FOUND, 404);
  });

  it('callNext on an unknown queue → QUEUE_NOT_FOUND', async () => {
    ctx.db.queue.findFirst.mockResolvedValue(null);
    await expectAppError(ctx.svc.callNext('missing'), ErrorCode.QUEUE_NOT_FOUND, 404);
  });
});
