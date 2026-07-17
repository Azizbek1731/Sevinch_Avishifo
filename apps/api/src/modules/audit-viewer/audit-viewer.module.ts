import { Module } from '@nestjs/common';
import { AuditViewerController } from './audit-viewer.controller';
import { AuditViewerService } from './audit-viewer.service';

/**
 * M16 — Audit log viewer: read-only listing of the append-only AuditLog with
 * filters (entity, entityId, user, action, date range) for CLINIC_OWNER /
 * SUPER_ADMIN. Core providers (Prisma) are global modules.
 */
@Module({
  controllers: [AuditViewerController],
  providers: [AuditViewerService],
})
export class AuditViewerModule {}
