import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { AdmissionsService } from './admissions.service';
import { ChargesService } from './charges.service';
import {
  AddChargeDto,
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
  list(@Query() query: AdmissionQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.admissions.list(query);
  }

  @Get(':id')
  @RequirePermissions('admissions.read')
  get(@Param('id') id: string, @ActiveBranch() branchId: string): Promise<Record<string, unknown>> {
    return this.admissions.getById(id, branchId);
  }

  @Get(':id/print')
  @RequirePermissions('admissions.read')
  print(@Param('id') id: string): Promise<Record<string, unknown>> {
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdmissionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.admissions.update(id, dto, user);
  }

  /** What stands between this stay and discharge — unbilled services, debt. */
  @Get(':id/discharge-check')
  @RequirePermissions('admissions.read')
  dischargeCheck(@Param('id') id: string, @ActiveBranch() branchId: string): Promise<Record<string, unknown>> {
    return this.admissions.dischargeCheck(id, branchId);
  }

  /** Remove a stay opened by mistake. Billed money is kept — see remove(). */
  @Delete(':id')
  @RequirePermissions('admissions.force')
  remove(@Param('id') id: string): Promise<{ id: string; invoicedKept: number }> {
    return this.admissions.remove(id);
  }

  @Post(':id/discharge')
  @RequirePermissions('admissions.write')
  discharge(
    @Param('id') id: string,
    @Body() dto: DischargeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.admissions.discharge(id, dto, user);
  }

  // ------------------------------------------------------- treatment sheet

  @Post(':id/orders')
  @RequirePermissions('admissions.write')
  createOrder(
    @Param('id') id: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.admissions.createOrder(id, dto, user);
  }

  @Delete('orders/:orderId')
  @RequirePermissions('admissions.write')
  stopOrder(@Param('orderId') orderId: string): Promise<{ id: string }> {
    return this.admissions.stopOrder(orderId);
  }

  /** The ward nurse and the front desk both mark the sheet, so this is its own permission. */
  @Post(':id/administrations')
  @RequirePermissions('admissions.administer')
  mark(
    @Param('id') id: string,
    @Body() dto: MarkAdministrationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.admissions.markAdministration(id, dto, user);
  }

  @Post(':id/notes')
  @RequirePermissions('admissions.write')
  addNote(
    @Param('id') id: string,
    @Body() dto: DailyNoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.admissions.addDailyNote(id, dto, user);
  }
}

@ApiTags('admissions')
@Controller('charges')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Get()
  @RequirePermissions('charges.read')
  list(
    @Query() query: ChargeQueryDto,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.charges.listForPatient(query, branchId);
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

  @Delete(':id')
  @RequirePermissions('charges.write')
  cancel(@Param('id') id: string, @ActiveBranch() branchId: string): Promise<{ id: string }> {
    return this.charges.cancel(id, branchId);
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
}
