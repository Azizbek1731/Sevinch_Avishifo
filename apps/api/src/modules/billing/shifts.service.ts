import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CashierShift } from '@prisma/client';
import {
  ErrorCode,
  type AuthUser,
  type CloseShiftInput,
  type OpenShiftInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';

export interface ShiftQuery {
  page: number;
  limit: number;
  branchId?: string;
  status?: 'OPEN' | 'CLOSED';
}

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  private mapShift(s: CashierShift): Record<string, unknown> {
    return {
      id: s.id,
      branchId: s.branchId,
      cashierUserId: s.cashierUserId,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt ? s.closedAt.toISOString() : null,
      openingCash: s.openingCash.toFixed(2),
      expectedCash: s.expectedCash ? s.expectedCash.toFixed(2) : null,
      actualCash: s.actualCash ? s.actualCash.toFixed(2) : null,
      note: s.note,
    };
  }

  async open(dto: OpenShiftInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    const existing = await this.prisma.db.cashierShift.findFirst({
      where: { cashierUserId: user.id, branchId, status: 'OPEN' },
    });
    if (existing) {
      throw new AppException(ErrorCode.SHIFT_ALREADY_OPEN, 'You already have an open shift in this branch', 409);
    }
    const shift = await this.prisma.db.cashierShift.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        branchId,
        cashierUserId: user.id,
        status: 'OPEN',
        openingCash: new Prisma.Decimal(dto.openingCash ?? '0'),
      },
    });
    return this.mapShift(shift);
  }

  /** Close the current shift and return the X/Z reconciliation report. */
  async close(dto: CloseShiftInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { cashierUserId: user.id, branchId, status: 'OPEN' },
    });
    if (!shift) {
      throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'No open shift in this branch', 409);
    }
    const closedAt = new Date();
    const zero = new Prisma.Decimal(0);

    const [cashInAgg, cashOutAgg, expenseAgg, byMethodRows] = await Promise.all([
      this.prisma.db.payment.aggregate({
        where: { shiftId: shift.id, method: 'CASH', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.db.refund.aggregate({
        where: { shiftId: shift.id, method: 'CASH' },
        _sum: { amount: true },
      }),
      // Money the clinic itself took out of this drawer. Without this the
      // cashier counts short by exactly the amount they were told to spend.
      this.prisma.db.expense.aggregate({
        where: { shiftId: shift.id, method: 'CASH', deletedAt: null },
        _sum: { amount: true },
      }),
      // Breakdown of everything this cashier received during the shift window
      // (cash rows are shift-linked; card/online rows match by receiver+time).
      this.prisma.db.payment.groupBy({
        by: ['method'],
        where: {
          status: 'COMPLETED',
          OR: [
            { shiftId: shift.id },
            { receivedById: user.id, branchId, paidAt: { gte: shift.openedAt, lte: closedAt } },
          ],
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const cashIn = cashInAgg._sum.amount ?? zero;
    const cashOut = cashOutAgg._sum.amount ?? zero;
    const expenseOut = expenseAgg._sum.amount ?? zero;
    const expectedCash = shift.openingCash.add(cashIn).sub(cashOut).sub(expenseOut);
    const actualCash = new Prisma.Decimal(dto.actualCash);
    const difference = actualCash.sub(expectedCash);

    const closed = await this.prisma.db.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'CLOSED',
        closedAt,
        expectedCash,
        actualCash,
        note: dto.note ?? null,
      },
    });

    return {
      shift: this.mapShift(closed),
      report: {
        openingCash: shift.openingCash.toFixed(2),
        cashIn: cashIn.toFixed(2),
        cashOut: cashOut.toFixed(2),
        expenseOut: expenseOut.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        actualCash: actualCash.toFixed(2),
        difference: difference.toFixed(2),
        byMethod: byMethodRows.map((row) => ({
          method: row.method,
          amount: (row._sum.amount ?? zero).toFixed(2),
          count: row._count._all,
        })),
      },
    };
  }

  async list(q: ShiftQuery): Promise<PaginatedResult<Record<string, unknown>>> {
    const where: Prisma.CashierShiftWhereInput = {
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.cashierShift.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        ...skipTake(q),
        include: { cashier: { select: { id: true, fullName: true } } },
      }),
      this.prisma.db.cashierShift.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...this.mapShift(r), cashier: r.cashier })),
      { page: q.page, limit: q.limit, total },
    );
  }

  /** Current user's open shift in the active branch (null when none). */
  async current(user: AuthUser, branchId: string): Promise<Record<string, unknown> | null> {
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { cashierUserId: user.id, branchId, status: 'OPEN' },
    });
    if (!shift) return null;
    const zero = new Prisma.Decimal(0);
    const now = new Date();
    const [cashInAgg, cashOutAgg, expenseAgg, transferRows] = await Promise.all([
      this.prisma.db.payment.aggregate({
        where: { shiftId: shift.id, method: 'CASH', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.db.refund.aggregate({
        where: { shiftId: shift.id, method: 'CASH' },
        _sum: { amount: true },
      }),
      this.prisma.db.expense.aggregate({
        where: { shiftId: shift.id, method: 'CASH', deletedAt: null },
        _sum: { amount: true },
      }),
      // Non-cash ("o'tkazma") received by this cashier during the shift window.
      // Card/online rows aren't shift-linked, so match by receiver + branch + time.
      this.prisma.db.payment.groupBy({
        by: ['method'],
        where: {
          status: 'COMPLETED',
          method: { not: 'CASH' },
          receivedById: shift.cashierUserId,
          branchId,
          paidAt: { gte: shift.openedAt, lte: now },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    const cashIn = cashInAgg._sum.amount ?? zero;
    const cashOut = cashOutAgg._sum.amount ?? zero;
    const expenseOut = expenseAgg._sum.amount ?? zero;
    const transferTotal = transferRows.reduce((acc, r) => acc.add(r._sum.amount ?? zero), zero);
    return {
      ...this.mapShift(shift),
      cashIn: cashIn.toFixed(2),
      cashOut: cashOut.toFixed(2),
      expenseOut: expenseOut.toFixed(2),
      expectedCashSoFar: shift.openingCash.add(cashIn).sub(cashOut).sub(expenseOut).toFixed(2),
      transferTotal: transferTotal.toFixed(2),
      transferByMethod: transferRows.map((r) => ({
        method: r.method,
        count: r._count._all,
        amount: (r._sum.amount ?? zero).toFixed(2),
      })),
    };
  }
}
