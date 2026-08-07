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
import { AllowWhenExpired, CurrentUser, Public } from '../../common/decorators';
import { paginated, type PaginatedResult } from '../../common/pagination';
import { AppConfigService } from '../../core/config/app-config.service';
import { AuthService, isTwoFactorPending, type TwoFactorPendingResult } from './auth.service';

/** Either a signed-in session or a pending second-factor challenge. */
type LoginHttpResponse = { user: AuthUser; accessToken: string } | TwoFactorPendingResult;
import {
  type MeResult,
  type SessionItem,
} from './auth.service';
import { TokenService } from './token.service';
import { REFRESH_COOKIE } from './token.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterClinicDto,
  RequestPasswordResetDto,
  ResetPasswordWithOtpDto,
  SetTwoFactorDto,
  VerifyTwoFactorDto,
} from './dto/auth.dto';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
/** Sign-up creates a tenant — far stricter than a login attempt. */
const SIGNUP_THROTTLE = { default: { limit: 3, ttl: 3_600_000 } };

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
  ): Promise<LoginHttpResponse> {
    const result = await this.auth.login(dto);
    // Two-factor accounts get a challenge instead of a session; no cookie is
    // set until the code is verified.
    if (isTwoFactorPending(result)) return result;
    this.setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  /** Second step of a two-factor login — exchanges the Telegram code for a session. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('two-factor/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body() dto: VerifyTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser; accessToken: string }> {
    const { user, accessToken, refreshToken } = await this.auth.verifyTwoFactor(dto);
    this.setRefreshCookie(res, refreshToken);
    return { user, accessToken };
  }

  /** Turn the Telegram second factor on or off for the signed-in user. */
  @Post('two-factor')
  @HttpCode(200)
  setTwoFactor(
    @Body() dto: SetTwoFactorDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ twoFactorEnabled: boolean }> {
    return this.auth.setTwoFactor(user.id, dto.enabled);
  }

  // ---------------------------------------------------------------- sign-up

  /**
   * Public clinic sign-up — creates the clinic, its owner and a free trial,
   * then signs the director in. Throttled harder than login: every call that
   * gets through mints a whole tenant.
   */
  @Public()
  @Throttle(SIGNUP_THROTTLE)
  @Post('register-clinic')
  @HttpCode(201)
  async registerClinic(
    @Body() dto: RegisterClinicDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser; accessToken: string; trialEndsAt: string | null }> {
    const { user, accessToken, refreshToken, trialEndsAt } =
      await this.auth.registerClinic(dto);
    this.setRefreshCookie(res, refreshToken);
    return { user, accessToken, trialEndsAt };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    // Token normally rides in the httpOnly cookie; the body is an optional
    // fallback for non-browser clients. No DTO/validation here — an empty body
    // (the browser's usual case) must not be rejected.
    const bodyToken = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    const presented =
      this.readRefreshCookie(req) ?? (typeof bodyToken === 'string' ? bodyToken : undefined);
    const { accessToken, refreshToken } = await this.auth.refresh(presented);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @AllowWhenExpired()
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
  @AllowWhenExpired()
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
