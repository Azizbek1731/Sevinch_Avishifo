import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';

export const clinicalOrderKindSchema = z.enum(['CONSULTATION', 'ULTRASOUND']);
export type ClinicalOrderKind = z.infer<typeof clinicalOrderKindSchema>;

export const createClinicalOrderSchema = z.object({
  patientId: idSchema,
  branchId: idSchema,
  doctorUserId: idSchema,
  kind: clinicalOrderKindSchema,
  serviceIds: z
    .array(idSchema)
    .min(1)
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length),
  note: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().uuid(),
});
export type CreateClinicalOrderInput = z.infer<typeof createClinicalOrderSchema>;

export const addClinicalServicesSchema = createClinicalOrderSchema.pick({
  serviceIds: true,
  idempotencyKey: true,
});
export type AddClinicalServicesInput = z.infer<typeof addClinicalServicesSchema>;

export const clinicalOrderQuerySchema = paginationQuerySchema.extend({
  kind: clinicalOrderKindSchema.optional(),
  patientId: idSchema.optional(),
  visitId: idSchema.optional(),
  status: z.enum(['WAITING_PAYMENT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  search: z.string().trim().max(100).optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ClinicalOrderQueryInput = z.infer<typeof clinicalOrderQuerySchema>;
