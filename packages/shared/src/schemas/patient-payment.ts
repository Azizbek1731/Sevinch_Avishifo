import { z } from 'zod';
import { idSchema, moneySchema, paginationQuerySchema } from './common';
import { paymentSplitSchema } from './billing';

export const patientPendingQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
});
export const patientCheckoutSchema = z.object({
  patientId: idSchema,
  invoiceIds: z
    .array(idSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate invoice'),
  expectedTotal: moneySchema.refine((value) => {
    const [whole] = value.split('.');
    return (whole ?? '').replace(/^0+/, '').length <= 12;
  }, 'Payment total is too large'),
  payments: paymentSplitSchema,
  idempotencyKey: z.string().uuid(),
});
export type PatientCheckoutInput = z.infer<typeof patientCheckoutSchema>;
export type PatientPendingQueryInput = z.infer<typeof patientPendingQuerySchema>;
