import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { NotificationsService } from './notifications.service';
import {
  type InboxItemResponse,
  type InboxResponse,
  type NotificationLogResponse,
} from './notifications.service';
import { ListQueryDto, NotificationLogQueryDto, SendTestDto } from './dto';

/**
 * M13 — delivery log, test sends and the per-user in-app notification center.
 * Inbox endpoints are available to every authenticated staff user (own rows
 * only); log/test endpoints are permission-gated.
 */
@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notification-logs')
  @RequirePermissions('notifications.templates.read')
  listLogs(@Query() query: NotificationLogQueryDto): Promise<PaginatedResult<NotificationLogResponse>> {
    return this.notifications.listLogs(query);
  }

  @Post('notifications/test')
  @RequirePermissions('notifications.send')
  sendTest(@Body() dto: SendTestDto, @CurrentUser() user: AuthUser): Promise<{ delivered: boolean }> {
    return this.notifications.sendTest(dto, user);
  }

  // ------------------------------------------------------------ in-app inbox

  @Get('notifications/inbox')
  inbox(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto): Promise<InboxResponse> {
    return this.notifications.getInbox(user.id, query);
  }

  @Post('notifications/inbox/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InboxItemResponse> {
    return this.notifications.markRead(user.id, id);
  }

  @Post('notifications/inbox/read-all')
  markAllRead(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }
}
