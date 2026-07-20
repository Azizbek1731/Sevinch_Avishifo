import { z } from 'zod';
import { Gender, Locale } from '../enums';
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

/** ISO calendar date "YYYY-MM-DD" (patient DOB in the portal profile). */
export const portalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Sana YYYY-MM-DD ko‘rinishida bo‘lishi kerak' });

/**
 * Patient portal profile update (spec §M14). Every field is optional so the
 * same endpoint powers both registration completion (name capture) and later
 * edits; the service ignores empty strings and requires at least one field.
 */
export const portalUpdateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
    dob: portalDateSchema.optional(),
    gender: z.nativeEnum(Gender).optional(),
    preferredLocale: z.nativeEnum(Locale).optional(),
    notifyAppointments: z.boolean().optional(),
    notifyResults: z.boolean().optional(),
    notifyPayments: z.boolean().optional(),
    notifyPromos: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Kamida bitta maydon yuborilishi kerak',
  });
export type PortalUpdateProfileInput = z.infer<typeof portalUpdateProfileSchema>;
