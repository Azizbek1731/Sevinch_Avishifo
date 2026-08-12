import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AiAnswer, AiCapabilities, AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AiService } from './ai.service';
import { AiAskDto } from './dto';

/** Model calls cost money and take seconds — this is not an endpoint to spam. */
const AI_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** What the assistant can do for this particular caller. */
  @Get('capabilities')
  @RequirePermissions('ai.use')
  capabilities(@CurrentUser() user: AuthUser): AiCapabilities {
    return this.ai.capabilities(user);
  }

  @Post('ask')
  @RequirePermissions('ai.use')
  @Throttle(AI_THROTTLE)
  @HttpCode(200)
  ask(@Body() dto: AiAskDto, @CurrentUser() user: AuthUser): Promise<AiAnswer> {
    return this.ai.ask(dto, user);
  }
}
