import { Injectable, Logger } from '@nestjs/common';
import {
  socketRooms,
  type ServerEventName,
  type ServerEventPayload,
} from '@avishifo/shared';
import type { Server } from 'socket.io';

/**
 * Typed WebSocket event emitter available to every module.
 * The QueueGateway registers the Socket.IO server here on init.
 * WS is a notification transport only — REST stays the source of truth (spec §10).
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToRoom<E extends ServerEventName>(room: string, event: E, payload: ServerEventPayload<E>): void {
    if (!this.server) {
      this.logger.warn(`WS server not ready; dropped ${event} → ${room}`);
      return;
    }
    this.server.to(room).emit(event, payload as never);
  }

  toClinic<E extends ServerEventName>(clinicId: string, event: E, p: ServerEventPayload<E>): void {
    this.emitToRoom(socketRooms.clinic(clinicId), event, p);
  }

  toBranchQueues<E extends ServerEventName>(branchId: string, event: E, p: ServerEventPayload<E>): void {
    this.emitToRoom(socketRooms.branchQueues(branchId), event, p);
  }

  toBranchDisplay<E extends ServerEventName>(branchId: string, event: E, p: ServerEventPayload<E>): void {
    this.emitToRoom(socketRooms.branchDisplay(branchId), event, p);
  }

  toDoctor<E extends ServerEventName>(doctorUserId: string, event: E, p: ServerEventPayload<E>): void {
    this.emitToRoom(socketRooms.doctorQueue(doctorUserId), event, p);
  }

  toUser<E extends ServerEventName>(userId: string, event: E, p: ServerEventPayload<E>): void {
    this.emitToRoom(socketRooms.user(userId), event, p);
  }

  toLabWorklist<E extends ServerEventName>(branchId: string, event: E, p: ServerEventPayload<E>): void {
    this.emitToRoom(socketRooms.labWorklist(branchId), event, p);
  }
}
