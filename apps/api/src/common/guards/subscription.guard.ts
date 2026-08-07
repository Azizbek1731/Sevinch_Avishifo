import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, UserRole } from '@avishifo/shared';
import { AppException } from '../app.exception';
import { ALLOW_WHEN_EXPIRED_KEY, IS_PUBLIC_KEY, type RequestWithUser } from '../decorators';
import { SubscriptionService } from '../../core/subscription/subscription.service';

/** Methods that only read — always allowed, which is what makes expiry read-only. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Degrades a clinic to READ-ONLY once its trial/subscription end date passes
 * (spec: "muddat tugaganidan keyin to'xtaydi"). Reads keep working so the
 * clinic never loses sight of its own data; every mutation is refused with
 * SUBSCRIPTION_EXPIRED so the web app can show the "contact us" screen.
 *
 * Deliberately NOT enforced for:
 *  - public routes (no principal yet),
 *  - SUPER_ADMIN (clinicId null — the platform operator must be able to work),
 *  - impersonation tokens (the super-admin entering a clinic to fix it),
 *  - handlers marked @AllowWhenExpired() (login/logout/refresh/profile).
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (SAFE_METHODS.has(req.method)) return true;

    const user = req.user;
    if (!user || !user.clinicId) return true; // unauthenticated or platform scope
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (user.impersonatedBy) return true;

    const allowWhenExpired = this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_EXPIRED_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowWhenExpired) return true;

    const state = await this.subscriptions.getState(user.clinicId);
    if (state.isExpired) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_EXPIRED,
        'Subscription expired — the clinic is read-only until it is renewed',
        402,
        [{ endsAt: state.endsAt, planCode: state.planCode }],
      );
    }
    return true;
  }
}
