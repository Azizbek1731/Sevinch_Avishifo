import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, ExpenseCategoryUpsertDto, ExpenseQueryDto, PaginationQueryDto, UpdateExpenseDto } from './dto';

@ApiTags('billing')
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions('expenses.read')
  list(@Query() query: PaginationQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    return this.expenses.listCategories(query);
  }

  @Post()
  @RequirePermissions('expenses.write')
  create(@Body() dto: ExpenseCategoryUpsertDto): Promise<Record<string, unknown>> {
    return this.expenses.createCategory(dto);
  }

  @Patch(':id')
  @RequirePermissions('expenses.write')
  update(@Param('id') id: string, @Body() dto: ExpenseCategoryUpsertDto): Promise<Record<string, unknown>> {
    return this.expenses.updateCategory(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expenses.write')
  remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.expenses.removeCategory(id);
  }
}

@ApiTags('billing')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions('expenses.read')
  list(@Query() query: ExpenseQueryDto): Promise<Record<string, unknown>> {
    return this.expenses.listExpenses(query);
  }

  @Post()
  @RequirePermissions('expenses.write')
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.expenses.createExpense(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('expenses.write')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto): Promise<Record<string, unknown>> {
    return this.expenses.updateExpense(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expenses.write')
  remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.expenses.removeExpense(id);
  }
}
