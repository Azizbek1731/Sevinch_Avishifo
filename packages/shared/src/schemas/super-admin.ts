import { z } from 'zod';
import { ClinicStatus, SubscriptionStatus } from '../enums';
import { idSchema, moneySchema, paginationQuerySchema, phoneSchema } from './common';

export const createClinicWithOwnerSchema = z.object({
  clinic: z.object({
    name: z.string().min(1),
    legalName: z.string().min(1).optional(),
    phone: phoneSchema.optional(),
    email: z.string().email().optional(),
  }),
  owner: z.object({
    fullName: z.string().min(1),
    phone: phoneSchema,
    email: z.string().email().optional(),
    password: z.string().min(8),
  }),
  /** SubscriptionPlan.code, e.g. "starter". */
  planCode: z.string().min(1).optional(),
});
export type CreateClinicWithOwnerInput = z.infer<typeof createClinicWithOwnerSchema>;

export const updateClinicStatusSchema = z.object({
  status: z.nativeEnum(ClinicStatus),
});
export type UpdateClinicStatusInput = z.infer<typeof updateClinicStatusSchema>;

export const planUpsertSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  priceMonthly: moneySchema,
  maxBranches: z.number().int().min(1),
  maxUsers: z.number().int().min(1),
  /** Enabled module keys, e.g. ["lab","portal","telegram","analytics"]. */
  modules: z.array(z.string().min(1)),
});
export type PlanUpsertInput = z.infer<typeof planUpsertSchema>;

export const assignPlanSchema = z.object({
  planId: idSchema,
  status: z.nativeEnum(SubscriptionStatus).optional(),
});
export type AssignPlanInput = z.infer<typeof assignPlanSchema>;

export const featureFlagSetSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
});
export type FeatureFlagSetInput = z.infer<typeof featureFlagSetSchema>;

export const clinicListQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1).optional(),
  status: z.nativeEnum(ClinicStatus).optional(),
});
export type ClinicListQueryInput = z.infer<typeof clinicListQuerySchema>;
