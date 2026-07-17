import { z } from 'zod';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';

export const submitFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  visitId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const feedbackQuerySchema = paginationQuerySchema.extend({
  doctorUserId: idSchema.optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  maxRating: z.coerce.number().int().min(1).max(5).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type FeedbackQueryInput = z.infer<typeof feedbackQuerySchema>;
