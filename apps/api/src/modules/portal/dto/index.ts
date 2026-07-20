import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  idSchema,
  paginationQuerySchema,
  portalBookSchema,
  portalCancelAppointmentSchema,
  portalRequestOtpSchema,
  portalUpdateProfileSchema,
  portalVerifyOtpSchema,
  slotsQuerySchema,
} from '@avishifo/shared';

export class PortalRequestOtpDto extends createZodDto(portalRequestOtpSchema) {}
export class PortalVerifyOtpDto extends createZodDto(portalVerifyOtpSchema) {}
export class PortalCancelAppointmentDto extends createZodDto(portalCancelAppointmentSchema) {}
export class PortalUpdateProfileDto extends createZodDto(portalUpdateProfileSchema) {}

/**
 * Local extension of the shared booking schema (spec §M14): names are needed
 * only when the phone has no patient card in the clinic yet — the service
 * enforces that with a VALIDATION_ERROR, so they stay optional here.
 */
const portalBookExtendedSchema = portalBookSchema.extend({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
});
export type PortalBookExtendedInput = z.infer<typeof portalBookExtendedSchema>;
export class PortalBookDto extends createZodDto(portalBookExtendedSchema) {}

/** Public slots lookup needs the tenant explicitly — portal requests carry no clinic context. */
const portalSlotsQuerySchema = slotsQuerySchema.extend({ clinicId: idSchema });
export class PortalSlotsQueryDto extends createZodDto(portalSlotsQuerySchema) {}

const portalAppointmentsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});
export type PortalAppointmentsQueryInput = z.infer<typeof portalAppointmentsQuerySchema>;
export class PortalAppointmentsQueryDto extends createZodDto(portalAppointmentsQuerySchema) {}

/** Plain page/limit query for the cabinet lists (visits, lab results, invoices). */
export class PortalListQueryDto extends createZodDto(paginationQuerySchema) {}

const portalFeedbackSchema = z.object({
  visitId: idSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});
export type PortalFeedbackInput = z.infer<typeof portalFeedbackSchema>;
export class PortalFeedbackDto extends createZodDto(portalFeedbackSchema) {}
