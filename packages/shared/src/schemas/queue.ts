import { z } from 'zod';
import { QueueKind, TicketPriority } from '../enums';
import { dateOnlySchema, idSchema } from './common';

export const enqueueSchema = z.object({
  patientId: idSchema,
  branchId: idSchema,
  doctorUserId: idSchema.optional(),
  kind: z.nativeEnum(QueueKind).default(QueueKind.DOCTOR),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.NORMAL),
  appointmentId: idSchema.optional(),
});
export type EnqueueInput = z.infer<typeof enqueueSchema>;

export const reorderTicketSchema = z.object({
  position: z.number().int().min(0),
});
export type ReorderTicketInput = z.infer<typeof reorderTicketSchema>;

export const transferTicketSchema = z.object({
  targetDoctorUserId: idSchema,
});
export type TransferTicketInput = z.infer<typeof transferTicketSchema>;

export const queueQuerySchema = z.object({
  branchId: idSchema,
  date: dateOnlySchema.optional(),
  doctorUserId: idSchema.optional(),
});
export type QueueQueryInput = z.infer<typeof queueQuerySchema>;

export const callNextSchema = z.object({
  queueId: idSchema,
});
export type CallNextInput = z.infer<typeof callNextSchema>;
