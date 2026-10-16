import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { InvoicesService } from './invoices.service';
import { RoomBillingService } from './room-billing.service';
import {
  AddPaymentDto,
  AddPaymentsDto,
  VoidPaymentDto,
  CreateInvoiceDto,
  CreateRefundDto,
  InvoiceQueryDto,
  QuickInvoiceDto,
} from './dto';

@ApiTags('billing')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly rooms: RoomBillingService,
  ) {}

  @Post()
  @RequirePermissions('invoices.write')
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.create(dto, user);
  }

  /** Front-desk sale: create + issue + (pay now | leave as debt) in one call. */
  @Post('quick')
  @RequirePermissions('invoices.write')
  quick(
    @Body() dto: QuickInvoiceDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.quick(dto, user);
  }

  @Get()
  @RequirePermissions('invoices.read')
  async list(
    @Query() query: InvoiceQueryDto,
    @ActiveBranch() branchId: string,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    if (query.pending) await this.rooms.reconcileBranch(branchId);
    return this.invoices.list(query);
  }

  @Get(':id')
  @RequirePermissions('invoices.read')
  getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.getById(id, user);
  }

  @Post(':id/issue')
  @RequirePermissions('invoices.write')
  issue(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.invoices.issue(id);
  }

  @Post(':id/cancel')
  @RequirePermissions('invoices.cancel')
  cancel(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.invoices.cancel(id);
  }

  @Post(':id/payments')
  @RequirePermissions('payments.create')
  addPayment(
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.addPayment(id, dto, user);
  }

  /** Settle an issued invoice across several methods at once. */
  @Post(':id/payments/split')
  @RequirePermissions('payments.create')
  addPayments(
    @Param('id') id: string,
    @Body() dto: AddPaymentsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.addPayments(id, dto.payments, dto.idempotencyKey, user);
  }

  /** Reverse a payment entered by mistake. Not a refund — see voidPayment. */
  @Post('payments/:paymentId/void')
  @RequirePermissions('payments.void')
  @HttpCode(200)
  voidPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.voidPayment(paymentId, dto.reason, user);
  }

  @Post(':id/refunds')
  @RequirePermissions('refunds.create')
  addRefund(
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.invoices.addRefund(id, dto, user);
  }

  @Get(':id/receipt')
  @RequirePermissions('invoices.read')
  receipt(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.invoices.receipt(id);
  }
}
