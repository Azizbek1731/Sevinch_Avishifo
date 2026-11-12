import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AmbulatoryCommissionReport, AmbulatoryRates, AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { XLSX_MIME_TYPE } from '../reports/xlsx.service';
import { AmbulatoryService } from './ambulatory.service';
import {
  AmbulatoryCaseQueryDto,
  AmbulatoryCommissionQueryDto,
  AmbulatoryLabOrderDto,
  AmbulatoryRatesDto,
  AmbulatoryUziOrderDto,
  OpenAmbulatoryCaseDto,
  UpdateAmbulatoryCaseDto,
} from './dto';

/** Doctors see and act on their own cards only — enforced in the service. */
@ApiTags('ambulatory')
@Controller('ambulatory')
export class AmbulatoryController {
  constructor(private readonly ambulatory: AmbulatoryService) {}

  @Get()
  @RequirePermissions('ambulatory.read')
  list(
    @Query() query: AmbulatoryCaseQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.ambulatory.list(query, user, branchId);
  }

  @Get('commissions')
  @RequirePermissions('ambulatory.read')
  async commissions(
    @Query() query: AmbulatoryCommissionQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<AmbulatoryCommissionReport | StreamableFile> {
    const report = await this.ambulatory.commissions(query, user, branchId);
    if (query.export !== 'xlsx') return report;
    return new StreamableFile(await this.ambulatory.exportCommissions(report, user), {
      type: XLSX_MIME_TYPE,
      disposition: `attachment; filename="ambulator-ulush_${query.from}_${query.to}.xlsx"`,
    });
  }

  @Get('rates')
  @RequirePermissions('ambulatory.rates.write')
  rates(@CurrentUser() user: AuthUser, @ActiveBranch() branchId: string): Promise<AmbulatoryRates> {
    return this.ambulatory.rates(user, branchId);
  }

  @Put('rates')
  @RequirePermissions('ambulatory.rates.write')
  saveRates(
    @Body() dto: AmbulatoryRatesDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<AmbulatoryRates> {
    return this.ambulatory.saveRates(dto, user, branchId);
  }

  @Get(':id')
  @RequirePermissions('ambulatory.read')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.getById(id, user, branchId);
  }

  @Post()
  @RequirePermissions('ambulatory.write')
  open(
    @Body() dto: OpenAmbulatoryCaseDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.open(dto, user, branchId);
  }

  @Patch(':id')
  @RequirePermissions('ambulatory.write')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAmbulatoryCaseDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.update(id, dto, user, branchId);
  }

  @Post(':id/close')
  @RequirePermissions('ambulatory.write')
  close(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.setStatus(id, 'CLOSED', user, branchId);
  }

  @Post(':id/reopen')
  @RequirePermissions('ambulatory.write')
  reopen(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.setStatus(id, 'OPEN', user, branchId);
  }

  @Delete(':id')
  @RequirePermissions('ambulatory.write')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<{ id: string }> {
    return this.ambulatory.remove(id, user, branchId);
  }

  @Post(':id/lab')
  @RequirePermissions('ambulatory.write')
  sendLab(
    @Param('id') id: string,
    @Body() dto: AmbulatoryLabOrderDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.sendLab(id, dto, user, branchId);
  }

  @Post(':id/uzi')
  @RequirePermissions('ambulatory.write')
  sendUzi(
    @Param('id') id: string,
    @Body() dto: AmbulatoryUziOrderDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.ambulatory.sendUzi(id, dto, user, branchId);
  }
}
