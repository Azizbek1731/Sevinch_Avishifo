import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ConsumablesService } from './consumables.service';
import { CashflowService } from './cashflow.service';
import { XlsxService } from './xlsx.service';

/**
 * M12 — Reporting & Analytics: dashboard, revenue, patient flow, doctor KPI,
 * service popularity, queue timings, lab turnaround, cashier shift history.
 * All aggregates run as raw SQL with manual clinicId tenancy; every endpoint
 * supports `?export=xlsx` (permission `reports.export`, audited as EXPORT).
 * Core providers (Prisma, Audit) are global modules.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, CashflowService, ConsumablesService, XlsxService],
  // AviShifo AI's tools are thin wrappers over these, so the assistant reuses
  // the same tenant-scoped code the panel's reports run on.
  exports: [ReportsService],
})
export class ReportsModule {}
