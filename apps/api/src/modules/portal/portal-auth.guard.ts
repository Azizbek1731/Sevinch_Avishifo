import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@avishifo/shared';
import type { Request } from 'express';
import { AppException } from '../../common/app.exception';

export interface PortalRequest extends Request {
  /** OTP-verified patient phone (+998XXXXXXXXX), set by PortalAuthGuard. */
  portalPhone?: string;
}

/** Portal JWT payload: { typ: 'portal', sub: phone, sid: uuid }. */
interface PortalTokenPayload {
  typ?: unknown;
  sub?: unknown;
  sid?: unknown;
}

/**
 * Local guard for the patient portal (spec §M14). Portal routes are marked
 * @Public() so the global JwtAuthGuard (which only accepts staff tokens)
 * skips them; this guard then verifies the portal-issued patient JWT.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PortalRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Portal access token required', 401);
    }

    let payload: PortalTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<PortalTokenPayload>(token);
    } catch {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired portal token', 401);
    }
    if (payload.typ !== 'portal' || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid portal token', 401);
    }

    req.portalPhone = payload.sub;
    return true;
  }
}

/** Injects the OTP-verified portal phone attached by PortalAuthGuard. */
export const PortalPhone = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<PortalRequest>();
  if (!req.portalPhone) {
    throw new AppException(ErrorCode.UNAUTHORIZED, 'Not authenticated', 401);
  }
  return req.portalPhone;
});
