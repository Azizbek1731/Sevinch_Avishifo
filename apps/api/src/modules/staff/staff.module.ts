import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/**
 * M11 — Staff, Schedules & Payroll/KPI: staff directory + profiles, doctor
 * weekly schedule templates & exceptions (feed the slot engine), doctor KPI,
 * compensation rules and monthly payroll accruals with XLSX export.
 * Core providers (Prisma, Audit) are global modules.
 */
@Module({
  controllers: [StaffController, PayrollController],
  providers: [StaffService, PayrollService],
  exports: [StaffService],
})
export class StaffModule {}
