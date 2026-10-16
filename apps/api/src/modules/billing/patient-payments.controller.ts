import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { patientCheckoutSchema, patientPendingQuerySchema, type AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import { PatientPaymentsService } from './patient-payments.service';
class PatientCheckoutDto extends createZodDto(patientCheckoutSchema) {}
class PatientPendingQueryDto extends createZodDto(patientPendingQuerySchema) {}

@ApiTags('billing')
@Controller('patient-payments')
export class PatientPaymentsController {
  constructor(private readonly payments: PatientPaymentsService) {}

  @Get('pending')
  @RequirePermissions('invoices.read')
  pending(
    @ActiveBranch() branchId: string,
    @Query() query: PatientPendingQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.pending(branchId, query, user);
  }
  @Get('patients/:patientId')
  @RequirePermissions('invoices.read')
  outstanding(
    @Param('patientId') patientId: string,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.outstanding(patientId, branchId, user);
  }
  @Post()
  @RequirePermissions('payments.create')
  checkout(
    @Body() input: PatientCheckoutDto,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.checkout(branchId, input, user);
  }
  @Get(':id/receipt')
  @RequirePermissions('invoices.read')
  receipt(
    @Param('id') id: string,
    @ActiveBranch() branchId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.receipt(id, branchId, user);
  }
}
