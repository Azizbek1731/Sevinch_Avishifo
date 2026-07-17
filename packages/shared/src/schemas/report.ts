import { z } from 'zod';
import { dateOnlySchema, idSchema } from './common';

export const reportRangeQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  branchId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});
export type ReportRangeQueryInput = z.infer<typeof reportRangeQuerySchema>;

export const exportQuerySchema = reportRangeQuerySchema.extend({
  format: z.enum(['xlsx']).default('xlsx'),
});
export type ExportQueryInput = z.infer<typeof exportQuerySchema>;
