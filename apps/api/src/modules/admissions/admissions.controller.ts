import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags } from '@nestjs/swagger';
import { UPLOAD_LIMITS, type AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { XLSX_MIME_TYPE } from '../reports/xlsx.service';
import { AdmissionsService } from './admissions.service';
import { BillScanService } from './bill-scan.service';
import { ChargesService } from './charges.service';
import {
  AddChargeDto,
  AddChargesBatchDto,
  AddRoomChargesDto,
  ChargeQueryDto,
  AdmissionQueryDto,
  AdmitPatientDto,
  CreateOrderDto,
  DailyNoteDto,
  DischargeDto,
  InvoiceChargesDto,
  MarkAdministrationDto,
  UpdateAdmissionDto,
} from './dto';

@ApiTags('admissions')
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermissions('admissions.read')
  async list(
    @Query() query: AdmissionQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<Record<string, unknown>> | StreamableFile> {
    if (query.export === 'xlsx') {
      const buffer = await this.admissions.exportXlsx(query, user);
      return new StreamableFile(buffer, {
        type: XLSX_MIME_TYPE,
        disposition: 'attachment; filename="statsionar.xlsx"',
      });
    }
    return this.admissions.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('admissions.read')
  async get(
    @Param('id') id: string,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.getById(id, branchId);
  }

  @Get(':id/print')
  @RequirePermissions('admissions.read')
  async print(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.printPayload(id);
  }

  @Post()
  @RequirePermissions('admissions.write')
  admit(
    @Body() dto: AdmitPatientDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.admissions.admit(dto, user, branchId);
  }

  @Patch(':id')
  @RequirePermissions('admissions.write')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAdmissionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.update(id, dto, user);
  }

  /** What stands between this stay and discharge — unbilled services, debt. */
  @Get(':id/discharge-check')
  @RequirePermissions('admissions.read')
  async dischargeCheck(
    @Param('id') id: string,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.dischargeCheck(id, branchId);
  }

  /** The whole stay goes to the cashier once, when the patient is leaving. */
  @Post(':id/bill')
  @RequirePermissions('charges.write', 'invoices.write')
  billStay(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.admissions.billStay(id, user);
  }

  /** Remove a stay opened by mistake. Billed money is kept — see remove(). */
  @Delete(':id')
  @RequirePermissions('admissions.force')
  remove(@Param('id') id: string): Promise<{ id: string; invoicedKept: number }> {
    return this.admissions.remove(id);
  }

  @Post(':id/discharge')
  @RequirePermissions('admissions.write')
  async discharge(
    @Param('id') id: string,
    @Body() dto: DischargeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.discharge(id, dto, user);
  }

  // ------------------------------------------------------- treatment sheet

  @Post(':id/orders')
  @RequirePermissions('admissions.write')
  async createOrder(
    @Param('id') id: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.createOrder(id, dto, user);
  }

  @Delete('orders/:orderId')
  @RequirePermissions('admissions.write')
  async stopOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    await this.admissions.assertCareTeamForOrder(orderId, user);
    return this.admissions.stopOrder(orderId);
  }

  /** The ward nurse and the front desk both mark the sheet, so this is its own permission. */
  @Post(':id/administrations')
  @RequirePermissions('admissions.administer')
  async mark(
    @Param('id') id: string,
    @Body() dto: MarkAdministrationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.markAdministration(id, dto, user);
  }

  @Post(':id/notes')
  @RequirePermissions('admissions.write')
  async addNote(
    @Param('id') id: string,
    @Body() dto: DailyNoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.addDailyNote(id, dto, user);
  }

  /** Qo‘lda bir yoki bir necha 24 soatlik palata (ko‘yka) haqini bemor hisobiga qo‘shish. */
  @Post(':id/room-charges')
  @RequirePermissions('admissions.write')
  async addRoomCharge(
    @Param('id') id: string,
    @Body() dto: AddRoomChargesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.addRoomCharge(id, dto.days ?? 1, user);
  }

  /** Oxirgi qo‘shilgan (to‘lanmagan) kunlik haqni qaytarish. */
  @Delete(':id/room-charges/:date')
  @RequirePermissions('admissions.write')
  async reverseRoomCharge(
    @Param('id') id: string,
    @Param('date') date: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.admissions.assertCareTeam(id, user);
    return this.admissions.reverseRoomCharge(id, date, user);
  }
}

@ApiTags('admissions')
@Controller('charges')
export class ChargesController {
  constructor(
    private readonly charges: ChargesService,
    private readonly billScan: BillScanService,
  ) {}

  @Get()
  @RequirePermissions('charges.read')
  list(
    @Query() query: ChargeQueryDto,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.charges.listForPatient(query, branchId, user);
  }

  @Get('ai-scan/status')
  @RequirePermissions('charges.write')
  aiScanStatus(): { enabled: boolean; model: string } {
    return {
      enabled: this.billScan.enabled,
      model: this.billScan.model,
    };
  }

  @Post()
  @RequirePermissions('charges.write')
  add(
    @Body() dto: AddChargeDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.charges.add(dto, user, branchId);
  }

  /** Paper bill photo → suggested charge lines (not saved until /charges/batch). */
  @Post('ai-scan')
  @RequirePermissions('charges.write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: Math.min(12, UPLOAD_LIMITS.MAX_FILE_SIZE_MB) * 1024 * 1024 },
    }),
  )
  async aiScan(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    if (!file) throw new BadRequestException('file is required');
    return this.billScan.extractFromImage(file, user);
  }

  /** Save reviewed AI / manual lines in one go. */
  @Post('batch')
  @RequirePermissions('charges.write')
  addBatch(
    @Body() dto: AddChargesBatchDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<{ items: Record<string, unknown>[]; count: number }> {
    return this.charges.addBatch(dto, user, branchId);
  }

  /** Bills the ticked selection — all of what is owed, or only part of it. */
  @Post('invoice')
  @RequirePermissions('charges.write', 'invoices.write')
  invoice(
    @Body() dto: InvoiceChargesDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.charges.invoiceSelected(dto, user, branchId);
  }

  @Delete(':id')
  @RequirePermissions('charges.write')
  cancel(
    @Param('id') id: string,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.charges.cancel(id, branchId, user);
  }
}
