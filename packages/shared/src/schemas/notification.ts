import { z } from 'zod';
import { Locale, NotificationChannel, NotificationEvent, NotificationStatus } from '../enums';
import { isoDateTimeSchema, paginationQuerySchema } from './common';

export const templateUpsertSchema = z.object({
  event: z.nativeEnum(NotificationEvent),
  channel: z.nativeEnum(NotificationChannel),
  locale: z.nativeEnum(Locale),
  /** Body with {{variables}}, e.g. {{patient_name}}, {{time}}, {{clinic_name}}. */
  body: z.string().min(3),
});
export type TemplateUpsertInput = z.infer<typeof templateUpsertSchema>;

export const notificationLogQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(NotificationStatus).optional(),
  channel: z.nativeEnum(NotificationChannel).optional(),
  event: z.nativeEnum(NotificationEvent).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type NotificationLogQueryInput = z.infer<typeof notificationLogQuerySchema>;

export const sendTestSchema = z.object({
  channel: z.nativeEnum(NotificationChannel),
  /** Phone or telegram chat id. */
  recipient: z.string().min(1),
  body: z.string().min(1),
});
export type SendTestInput = z.infer<typeof sendTestSchema>;
