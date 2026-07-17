import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type Permission } from '@avishifo/shared';
import { AppException } from '../app.exception';
import { PERMISSIONS_KEY, type RequestWithUser } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;
    if (!user) return true; // public route — nothing to check

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new AppException(ErrorCode.FORBIDDEN, `Missing permission: ${missing.join(', ')}`, 403);
    }
    return true;
  }
}
