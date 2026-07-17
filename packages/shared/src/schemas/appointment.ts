import { z } from 'zod';
import { AppointmentStatus } from '../enums';
import { dateOnlySchema, idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';

export const createAppointmentSchema = z.object({
  patientId: idSchema,
  branchId: idSchema,
  doctorUserId: idSchema,
  roomId: idSchema.optional(),
  startAt: isoDateTimeSchema,
  serviceIds: z.array(idSchema).optional(),
  note: z.string().optional(),
  /** Walk-in: create the appointment and enqueue in one action. */
  walkIn: z.boolean().optional(),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z.object({
  startAt: isoDateTimeSchema.optional(),
  roomId: idSchema.optional(),
  note: z.string().optional(),
  serviceIds: z.array(idSchema).optional(),
});
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const changeAppointmentStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
  /** Required by business rules for CANCELLED / NO_SHOW. */
  reason: z.string().min(1).optional(),
});
export type ChangeAppointmentStatusInput = z.infer<typeof changeAppointmentStatusSchema>;

export const appointmentQuerySchema = paginationQuerySchema.extend({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  branchId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
  patientId: idSchema.optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
});
export type AppointmentQueryInput = z.infer<typeof appointmentQuerySchema>;

export const slotsQuerySchema = z.object({
  doctorUserId: idSchema,
  date: dateOnlySchema,
  branchId: idSchema,
  serviceId: idSchema.optional(),
});
export type SlotsQueryInput = z.infer<typeof slotsQuerySchema>;

/** Recurring course, e.g. physiotherapy: N sessions every M days. */
export const createRecurringAppointmentSchema = createAppointmentSchema.extend({
  sessionsCount: z.number().int().min(2).max(50),
  intervalDays: z.number().int().min(1).max(30),
});
export type CreateRecurringAppointmentInput = z.infer<typeof createRecurringAppointmentSchema>;
