import { ApiMeta } from '@avishifo/shared';

/** Wrap list results so EnvelopeInterceptor emits { data, meta }. */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: ApiMeta,
  ) {}
}

export function paginated<T>(
  items: T[],
  meta: { page: number; limit: number; total: number },
): PaginatedResult<T> {
  return new PaginatedResult(items, meta);
}

export function skipTake(query: { page: number; limit: number }): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}
