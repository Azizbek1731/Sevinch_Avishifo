import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Expense, ExpenseCategory } from '@prisma/client';
import {
  ErrorCode,
  type AuthUser,
  type CreateExpenseInput,
  type ExpenseCategoryUpsertInput,
  type ExpenseQueryInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private mapCategory(c: ExpenseCategory): Record<string, unknown> {
    return { id: c.id, name: c.name, isActive: c.isActive };
  }

  private mapExpense(e: Expense): Record<string, unknown> {
    return {
      id: e.id,
      branchId: e.branchId,
      categoryId: e.categoryId,
      amount: e.amount.toFixed(2),
      date: e.date.toISOString().slice(0, 10),
      note: e.note,
      createdById: e.createdById,
      createdAt: e.createdAt.toISOString(),
    };
  }

  // ============================================================ categories

  async listCategories(q: { page: number; limit: number }): Promise<PaginatedResult<Record<string, unknown>>> {
    const [rows, total] = await Promise.all([
      this.prisma.db.expenseCategory.findMany({ orderBy: { name: 'asc' }, ...skipTake(q) }),
      this.prisma.db.expenseCategory.count(),
    ]);
    return paginated(
      rows.map((r) => this.mapCategory(r)),
      { page: q.page, limit: q.limit, total },
    );
  }

  async createCategory(dto: ExpenseCategoryUpsertInput): Promise<Record<string, unknown>> {
    const category = await this.prisma.db.expenseCategory.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: { clinicId: TenantContext.requireClinicId(), name: dto.name },
    });
    return this.mapCategory(category);
  }

  async updateCategory(id: string, dto: ExpenseCategoryUpsertInput): Promise<Record<string, unknown>> {
    const existing = await this.prisma.db.expenseCategory.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found', 404);
    const updated = await this.prisma.db.expenseCategory.update({
      where: { id },
      data: { name: dto.name },
    });
    return this.mapCategory(updated);
  }

  /** Deactivates instead of deleting — expenses keep their category reference. */
  async removeCategory(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.db.expenseCategory.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found', 404);
    await this.prisma.db.expenseCategory.update({ where: { id }, data: { isActive: false } });
    return { id };
  }

  // ============================================================ expenses

  async createExpense(dto: CreateExpenseInput, user: AuthUser): Promise<Record<string, unknown>> {
    const category = await this.prisma.db.expenseCategory.findFirst({
      where: { id: dto.categoryId, isActive: true },
    });
    if (!category) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found', 404);
    const expense = await this.prisma.db.expense.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        branchId: dto.branchId,
        categoryId: dto.categoryId,
        amount: new Prisma.Decimal(dto.amount),
        date: new Date(dto.date),
        note: dto.note ?? null,
        createdById: user.id,
      },
    });
    return this.mapExpense(expense);
  }

  /** List with filters and the filtered total sum (for net revenue reporting). */
  async listExpenses(q: ExpenseQueryInput): Promise<Record<string, unknown>> {
    const where: Prisma.ExpenseWhereInput = {
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.from || q.to
        ? {
            date: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total, agg] = await Promise.all([
      this.prisma.db.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        ...skipTake(q),
        include: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.db.expense.count({ where }),
      this.prisma.db.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items: rows.map((r) => ({ ...this.mapExpense(r), category: r.category })),
      meta: { page: q.page, limit: q.limit, total },
      sum: (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }

  async updateExpense(id: string, dto: Partial<CreateExpenseInput>): Promise<Record<string, unknown>> {
    const existing = await this.prisma.db.expense.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Expense not found', 404);
    if (dto.categoryId) {
      const category = await this.prisma.db.expenseCategory.findFirst({ where: { id: dto.categoryId } });
      if (!category) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found', 404);
    }
    const updated = await this.prisma.db.expense.update({
      where: { id },
      data: {
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.amount !== undefined ? { amount: new Prisma.Decimal(dto.amount) } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
    return this.mapExpense(updated);
  }

  async removeExpense(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.db.expense.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Expense not found', 404);
    await this.prisma.db.expense.delete({ where: { id } });
    return { id };
  }
}
