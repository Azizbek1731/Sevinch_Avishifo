import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditAction } from '@avishifo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../prisma/tenant-context';

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  /** Override the actor (e.g. system jobs); defaults to context user. */
  userId?: string;
  clinicId?: string | null;
}

/** Only the changed fields, as { field: { before, after } }. */
function diffOf(before: unknown, after: unknown): Record<string, unknown> | null {
  if (before === undefined && after === undefined) return null;
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const diff: Record<string, unknown> = {};
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      diff[k] = { before: bv ?? null, after: av ?? null };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Append-only audit log write; never throws (audit must not break the mutation). */
  async log(entry: AuditEntry): Promise<void> {
    const ctx = TenantContext.get();
    try {
      // AuditLog is intentionally outside tenant auto-scoping (append-only, platform rows allowed).
      await this.prisma.unscoped.auditLog.create({
        data: {
          clinicId: entry.clinicId !== undefined ? entry.clinicId : (ctx?.clinicId ?? null),
          userId: entry.userId ?? ctx?.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          diff: (diffOf(entry.before, entry.after) ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: ctx?.ip,
          userAgent: ctx?.userAgent,
        },
      });
    } catch (err) {
      this.logger.error(`audit write failed: ${(err as Error).message}`);
    }
  }
}
