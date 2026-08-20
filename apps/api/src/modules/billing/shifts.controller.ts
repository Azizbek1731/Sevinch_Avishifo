import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { ShiftsService } from './shifts.service';
import { CloseShiftDto, OpenShiftDto, ShiftQueryDto } from './dto';

@ApiTags('billing')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post('open')
  @RequirePermissions('shifts.manage')
  open(
    @Body() dto: OpenShiftDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.shifts.open(dto, user, branchId);
  }

  @Post('close')
  @RequirePermissions('shifts.manage')
  close(
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.shifts.close(dto, user, branchId);
  }

  @Get('current')
  @RequirePermissions('shifts.manage')
  current(
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.shifts.current(user, branchId);
  }

  /**
   * Every open register in the branch.
   *
   * Behind shifts.oversee rather than shifts.manage, so a supervisor can look
   * at the clinic's money without opening a drawer of their own — which is
   * exactly what made two accounts show two different totals.
   */
  @Get('overview')
  @RequirePermissions('shifts.oversee')
  overview(@ActiveBranch() branchId: string): Promise<Record<string, unknown>> {
    return this.shifts.overview(branchId);
  }

  /** What this drawer has taken so far, so a wrong entry can be found and undone. */
  @Get('current/payments')
  @RequirePermissions('shifts.manage')
  currentPayments(
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.shifts.currentPayments(user, branchId);
  }

  @Get()
  @RequirePermissions('shifts.manage')
  list(@Query() query: ShiftQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.shifts.list(query);
  }
}
