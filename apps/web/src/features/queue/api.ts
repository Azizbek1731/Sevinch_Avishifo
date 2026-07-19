import { api } from '@/lib/api-client';
import type { QueueKind, QueueTicketPayload, TicketPriority } from '@avishifo/shared';

/** GET /queues item (see apps/api queue.service.ts QueueListItem). */
export interface QueueListItem {
  id: string;
  branchId: string;
  kind: QueueKind;
  doctorUserId: string | null;
  doctorName: string | null;
  doctorRoomNumber: string | null;
  prefix: string;
  date: string; // "YYYY-MM-DD"
  lastNumber: number;
  isOpen: boolean;
  tickets: QueueTicketPayload[];
}

/** GET /branches/:id/rooms item (clinics module RoomResponse). */
export interface RoomItem {
  id: string;
  branchId: string;
  number: string;
  name: string | null;
  type: string;
  isActive: boolean;
}

export const queueApi = {
  list: (branchId: string, date?: string): Promise<QueueListItem[]> =>
    api.get<QueueListItem[]>('/queues', { branchId, date }).then((r) => r.data),

  rooms: (branchId: string): Promise<RoomItem[]> =>
    api.get<RoomItem[]>(`/branches/${branchId}/rooms`, { limit: 100 }).then((r) => r.data),

  callNext: (queueId: string, roomId?: string): Promise<QueueTicketPayload> =>
    api
      .post<QueueTicketPayload>(`/queues/${queueId}/call-next`, roomId ? { roomId } : {})
      .then((r) => r.data),

  start: (ticketId: string): Promise<QueueTicketPayload> =>
    api.post<QueueTicketPayload>(`/queues/tickets/${ticketId}/start`).then((r) => r.data),

  finish: (ticketId: string): Promise<QueueTicketPayload> =>
    api.post<QueueTicketPayload>(`/queues/tickets/${ticketId}/finish`).then((r) => r.data),

  skip: (ticketId: string): Promise<QueueTicketPayload> =>
    api.post<QueueTicketPayload>(`/queues/tickets/${ticketId}/skip`).then((r) => r.data),

  recall: (ticketId: string): Promise<QueueTicketPayload> =>
    api.post<QueueTicketPayload>(`/queues/tickets/${ticketId}/recall`).then((r) => r.data),

  setPriority: (ticketId: string, priority: TicketPriority): Promise<QueueTicketPayload> =>
    api
      .patch<QueueTicketPayload>(`/queues/tickets/${ticketId}/priority`, { priority })
      .then((r) => r.data),

  transfer: (ticketId: string, targetDoctorUserId: string): Promise<QueueTicketPayload> =>
    api
      .patch<QueueTicketPayload>(`/queues/tickets/${ticketId}/transfer`, { targetDoctorUserId })
      .then((r) => r.data),
};
