import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import { ClinicalOrdersService } from './clinical-orders.service';
import { AddClinicalServicesDto, ClinicalOrderQueryDto, CreateClinicalOrderDto } from './dto';

@ApiTags('clinical-orders')
@Controller('clinical-orders')
export class ClinicalOrdersController {
  constructor(private readonly orders: ClinicalOrdersService) {}
  @Get()
  @RequirePermissions('patients.read')
  list(
    @Query() query: ClinicalOrderQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.list(query, user, branchId);
  }
  @Post()
  @RequirePermissions('invoices.write')
  create(
    @Body() dto: CreateClinicalOrderDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.create(dto, user, branchId);
  }
  @Get('doctors')
  @RequirePermissions('invoices.write')
  doctors(@CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.orders.doctors(user, branchId);
  }
  @Get(':id')
  @RequirePermissions('patients.read')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.orders.get(id, user, branchId);
  }
  @Post(':id/start')
  @RequirePermissions('visits.write')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.orders.start(id, user, branchId);
  }
  @Post(':id/services')
  @RequirePermissions('visits.write')
  addServices(
    @Param('id') id: string,
    @Body() dto: AddClinicalServicesDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.addServices(id, dto, user, branchId);
  }
}
