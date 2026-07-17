import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditAction, dateOnlySchema, idSchema, paginationQuerySchema } from '@avishifo/shared';

/**
 * M16 — Audit viewer is the one module allowed to define its query schema
 * inline (no dedicated shared schema file for audit).
 */
const auditLogQuerySchema = z.object({
  ...paginationQuerySchema.shape,
  entity: z.string().min(1).max(100).optional(),
  entityId: z.string().min(1).max(100).optional(),
  userId: idSchema.optional(),
  action: z.nativeEnum(AuditAction).optional(),
  /** Inclusive lower bound, "YYYY-MM-DD". */
  from: dateOnlySchema.optional(),
  /** Inclusive upper bound, "YYYY-MM-DD". */
  to: dateOnlySchema.optional(),
});

export class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}
