import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { FeedbackService } from './feedback.service';
import { FeedbackQueryDto, FeedbackStatsQueryDto, FeedbackVisibilityDto, PublicFeedbackDto, SubmitFeedbackDto } from './dto';

@ApiTags('feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** Tokened post-visit rating link (SMS/Telegram) — no auth. */
  @Post('public')
  @Public()
  submitPublic(@Body() dto: PublicFeedbackDto): Promise<Record<string, unknown>> {
    return this.feedback.submitPublic(dto);
  }

  /** Staff on-behalf / portal submission. Any authenticated user. */
  @Post()
  submit(
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.feedback.submit(dto, user);
  }

  @Get()
  @RequirePermissions('feedback.read')
  list(@Query() query: FeedbackQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.feedback.list(query);
  }

  @Get('stats')
  @RequirePermissions('feedback.read')
  stats(@Query() query: FeedbackStatsQueryDto): Promise<Record<string, unknown>> {
    return this.feedback.stats(query);
  }

  /** Signed feedback token + link path for a visit, for staff to copy/send. */
  @Get('token/:visitId')
  @RequirePermissions('visits.write')
  issueToken(@Param('visitId') visitId: string): Promise<{ token: string; link: string }> {
    return this.feedback.issueToken(visitId);
  }

  /** Toggle public display (portal reputation) of a feedback entry. */
  @Patch(':id/visibility')
  @RequirePermissions('clinic.settings.write')
  setVisibility(
    @Param('id') id: string,
    @Body() dto: FeedbackVisibilityDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.feedback.setVisibility(id, dto, user);
  }
}
