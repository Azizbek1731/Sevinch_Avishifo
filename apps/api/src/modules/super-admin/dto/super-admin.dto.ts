import { createZodDto } from 'nestjs-zod';
import {
  assignPlanSchema,
  clinicListQuerySchema,
  createClinicWithOwnerSchema,
  featureFlagSetSchema,
  planUpsertSchema,
  updateClinicStatusSchema,
  updateSubscriptionSchema,
} from '@avishifo/shared';

/** POST /platform/clinics — clinic + first branch + owner + trial subscription. */
export class CreateClinicWithOwnerDto extends createZodDto(createClinicWithOwnerSchema) {}

/** GET /platform/clinics query filters. */
export class ClinicListQueryDto extends createZodDto(clinicListQuerySchema) {}

/** PATCH /platform/clinics/:id/status — suspend/activate/archive. */
export class UpdateClinicStatusDto extends createZodDto(updateClinicStatusSchema) {}

/** POST /platform/plans — create or update a plan by its unique code. */
export class PlanUpsertDto extends createZodDto(planUpsertSchema) {}

/** PATCH /platform/plans/:id — partial plan update. */
export class PlanUpdateDto extends createZodDto(planUpsertSchema.partial()) {}

/** POST /platform/clinics/:id/plan — assign a subscription plan. */
export class AssignPlanDto extends createZodDto(assignPlanSchema) {}
export class UpdateSubscriptionDto extends createZodDto(updateSubscriptionSchema) {}

/** PUT /platform/clinics/:id/feature-flags — upsert one flag. */
export class FeatureFlagSetDto extends createZodDto(featureFlagSetSchema) {}
