import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type JwtPayload } from '@avishifo/shared';
import { AppException } from '../app.exception';
import { IS_PUBLIC_KEY, type RequestWithUser } from '../decorators';
import { PrincipalService } from '../../core/principal/principal.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly principal: PrincipalService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new AppException(ErrorCode.UNAUTHORIZED, 'Missing access token', 401);

    const payload: JwtPayload = await this.principal.verifyToken(token);
    req.user = await this.principal.buildAuthUser(payload);
    return true;
  }
}
