import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CashierShift, Expense, ExpenseCategory } from '@prisma/client';
import {
  ErrorCode,
  AuditAction,
  type AuthUser,
  type CreateExpenseInput,
  type ExpenseCategoryUpsertInput,
  type ExpenseQueryInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { canSeeDeleted } from '../../common/visibility';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { assertManualMethod, lockOpenShift } from './cash-accounts';

type ExpenseWithJoins = Expense & {
  category?: { id: string; name: string } | null;
  shift?: Pick<CashierShift, 'id' | 'status'> | null;
  surgeryPayout?: { id: string; surgeryId: string } | null;
};

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  private mapCategory(c: ExpenseCategory): Record<string, unknown> {
    return { id: c.id, name: c.name, isActive: c.isActive };
  }

  private mapExpense(e: ExpenseWithJoins): Record<string, unknown> {
    return {
      id: e.id,
      branchId: e.branchId,
      categoryId: e.categoryId,
      amount: e.amount.toFixed(2),
      method: e.method,
      shiftId: e.shiftId,
      date: e.date.toISOString().slice(0, 10),
      note: e.note,
      createdById: e.createdById,
      createdAt: e.createdAt.toISOString(),
      deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
      surgeryId: e.surgeryPayout?.surgeryId ?? null,
      ...(e.category ? { category: e.category } : {}),
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

  /**
   * The branch register. Cash can only come out of a register that is open —
   * there is one per branch now, shared by everyone who works the desk, so a
   * reception expense and a cashier expense charge the same till.
   */
  private async requireOpenShift(branchId: string): Promise<string> {
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { branchId, status: 'OPEN' },
    });
    if (!shift) {
      throw new AppException(
        ErrorCode.SHIFT_NOT_OPEN,
        'Chiqim uchun ochiq kassa smenasi kerak',
        409,
      );
    }
    return shift.id;
  }

  async createExpense(
    dto: CreateExpenseInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    assertManualMethod(dto.method, this.config.env.SINGLE_CLINIC_MODE);
    const category = await this.prisma.db.expenseCategory.findFirst({
      where: { id: dto.categoryId, isActive: true },
    });
    if (!category) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found', 404);

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Chiqim summasi noldan katta bo‘lishi kerak', 400);
    }

    // Resolved before the write, so a cash expense with no open drawer is
    // refused outright rather than recorded as money out of nowhere.
    const shiftId = (this.config.env.SINGLE_CLINIC_MODE || dto.method === 'CASH') ? await this.requireOpenShift(branchId) : null;

    const expense = await this.prisma.db.$transaction(async (tx) => {
      // Re-checked inside the transaction with a share lock, so a close() that
      // races this write either waits and counts it, or already won — in which
      // case cash out of a counted-out drawer is refused.
      if (shiftId) {
        const rows = (await tx.$queryRaw`
          SELECT "id" FROM "CashierShift" WHERE "id" = ${shiftId} AND "status" = 'OPEN' FOR SHARE
        `) as unknown[];
        if (rows.length === 0) {
          throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Kassa hozirgina yopildi — smenani qayta oching', 409);
        }
      }
      return tx.expense.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: TenantContext.requireClinicId(),
          branchId,
          categoryId: dto.categoryId,
          amount,
          method: dto.method,
          shiftId,
          date: new Date(dto.date),
          note: dto.note ?? null,
          createdById: user.id,
        },
        include: { category: { select: { id: true, name: true } } },
      });
    });
    await this.audit.log({ action: AuditAction.CREATE, entity: 'Expense', entityId: expense.id, after: this.mapExpense(expense) });
    return this.mapExpense(expense);
  }

  /** List with filters and the filtered total sum (for net revenue reporting). */
  async listExpenses(q: ExpenseQueryInput, user?: AuthUser): Promise<Record<string, unknown>> {
    // Withdrawn rows stay hidden from the desk that withdrew them; management
    // has to ask for them explicitly, so the default list is the working one.
    const showDeleted = q.deleted === true && canSeeDeleted(user);
    const where: Prisma.ExpenseWhereInput = {
      ...(showDeleted ? {} : { deletedAt: null }),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.method ? { method: q.method } : {}),
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
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        ...skipTake(q),
        include: { category: { select: { id: true, name: true } }, surgeryPayout: { select: { id: true, surgeryId: true } } },
      }),
      this.prisma.db.expense.count({ where }),
      // The headline total counts only live rows: a withdrawn expense is one
      // the clinic decided never happened, and it must not inflate the figure
      // an owner reads as "what we spent".
      this.prisma.db.expense.aggregate({ where: { ...where, deletedAt: null }, _sum: { amount: true } }),
    ]);
    return {
      items: rows.map((r) => this.mapExpense(r)),
      meta: { page: q.page, limit: q.limit, total },
      sum: (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }

  /**
   * A row whose shift has already been counted and signed off is history. Let
   * it be edited and the closing figure a cashier put their name to would
   * silently stop matching what the record says.
   */
  private async loadEditable(id: string): Promise<ExpenseWithJoins> {
    const existing = await this.prisma.db.expense.findFirst({
      where: { id },
      include: { shift: { select: { id: true, status: true } } },
    });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Expense not found', 404);
    const surgeryPayout = await this.prisma.db.surgeryPayout.findFirst({ where: { expenseId: id }, select: { id: true } });
    if (surgeryPayout) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Jarroh ulushini operatsiya kartasidan bekor qiling — bog‘langan chiqimni alohida o‘zgartirib bo‘lmaydi', 409);
    }
    if (existing.shift && existing.shift.status !== 'OPEN') {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Bu chiqim yopilgan smenaga tegishli — uni o‘zgartirib bo‘lmaydi',
        409,
      );
    }
    return existing;
  }

  async updateExpense(id: string, dto: Partial<CreateExpenseInput>): Promise<Record<string, unknown>> {
    const existing = await this.loadEditable(id);
    if (existing.deletedAt) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'O‘chirilgan chiqimni o‘zgartirib bo‘lmaydi', 409);
    }
    if (dto.categoryId) {
      const category = await this.prisma.db.expenseCategory.findFirst({ where: { id: dto.categoryId } });
      if (!category) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found', 404);
    }
    if (dto.amount !== undefined && new Prisma.Decimal(dto.amount).lte(0)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Chiqim summasi noldan katta bo‘lishi kerak', 400);
    }
    // Changing how it was paid would move the money between the drawer and the
    // clinic's account. That is a different expense — record it as one.
    if (dto.method !== undefined && dto.method !== existing.method) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'To‘lov turini o‘zgartirib bo‘lmaydi — chiqimni o‘chirib, qaytadan kiriting',
        409,
      );
    }
    const updated = await this.prisma.db.$transaction(async (tx) => {
      await lockOpenShift(tx, existing.shiftId, existing.shiftId !== null);
      return tx.expense.update({
        where: { id, deletedAt: null },
        data: {
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.amount !== undefined ? { amount: new Prisma.Decimal(dto.amount) } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
      });
    });
    await this.audit.log({ action: AuditAction.UPDATE, entity: 'Expense', entityId: id, before: this.mapExpense(existing), after: this.mapExpense(updated) });
    return this.mapExpense(updated);
  }

  /**
   * Withdraws the expense. The row survives so the shift it was charged to
   * stays explainable; the drawer stops expecting the money back immediately,
   * because the shift totals count live rows only.
   */
  async removeExpense(id: string, user: AuthUser): Promise<{ id: string }> {
    const existing = await this.loadEditable(id);
    if (existing.deletedAt) return { id };
    await this.prisma.db.$transaction(async (tx) => {
      await lockOpenShift(tx, existing.shiftId, existing.shiftId !== null);
      await tx.expense.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: user.id },
      });
    });
    await this.audit.log({ action: AuditAction.DELETE, entity: 'Expense', entityId: id, before: this.mapExpense(existing), after: { deleted: true } });
    return { id };
  }
}
