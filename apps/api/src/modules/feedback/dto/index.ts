import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { feedbackQuerySchema, isoDateTimeSchema, submitFeedbackSchema } from '@avishifo/shared';

/**
 * Public post-visit rating submission. `token` is the signed feedback JWT
 * ({ typ: 'feedback', visitId, clinicId }) delivered by SMS/Telegram link —
 * no shared schema exists for it (backend-only payload), defined locally.
 */
export const publicFeedbackSchema = z.object({
  token: z.string().min(10),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

/** Optional date range for the ratings dashboard aggregates. */
export const feedbackStatsQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

/** Toggle public display of a feedback entry (portal reputation). */
export const feedbackVisibilitySchema = z.object({
  isPublic: z.boolean(),
});

export class PublicFeedbackDto extends createZodDto(publicFeedbackSchema) {}
export class SubmitFeedbackDto extends createZodDto(submitFeedbackSchema) {}
export class FeedbackQueryDto extends createZodDto(feedbackQuerySchema) {}
export class FeedbackStatsQueryDto extends createZodDto(feedbackStatsQuerySchema) {}
export class FeedbackVisibilityDto extends createZodDto(feedbackVisibilitySchema) {}
