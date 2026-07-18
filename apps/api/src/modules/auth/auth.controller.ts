import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, Public } from '../../common/decorators';
import { paginated, type PaginatedResult } from '../../common/pagination';
import { AppConfigService } from '../../core/config/app-config.service';
import { AuthService } from './auth.service';
import {
  type MeResult,
  type SessionItem,
} from './auth.service';
import { TokenService } from './token.service';
import { REFRESH_COOKIE } from './token.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RequestPasswordResetDto, ResetPasswordWithOtpDto } from './dto/auth.dto';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------------ login

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser; accessToken: string }> {
    const { user, accessToken, refreshToken } = await this.auth.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return { user, accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const presented = this.readRefreshCookie(req) ?? dto.refreshToken;
    const { accessToken, refreshToken } = await this.auth.refresh(presented);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: true }> {
    const result = await this.auth.logout(user);
    this.clearRefreshCookie(res);
    return result;
  }

  // --------------------------------------------------------------------- me

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResult> {
    return this.auth.me(user);
  }

  // --------------------------------------------------------------- sessions

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser): Promise<PaginatedResult<SessionItem>> {
    const items = await this.auth.listSessions(user);
    return paginated(items, { page: 1, limit: Math.max(items.length, 1), total: items.length });
  }

  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ revoked: true }> {
    return this.auth.revokeSession(user, id);
  }

  // -------------------------------------------------------- change password

  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ changed: true }> {
    return this.auth.changePassword(user, dto);
  }

  // ---------------------------------------------------------- password reset

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password-reset/request')
  @HttpCode(200)
  requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<{ requested: true }> {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password-reset/confirm')
  @HttpCode(200)
  confirmPasswordReset(@Body() dto: ResetPasswordWithOtpDto): Promise<{ reset: true }> {
    return this.auth.confirmPasswordReset(dto);
  }

  // ---------------------------------------------------------------- cookies

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      // Scoped to the auth endpoints only — the browser never sends the refresh
      // token to any other route.
      path: '/api/v1/auth',
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.tokens.refreshTtlMs,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private readRefreshCookie(req: Request): string | undefined {
    // cookie-parser types cookies as Record<string, any> — narrow via unknown.
    const cookies: unknown = req.cookies;
    if (cookies && typeof cookies === 'object') {
      const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  }
}
