import { z } from 'zod';
import { Locale, RoomType } from '../enums';
import { phoneSchema, timeHmSchema } from './common';

export const updateClinicSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().min(1).optional(),
  taxId: z.string().min(1).optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  address: z.string().min(1).optional(),
  defaultLocale: z.nativeEnum(Locale).optional(),
  smsSenderName: z.string().min(1).optional(),
});
export type UpdateClinicInput = z.infer<typeof updateClinicSchema>;

/** Clinic.settings JSON — partial patch of free-form clinic settings. */
export const clinicSettingsSchema = z.object({
  invoiceNumberFormat: z.string().min(1).optional(),
  vatRate: z.number().min(0).max(100).optional(),
  visitLockHours: z.number().int().min(0).optional(),
  doctorPatientAccess: z.enum(['own', 'branch']).optional(),
  queueAutoRecallPosition: z.number().int().min(0).optional(),
});
export type ClinicSettingsInput = z.infer<typeof clinicSettingsSchema>;

/** Branch.workingHours JSON row. */
export const workingHoursItemSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  open: timeHmSchema,
  close: timeHmSchema,
  closed: z.boolean().optional(),
});
export type WorkingHoursItemInput = z.infer<typeof workingHoursItemSchema>;

export const createBranchSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1).optional(),
  phone: phoneSchema.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  workingHours: z.array(workingHoursItemSchema).default([]),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema.partial();
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const createRoomSchema = z.object({
  number: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.nativeEnum(RoomType).default(RoomType.CONSULTATION),
  specialties: z.array(z.string().min(1)).default([]),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = createRoomSchema.partial();
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
