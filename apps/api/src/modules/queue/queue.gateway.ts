import { Logger } from '@nestjs/common';
import type {
  OnGatewayConnection,
  OnGatewayInit} from '@nestjs/websockets';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  socketRooms,
  UserRole,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@avishifo/shared';
import { PrincipalService } from '../../core/principal/principal.service';
import {
  type Principal,
  type UserPrincipal,
} from '../../core/principal/principal.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { EventsService } from '../../core/realtime/events.service';
import { QueueService } from './queue.service';

interface SocketData {
  principal?: Principal;
}

type QueueSocket = Socket<ClientToServerEvents, ServerToClientEvents, ServerToClientEvents, SocketData>;
type QueueServer = Server<ClientToServerEvents, ServerToClientEvents, ServerToClientEvents, SocketData>;
type Ack = { ok: true } | { ok: false; error: string };

/** Roles that also join the clinic-wide dashboard room. */
const CLINIC_ROOM_ROLES: readonly UserRole[] = [
  UserRole.CLINIC_OWNER,
  UserRole.CLINIC_ADMIN,
  UserRole.ACCOUNTANT,
];

function pickString(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The ONLY Socket.IO gateway (spec §10). Authenticates the handshake
 * (staff JWT or TV display token), joins clients strictly to rooms of their
 * own clinic, serves snapshots, and accepts the optional WS action path for
 * doctor calls — every action also exists as REST; the service layer emits
 * events either way.
 */
@WebSocketGateway()
export class QueueGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(QueueGateway.name);

  @WebSocketServer()
  server?: QueueServer;

  constructor(
    private readonly events: EventsService,
    private readonly principals: PrincipalService,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  afterInit(server: Server): void {
    // Register the one Socket.IO server so any module can emit via EventsService.
    this.events.setServer(server);
  }

  async handleConnection(socket: QueueSocket): Promise<void> {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      socket.disconnect();
      return;
    }

    let principal: Principal;
    try {
      principal = await this.principals.resolveSocketPrincipal(token);
    } catch {
      socket.disconnect();
      return;
    }
    socket.data.principal = principal;

    try {
      if (principal.kind === 'display') {
        // Display joins ONLY its display room: queue events are emitted to both
        // branchQueues and branchDisplay, so joining both would deliver (and
        // TTS-announce) every event twice.
        await socket.join(socketRooms.branchDisplay(principal.branchId));
        await this.sendSnapshots(socket, principal.clinicId, [principal.branchId]);
        return;
      }

      const { user } = principal;
      await socket.join(socketRooms.user(user.id));
      // SUPER_ADMIN has no clinic scope; PATIENT users get personal notifications only.
      if (!user.clinicId || user.role === UserRole.PATIENT) return;

      if (user.role === UserRole.DOCTOR) {
        await socket.join(socketRooms.doctorQueue(user.id));
      }
      if (CLINIC_ROOM_ROLES.includes(user.role)) {
        await socket.join(socketRooms.clinic(user.clinicId));
      }

      const branchIds = await this.resolveBranchIds(user);
      for (const branchId of branchIds) {
        await socket.join(socketRooms.branchQueues(branchId));
        if (user.role === UserRole.LAB_TECH) {
          await socket.join(socketRooms.labWorklist(branchId));
        }
      }
      await this.sendSnapshots(socket, user.clinicId, branchIds, user.id);
    } catch (err) {
      this.logger.warn(`WS connection setup failed: ${(err as Error).message}`);
      socket.disconnect();
    }
  }

  // ------------------------------------------------------------ client events

  @SubscribeMessage('queue.subscribe')
  async onSubscribe(
    @ConnectedSocket() socket: QueueSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const principal = socket.data.principal;
    if (!principal) return { ok: false, error: 'Unauthorized' };
    const branchId = pickString(body, 'branchId');
    if (!branchId) return { ok: false, error: 'branchId is required' };

    try {
      if (principal.kind === 'display') {
        if (branchId !== principal.branchId) {
          return { ok: false, error: 'Branch not allowed for this display' };
        }
        await socket.join(socketRooms.branchQueues(branchId));
        await this.sendSnapshots(socket, principal.clinicId, [branchId]);
        return { ok: true };
      }

      const { user } = principal;
      if (!user.clinicId) return { ok: false, error: 'No clinic scope' };
      if (user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
        return { ok: false, error: 'No access to this branch' };
      }
      return await TenantContext.run({ clinicId: user.clinicId, userId: user.id }, async () => {
        // Tenant-scoped lookup: a foreign branch id resolves to null.
        const branch = await this.prisma.db.branch.findFirst({
          where: { id: branchId },
          select: { id: true },
        });
        if (!branch) return { ok: false, error: 'Branch not found' } as const;
        await socket.join(socketRooms.branchQueues(branchId));
        socket.emit('queue.snapshot', { branchId, tickets: await this.queue.getSnapshot(branchId) });
        return { ok: true } as const;
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage('queue.callNext')
  async onCallNext(
    @ConnectedSocket() socket: QueueSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const queueId = pickString(body, 'queueId');
    if (!queueId) return { ok: false, error: 'queueId is required' };
    return this.runQueueAction(socket, () => this.queue.callNext(queueId));
  }

  @SubscribeMessage('queue.finish')
  async onFinish(
    @ConnectedSocket() socket: QueueSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const ticketId = pickString(body, 'ticketId');
    if (!ticketId) return { ok: false, error: 'ticketId is required' };
    return this.runQueueAction(socket, () => this.queue.finish(ticketId));
  }

  @SubscribeMessage('queue.skip')
  async onSkip(@ConnectedSocket() socket: QueueSocket, @MessageBody() body: unknown): Promise<Ack> {
    const ticketId = pickString(body, 'ticketId');
    if (!ticketId) return { ok: false, error: 'ticketId is required' };
    return this.runQueueAction(socket, () => this.queue.skip(ticketId));
  }

  @SubscribeMessage('queue.recall')
  async onRecall(
    @ConnectedSocket() socket: QueueSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const ticketId = pickString(body, 'ticketId');
    if (!ticketId) return { ok: false, error: 'ticketId is required' };
    return this.runQueueAction(socket, () => this.queue.recall(ticketId));
  }

  // ------------------------------------------------------------ internals

  /** WS doctor actions require a user principal with `queue.call` (displays cannot act). */
  private async runQueueAction(socket: QueueSocket, fn: () => Promise<unknown>): Promise<Ack> {
    const principal = socket.data.principal;
    if (!principal || principal.kind !== 'user') {
      return { ok: false, error: 'Not allowed' };
    }
    const { user } = principal;
    if (!user.clinicId || !user.permissions.includes('queue.call')) {
      return { ok: false, error: 'Missing queue.call permission' };
    }
    try {
      await TenantContext.run(
        { clinicId: user.clinicId, userId: user.id, role: user.role },
        fn,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Staff without explicit branch assignments see every active branch of the clinic. */
  private async resolveBranchIds(user: UserPrincipal['user']): Promise<string[]> {
    if (user.branchIds.length > 0) return user.branchIds;
    if (!user.clinicId) return [];
    const clinicId = user.clinicId;
    return TenantContext.run({ clinicId, userId: user.id }, async () => {
      const branches = await this.prisma.db.branch.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return branches.map((b) => b.id);
    });
  }

  private async sendSnapshots(
    socket: QueueSocket,
    clinicId: string,
    branchIds: string[],
    userId?: string,
  ): Promise<void> {
    await TenantContext.run({ clinicId, userId }, async () => {
      for (const branchId of branchIds) {
        socket.emit('queue.snapshot', { branchId, tickets: await this.queue.getSnapshot(branchId) });
      }
    });
  }
}
