import { z } from 'zod';
import { idSchema, isoDateTimeSchema, phoneSchema } from './common';

export const portalRequestOtpSchema = z.object({
  phone: phoneSchema,
});
export type PortalRequestOtpInput = z.infer<typeof portalRequestOtpSchema>;

export const portalVerifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, { message: 'Code must be 6 digits' }),
});
export type PortalVerifyOtpInput = z.infer<typeof portalVerifyOtpSchema>;

export const portalBookSchema = z.object({
  branchId: idSchema,
  doctorUserId: idSchema,
  serviceId: idSchema.optional(),
  startAt: isoDateTimeSchema,
});
export type PortalBookInput = z.infer<typeof portalBookSchema>;

export const portalCancelAppointmentSchema = z.object({
  reason: z.string().optional(),
});
export type PortalCancelAppointmentInput = z.infer<typeof portalCancelAppointmentSchema>;
