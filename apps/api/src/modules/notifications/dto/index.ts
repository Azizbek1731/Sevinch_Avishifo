import { createZodDto } from 'nestjs-zod';
import {
  notificationLogQuerySchema,
  paginationQuerySchema,
  sendTestSchema,
  templateUpsertSchema,
} from '@avishifo/shared';

/** Generic pagination query (templates list, inbox). */
export class ListQueryDto extends createZodDto(paginationQuerySchema) {}

export class TemplateUpsertDto extends createZodDto(templateUpsertSchema) {}
export class NotificationLogQueryDto extends createZodDto(notificationLogQuerySchema) {}
export class SendTestDto extends createZodDto(sendTestSchema) {}
