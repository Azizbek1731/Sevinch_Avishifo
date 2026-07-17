import { z } from 'zod';
import { CompensationType, ScheduleExceptionType } from '../enums';
import { dateOnlySchema, idSchema, isoDateTimeSchema, moneySchema, timeHmSchema } from './common';

export const upsertStaffProfileSchema = z.object({
  specialty: z.string().min(1).optional(),
  licenseNo: z.string().min(1).optional(),
  hireDate: dateOnlySchema.optional(),
  bio: z.string().optional(),
  /** Default appointment slot length (overrides service duration). */
  slotMinutes: z.number().int().min(5).max(120).optional(),
});
export type UpsertStaffProfileInput = z.infer<typeof upsertStaffProfileSchema>;

/** Replaces the doctor's whole weekly template for the branch. */
export const setDoctorScheduleSchema = z.object({
  branchId: idSchema,
  items: z.array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      startTime: timeHmSchema,
      endTime: timeHmSchema,
      slotMinutes: z.number().int().min(5).max(120).default(15),
    }),
  ),
});
export type SetDoctorScheduleInput = z.infer<typeof setDoctorScheduleSchema>;

export const addScheduleExceptionSchema = z.object({
  type: z.nativeEnum(ScheduleExceptionType),
  dateFrom: dateOnlySchema,
  dateTo: dateOnlySchema,
  /** For CUSTOM_HOURS: replacement window. */
  startTime: timeHmSchema.optional(),
  endTime: timeHmSchema.optional(),
  note: z.string().optional(),
});
export type AddScheduleExceptionInput = z.infer<typeof addScheduleExceptionSchema>;

export const compensationRuleUpsertSchema = z.object({
  doctorUserId: idSchema,
  type: z.nativeEnum(CompensationType),
  /** FIXED_SALARY: monthly amount; REVENUE_PERCENT: 0-100; PER_SERVICE_FEE: fee. */
  value: moneySchema,
  serviceId: idSchema.optional(),
  serviceCategoryId: idSchema.optional(),
  effectiveFrom: isoDateTimeSchema,
});
export type CompensationRuleUpsertInput = z.infer<typeof compensationRuleUpsertSchema>;

export const payrollQuerySchema = z.object({
  /** Accrual period, e.g. "2026-07". */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  doctorUserId: idSchema.optional(),
});
export type PayrollQueryInput = z.infer<typeof payrollQuerySchema>;

export const kpiQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  doctorUserId: idSchema.optional(),
});
export type KpiQueryInput = z.infer<typeof kpiQuerySchema>;
