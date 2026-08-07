import { z } from 'zod';
import { ClinicStatus, SubscriptionStatus } from '../enums';
import {
  idSchema,
  isoDateTimeSchema,
  moneySchema,
  paginationQuerySchema,
  phoneSchema,
} from './common';

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

/**
 * Edit the clinic's CURRENT subscription in place — extend or shorten a trial,
 * pin an exact end date, switch plan or status. Unlike assignPlan this never
 * cancels and re-creates the row, so `startsAt` and the history stay intact.
 * `endsAt` and `extendDays` are mutually exclusive; `endsAt: null` = perpetual.
 */
export const updateSubscriptionSchema = z
  .object({
    planId: idSchema.optional(),
    status: z.nativeEnum(SubscriptionStatus).optional(),
    endsAt: isoDateTimeSchema.nullable().optional(),
    /** Positive extends, negative shortens; applied to endsAt (or to now if lapsed). */
    extendDays: z.number().int().min(-3650).max(3650).optional(),
  })
  .refine((v) => v.endsAt === undefined || v.extendDays === undefined, {
    message: 'Use either endsAt or extendDays, not both',
    path: ['extendDays'],
  })
  .refine(
    (v) =>
      v.planId !== undefined ||
      v.status !== undefined ||
      v.endsAt !== undefined ||
      v.extendDays !== undefined,
    { message: 'Nothing to update', path: ['status'] },
  );
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

export const featureFlagSetSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
});
export type FeatureFlagSetInput = z.infer<typeof featureFlagSetSchema>;

/** Subscription-state buckets a super-admin filters the clinic list by. */
export const SUBSCRIPTION_FILTERS = ['trial', 'expiring', 'expired', 'paid'] as const;
export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number];

export const clinicListQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1).optional(),
  status: z.nativeEnum(ClinicStatus).optional(),
  /** trial | expiring (≤3 days left) | expired | paid */
  subscription: z.enum(SUBSCRIPTION_FILTERS).optional(),
});
export type ClinicListQueryInput = z.infer<typeof clinicListQuerySchema>;
