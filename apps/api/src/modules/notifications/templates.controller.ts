import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { NotificationsService } from './notifications.service';
import { type TemplateResponse } from './notifications.service';
import { ListQueryDto, TemplateUpsertDto } from './dto';

/**
 * M13 — per-clinic notification template management. Upsert is keyed by
 * (event, channel, locale); delivery falls back to built-in uz/ru templates
 * when a clinic has no row.
 */
@ApiTags('notifications')
@Controller('notification-templates')
export class TemplatesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications.templates.read')
  list(@Query() query: ListQueryDto): Promise<PaginatedResult<TemplateResponse>> {
    return this.notifications.listTemplates(query);
  }

  @Put()
  @RequirePermissions('notifications.templates.write')
  upsert(@Body() dto: TemplateUpsertDto): Promise<TemplateResponse> {
    return this.notifications.upsertTemplate(dto);
  }
}
