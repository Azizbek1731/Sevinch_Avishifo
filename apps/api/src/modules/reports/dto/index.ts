import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  labReferralReportQuerySchema,
  cashflowQuerySchema,
  consumablesQuerySchema,
  idSchema,
  reportRangeQuerySchema,
} from '@avishifo/shared';

export class ConsumablesQueryDto extends createZodDto(consumablesQuerySchema) {}

export class CashflowQueryDto extends createZodDto(cashflowQuerySchema) {}

/** `?export=xlsx` switches any report endpoint to an XLSX download. */
const exportFlagSchema = z.enum(['xlsx']).optional();

const exportableRangeSchema = reportRangeQuerySchema.extend({ export: exportFlagSchema });
export type ReportRangeQuery = z.infer<typeof exportableRangeSchema>;
export class ReportRangeQueryDto extends createZodDto(exportableRangeSchema) {}

const dashboardQuerySchema = z.object({
  branchId: idSchema.optional(),
  export: exportFlagSchema,
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}

export const REVENUE_DIMENSIONS = ['time', 'category', 'doctor', 'method'] as const;
export type RevenueDimension = (typeof REVENUE_DIMENSIONS)[number];

const revenueQuerySchema = exportableRangeSchema.extend({
  dimension: z.enum(REVENUE_DIMENSIONS).default('time'),
});
export type RevenueQuery = z.infer<typeof revenueQuerySchema>;
export class RevenueQueryDto extends createZodDto(revenueQuerySchema) {}

export class LabReferralReportQueryDto extends createZodDto(labReferralReportQuerySchema) {}
