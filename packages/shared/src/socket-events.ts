import type { TicketPriority, TicketStatus, AppointmentStatus, LabOrderStatus } from './enums';

/** Room name builders — keep in sync with the API gateway (spec §10). */
export const socketRooms = {
  clinic: (clinicId: string) => `clinic:${clinicId}`,
  branchQueues: (branchId: string) => `branch:${branchId}:queues`,
  branchDisplay: (branchId: string) => `branch:${branchId}:display`,
  doctorQueue: (doctorUserId: string) => `doctor:${doctorUserId}:queue`,
  user: (userId: string) => `user:${userId}`,
  labWorklist: (branchId: string) => `labworklist:${branchId}`,
} as const;

export interface QueueTicketPayload {
  id: string;
  queueId: string;
  branchId: string;
  ticketNumber: string; // e.g. "A-013"
  status: TicketStatus;
  priority: TicketPriority;
  patientId: string;
  patientName: string;
  doctorUserId: string | null;
  doctorName: string | null;
  roomNumber: string | null;
  position: number;
  createdAt: string;
  calledAt: string | null;
}

export interface QueueStatsPayload {
  branchId: string;
  waiting: number;
  avgWaitMin: number;
  perDoctor: Array<{
    doctorUserId: string;
    doctorName: string;
    waiting: number;
    inRoom: number;
    doneToday: number;
  }>;
}

export interface AppointmentPayload {
  id: string;
  branchId: string;
  doctorUserId: string;
  patientId: string;
  patientName: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
}

export interface InAppNotificationPayload {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}

export interface LabOrderPayload {
  id: string;
  branchId: string;
  orderNumber: string;
  patientId: string;
  patientName: string;
  status: LabOrderStatus;
  itemCount: number;
  orderedAt: string;
}

export interface ServerToClientEvents {
  'queue.ticket.created': (p: { ticket: QueueTicketPayload }) => void;
  'queue.ticket.updated': (p: { ticket: QueueTicketPayload }) => void;
  'queue.ticket.called': (p: {
    ticket: QueueTicketPayload;
    room: string | null;
    repeat: boolean;
  }) => void;
  'queue.snapshot': (p: { branchId: string; tickets: QueueTicketPayload[] }) => void;
  'queue.stats.updated': (p: QueueStatsPayload) => void;
  'appointment.updated': (p: { appointment: AppointmentPayload }) => void;
  'notification.new': (p: { notification: InAppNotificationPayload }) => void;
  'lab.order.updated': (p: { order: LabOrderPayload }) => void;
  'invoice.paid': (p: { invoiceId: string; amount: string; branchId: string }) => void;
}

export interface ClientToServerEvents {
  'queue.subscribe': (
    p: { branchId: string },
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  'queue.callNext': (
    p: { queueId: string },
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  'queue.finish': (
    p: { ticketId: string },
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  'queue.skip': (
    p: { ticketId: string },
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  'queue.recall': (
    p: { ticketId: string },
    ack?: (res: { ok: boolean; error?: string }) => void,
  ) => void;
}

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];
