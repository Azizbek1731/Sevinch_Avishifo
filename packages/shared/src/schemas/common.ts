import { z } from 'zod';
import { PAGINATION, PHONE_REGEX } from '../constants';

export const idSchema = z.string().uuid();

export const phoneSchema = z
  .string()
  .regex(PHONE_REGEX, { message: 'Phone must be normalized +998XXXXXXXXX' });

/** Money over the wire: decimal string, max 2 fraction digits, non-negative by default. */
export const moneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/, { message: 'Invalid money value' });
export const signedMoneySchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, { message: 'Invalid money value' });

export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Calendar date without time, "2026-07-18". */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "HH:mm" 24h time. */
export const timeHmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `?sort=createdAt:desc` */
export const sortQuerySchema = (allowed: readonly [string, ...string[]]) =>
  z
    .string()
    .regex(/^[a-zA-Z]+:(asc|desc)$/)
    .refine((v) => (allowed as readonly string[]).includes(v.split(':')[0] as string), {
      message: 'Unsupported sort field',
    })
    .optional();

export function parseSort(
  sort: string | undefined,
  fallback: { field: string; dir: 'asc' | 'desc' },
): { field: string; dir: 'asc' | 'desc' } {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':');
  return { field: field ?? fallback.field, dir: dir === 'asc' ? 'asc' : 'desc' };
}
