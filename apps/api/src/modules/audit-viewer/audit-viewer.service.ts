import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditLogQueryDto } from './dto';

/** Static list of audited entities for the filter dropdown (spec § M16). */
export const AUDITED_ENTITIES = [
  'Appointment',
  'Branch',
  'CashierShift',
  'Clinic',
  'Invoice',
  'LabOrder',
  'Patient',
  'Payment',
  'Queue',
  'QueueTicket',
  'Refund',
  'Service',
  'Settings',
  'User',
  'Visit',
] as const;

export interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  user: { id: string; fullName: string } | null;
  diff: Prisma.JsonValue | null;
  ip: string | null;
  createdAt: string;
}

/**
 * M16 — Audit log viewer (read-only). AuditLog is append-only and lives outside
 * the tenant auto-scope, so reads go through prisma.unscoped with an explicit
 * clinicId filter from TenantContext.
 */
@Injectable()
export class AuditViewerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQueryDto): Promise<PaginatedResult<AuditLogRow>> {
    const clinicId = TenantContext.requireClinicId();

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    // `to` is inclusive: strictly before the start of the next day.
    if (query.to) createdAt.lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);

    const where: Prisma.AuditLogWhereInput = {
      // unscoped justified: AuditLog is outside the tenant auto-scope (clinicId is
      // nullable for platform actions); we filter explicitly by the current clinic.
      clinicId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.unscoped.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.unscoped.auditLog.count({ where }),
    ]);

    // Batch-fetch actor names. unscoped justified: actors may be platform users
    // (clinicId null, e.g. SUPER_ADMIN); ids come from clinic-filtered audit rows.
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => id !== null))];
    const users =
      userIds.length > 0
        ? await this.prisma.unscoped.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true },
          })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const items: AuditLogRow[] = rows.map((row) => {
      const user = row.userId ? (userById.get(row.userId) ?? null) : null;
      return {
        id: row.id,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        user: user ? { id: user.id, fullName: user.fullName } : null,
        diff: row.diff ?? null,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return paginated(items, { page: query.page, limit: query.limit, total });
  }

  entities(): readonly string[] {
    return AUDITED_ENTITIES;
  }
}
