import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import { BalanceService } from './balance.service';
import { AddDepositDto, DebtorQueryDto, PaginationQueryDto } from './dto';

@ApiTags('billing')
@Controller('patients')
export class BalanceController {
  constructor(private readonly balance: BalanceService) {}

  @Post(':id/deposits')
  @RequirePermissions('payments.create')
  addDeposit(
    @Param('id') id: string,
    @Body() dto: AddDepositDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.balance.addDeposit(id, dto, user, branchId);
  }

  @Get(':id/balance')
  @RequirePermissions('payments.create')
  getBalance(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.balance.getBalance(id, query);
  }
}

@ApiTags('billing')
@Controller('debtors')
export class DebtorsController {
  constructor(private readonly balance: BalanceService) {}

  @Get()
  @RequirePermissions('debts.read')
  list(@Query() query: DebtorQueryDto): Promise<Record<string, unknown>> {
    return this.balance.debtors(query);
  }
}
