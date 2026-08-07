import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { InvoicesService } from './invoices.service';
import {
  AddPaymentDto,
  CreateInvoiceDto,
  CreateRefundDto,
  InvoiceQueryDto,
  QuickInvoiceDto,
} from './dto';

@ApiTags('billing')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @RequirePermissions('invoices.write')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.invoices.create(dto, user);
  }

  /** Front-desk sale: create + issue + (pay now | leave as debt) in one call. */
  @Post('quick')
  @RequirePermissions('invoices.write')
  quick(@Body() dto: QuickInvoiceDto, @CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.invoices.quick(dto, user);
  }

  @Get()
  @RequirePermissions('invoices.read')
  list(@Query() query: InvoiceQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.invoices.list(query);
  }

  @Get(':id')
  @RequirePermissions('invoices.read')
  getById(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.invoices.getById(id);
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
