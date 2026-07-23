import { z } from 'zod';
import { Locale, RoomType } from '../enums';
import { phoneSchema, timeHmSchema } from './common';

/**
 * Clinic logo — an https URL or an inline `data:image/...` URI (so a clinic can
 * upload a logo without a separate file host). Empty string clears the logo.
 * Capped at ~600 KB of base64 to keep the DB row and the receipt payload small.
 */
export const logoUrlSchema = z
  .string()
  .max(800_000)
  .refine(
    (v) =>
      v === '' ||
      /^https?:\/\//i.test(v) ||
      /^data:image\/(png|jpe?g|webp|svg\+xml|gif);/i.test(v),
    { message: 'logoUrl must be an http(s) URL or a data:image URI' },
  );

/** Treat '' / null as "not provided" so an empty <Select> never blocks a save. */
const blankToUndefined = (v: unknown): unknown => (v === '' || v === null ? undefined : v);

export const updateClinicSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().min(1).optional(),
  taxId: z.string().min(1).optional(),
  logoUrl: logoUrlSchema.optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  address: z.string().min(1).optional(),
  defaultLocale: z.preprocess(blankToUndefined, z.nativeEnum(Locale).optional()),
  smsSenderName: z.string().min(1).optional(),
});
export type UpdateClinicInput = z.infer<typeof updateClinicSchema>;

/**
 * Receipt (chek) template customization — stored under Clinic.settings.receipt.
 * Every field is optional; the frontend falls back to sensible defaults.
 */
export const receiptSettingsSchema = z.object({
  /** Thermal paper width in mm. */
  paperWidth: z.enum(['58', '80']).optional(),
  /** Base font size of the receipt body. */
  fontScale: z.enum(['sm', 'md', 'lg']).optional(),
  /** Print the clinic logo at the top of the receipt. */
  showLogo: z.boolean().optional(),
  /** Extra line printed under the clinic name (e.g. a slogan or licence no.). */
  headerText: z.string().max(200).optional(),
  /** Footer line printed at the bottom (replaces the default "thanks" line). */
  footerText: z.string().max(300).optional(),
  showTaxId: z.boolean().optional(),
  showCashier: z.boolean().optional(),
  showPatientMrn: z.boolean().optional(),
  showBranch: z.boolean().optional(),
});
export type ReceiptSettingsInput = z.infer<typeof receiptSettingsSchema>;

/** Clinic.settings JSON — partial patch of free-form clinic settings. */
export const clinicSettingsSchema = z.object({
  invoiceNumberFormat: z.string().min(1).optional(),
  vatRate: z.number().min(0).max(100).optional(),
  visitLockHours: z.number().int().min(0).optional(),
  doctorPatientAccess: z.preprocess(blankToUndefined, z.enum(['own', 'branch']).optional()),
  queueAutoRecallPosition: z.number().int().min(0).optional(),
  receipt: receiptSettingsSchema.optional(),
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
