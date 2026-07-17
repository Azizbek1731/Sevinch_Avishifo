import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ReportsService } from './reports.service';
import { XLSX_MIME_TYPE, type SheetSpec } from './xlsx.service';
import { DashboardQueryDto, ReportRangeQueryDto, RevenueQueryDto } from './dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('reports.read')
  async dashboard(@Query() query: DashboardQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.dashboard(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'dashboard', this.reports.dashboardSheets(data));
  }

  @Get('revenue')
  @RequirePermissions('reports.read')
  async revenue(@Query() query: RevenueQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.revenue(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'revenue', this.reports.revenueSheets(data));
  }

  @Get('patient-flow')
  @RequirePermissions('reports.read')
  async patientFlow(@Query() query: ReportRangeQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.patientFlow(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'patient-flow', this.reports.patientFlowSheets(data));
  }

  @Get('doctors')
  @RequirePermissions('reports.read')
  async doctors(@Query() query: ReportRangeQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.doctors(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'doctors', this.reports.doctorsSheets(data));
  }

  @Get('services')
  @RequirePermissions('reports.read')
  async services(@Query() query: ReportRangeQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.services(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'services', this.reports.servicesSheets(data));
  }

  @Get('queue')
  @RequirePermissions('reports.read')
  async queue(@Query() query: ReportRangeQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.queue(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'queue', this.reports.queueSheets(data));
  }

  @Get('lab-turnaround')
  @RequirePermissions('reports.read')
  async labTurnaround(@Query() query: ReportRangeQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.labTurnaround(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'lab-turnaround', this.reports.labTurnaroundSheets(data));
  }

  @Get('cashier-shifts')
  @RequirePermissions('reports.read')
  async cashierShifts(@Query() query: ReportRangeQueryDto, @CurrentUser() user: AuthUser) {
    const data = await this.reports.cashierShifts(query);
    if (query.export !== 'xlsx') return data;
    return this.exportFile(user, 'cashier-shifts', this.reports.cashierShiftsSheets(data));
  }

  /** Service enforces `reports.export` and audits the EXPORT action. */
  private async exportFile(
    user: AuthUser,
    reportKey: string,
    sheets: SheetSpec[],
  ): Promise<StreamableFile> {
    const buffer = await this.reports.prepareExport(user, reportKey, sheets);
    return new StreamableFile(buffer, {
      type: XLSX_MIME_TYPE,
      disposition: 'attachment; filename="report.xlsx"',
    });
  }
}
