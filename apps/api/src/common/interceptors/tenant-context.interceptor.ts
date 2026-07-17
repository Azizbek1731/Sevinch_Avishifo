import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { RequestWithUser } from '../decorators';

/**
 * Enters the AsyncLocalStorage tenant context for the rest of the request
 * pipeline. Runs after guards (so req.user is populated).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;
    const branchHeader = req.headers['x-branch-id'];

    return new Observable((subscriber) => {
      const sub = TenantContext.run(
        {
          clinicId: user?.clinicId ?? null,
          userId: user?.id,
          role: user?.role,
          branchId: typeof branchHeader === 'string' ? branchHeader : undefined,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        () => next.handle().subscribe(subscriber),
      );
      return () => sub.unsubscribe();
    });
  }
}
