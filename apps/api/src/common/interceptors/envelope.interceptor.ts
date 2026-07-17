import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { PaginatedResult } from '../pagination';

/** Wraps responses into the standard envelope (spec §8). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      map((data: unknown) => {
        if (data instanceof StreamableFile) return data;
        if (data instanceof PaginatedResult) {
          return { success: true, data: data.items, meta: data.meta };
        }
        return { success: true, data: data ?? null };
      }),
    );
  }
}
