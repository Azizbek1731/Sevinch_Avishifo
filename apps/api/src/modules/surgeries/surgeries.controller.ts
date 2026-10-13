import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import {
  AddSurgeryEntriesDto,
  CreateSurgeryDto,
  SurgeryQueryDto,
  SurgerySelectorQueryDto,
} from './dto';
import { SurgeriesService } from './surgeries.service';

@ApiTags('surgeries')
@Controller('surgeries')
export class SurgeriesController {
  constructor(private readonly surgeries: SurgeriesService) {}

  @Get()
  @RequirePermissions('surgery.read')
  list(
    @Query() query: SurgeryQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.list(query, user, branchId);
  }

  @Get('doctors')
  @RequirePermissions('surgery.read')
  doctors(
    @Query() query: SurgerySelectorQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.doctors(query, user, branchId);
  }

  @Get('admissions')
  @RequirePermissions('surgery.read')
  admissions(
    @Query() query: SurgerySelectorQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.admissions(query, user, branchId);
  }

  @Get(':id')
  @RequirePermissions('surgery.read')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.surgeries.get(id, user, branchId);
  }

  @Post()
  @RequirePermissions('surgery.schedule')
  create(
    @Body() dto: CreateSurgeryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.create(dto, user, branchId);
  }

  @Post(':id/entries')
  @RequirePermissions('surgery.record')
  addEntries(
    @Param('id') id: string,
    @Body() dto: AddSurgeryEntriesDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.addEntries(id, dto, user, branchId);
  }

  @Delete(':id/entries/:entryId')
  @RequirePermissions('surgery.record')
  cancelEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.cancelEntry(id, entryId, user, branchId);
  }

  @Post(':id/complete')
  @RequirePermissions('surgery.record')
  complete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.surgeries.complete(id, user, branchId);
  }

  @Post(':id/cancel')
  @RequirePermissions('surgery.schedule')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.surgeries.cancel(id, user, branchId);
  }
}
