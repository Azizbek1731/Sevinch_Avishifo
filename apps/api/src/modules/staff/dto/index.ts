import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  UserRole,
  addScheduleExceptionSchema,
  compensationRuleUpsertSchema,
  idSchema,
  isoDateTimeSchema,
  kpiQuerySchema,
  paginationQuerySchema,
  payrollQuerySchema,
  setDoctorScheduleSchema,
  signedMoneySchema,
  upsertStaffProfileSchema,
} from '@avishifo/shared';

// ------------------------------------------------------------- shared schemas

export class UpsertStaffProfileDto extends createZodDto(upsertStaffProfileSchema) {}
export class SetDoctorScheduleDto extends createZodDto(setDoctorScheduleSchema) {}
export class AddScheduleExceptionDto extends createZodDto(addScheduleExceptionSchema) {}
export class CompensationRuleUpsertDto extends createZodDto(compensationRuleUpsertSchema) {}
export class KpiQueryDto extends createZodDto(kpiQuerySchema) {}

// ------------------------------------------------------------- local schemas

/** Staff directory filters (spec §M11): specialty / role / branch + text search. */
const staffDirectoryQuerySchema = paginationQuerySchema.extend({
  role: z.nativeEnum(UserRole).optional(),
  specialty: z.string().min(1).optional(),
  branchId: idSchema.optional(),
  search: z.string().min(1).optional(),
});
export class StaffDirectoryQueryDto extends createZodDto(staffDirectoryQuerySchema) {}
export type StaffDirectoryQuery = z.infer<typeof staffDirectoryQuerySchema>;

const scheduleQuerySchema = z.object({
  branchId: idSchema.optional(),
});
export class ScheduleQueryDto extends createZodDto(scheduleQuerySchema) {}
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

const compensationRuleListQuerySchema = paginationQuerySchema.extend({
  doctorUserId: idSchema.optional(),
});
export class CompensationRuleListQueryDto extends createZodDto(compensationRuleListQuerySchema) {}
export type CompensationRuleListQuery = z.infer<typeof compensationRuleListQuerySchema>;

/** Partial update of an effective-dated rule (also allows closing via effectiveTo). */
const compensationRulePatchSchema = compensationRuleUpsertSchema
  .omit({ doctorUserId: true })
  .partial()
  .extend({ effectiveTo: isoDateTimeSchema.nullable().optional() });
export class CompensationRulePatchDto extends createZodDto(compensationRulePatchSchema) {}
export type CompensationRulePatch = z.infer<typeof compensationRulePatchSchema>;

const generateAccrualsQuerySchema = z.object({
  /** Accrual period, e.g. "2026-07". */
  period: z.string().regex(/^\d{4}-\d{2}$/),
});
export class GenerateAccrualsQueryDto extends createZodDto(generateAccrualsQuerySchema) {}

const payrollAccrualsQuerySchema = payrollQuerySchema.extend({
  export: z.enum(['xlsx']).optional(),
});
export class PayrollAccrualsQueryDto extends createZodDto(payrollAccrualsQuerySchema) {}
export type PayrollAccrualsQuery = z.infer<typeof payrollAccrualsQuerySchema>;

const accrualAdjustSchema = z.object({
  /** Signed decimal string, e.g. "-150000.00". */
  adjustment: signedMoneySchema,
  note: z.string().max(1000).optional(),
});
export class AccrualAdjustDto extends createZodDto(accrualAdjustSchema) {}
export type AccrualAdjustInput = z.infer<typeof accrualAdjustSchema>;
