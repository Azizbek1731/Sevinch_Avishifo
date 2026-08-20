import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CashierShift } from '@prisma/client';
import {
  ErrorCode,
  TRANSFER_METHODS,
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

const ZERO = new Prisma.Decimal(0);

/**
 * What both registers hold at a moment in time.
 *
 * The governing rule, and the reason this is computed in exactly one place:
 * **every som is registered once, in the register that received it.** Cash into
 * the drawer, card and online into the transfer register, a patient's own
 * balance into neither — that money was already registered on the day it
 * arrived, and counting it again when it is spent counts it twice.
 */
interface RegisterTotals {
  cashIn: Prisma.Decimal;
  cashCount: number;
  cashRefunds: Prisma.Decimal;
  cashExpenses: Prisma.Decimal;
  cashDeposits: Prisma.Decimal;
  expectedCash: Prisma.Decimal;
  transferIn: Prisma.Decimal;
  transferRefunds: Prisma.Decimal;
  expectedTransfer: Prisma.Decimal;
  transferByMethod: Array<{ method: string; count: number; amount: Prisma.Decimal }>;
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
      expectedTransfer: s.expectedTransfer ? s.expectedTransfer.toFixed(2) : null,
      actualTransfer: s.actualTransfer ? s.actualTransfer.toFixed(2) : null,
      transferUnverifiedReason: s.transferUnverifiedReason,
      closedById: s.closedById,
      note: s.note,
    };
  }

  /**
   * Both registers for one shift, from the shift link alone.
   *
   * Everything counted here is linked by shiftId. The old code re-derived the
   * transfer figure from "whoever received money in this branch inside the
   * shift's time window", which meant the number the cashier watched all day
   * and the number printed when the drawer closed were produced by two
   * different rules and were free to disagree.
   */
  private async registerTotals(shiftId: string): Promise<RegisterTotals> {
    const [cashInAgg, cashRefundAgg, expenseAgg, depositAgg, transferRows, transferRefundAgg] =
      await Promise.all([
        this.prisma.db.payment.aggregate({
          where: { shiftId, method: 'CASH', status: 'COMPLETED' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.db.refund.aggregate({
          where: { shiftId, method: 'CASH' },
          _sum: { amount: true },
        }),
        this.prisma.db.expense.aggregate({
          where: { shiftId, method: 'CASH', deletedAt: null },
          _sum: { amount: true },
        }),
        // Cash handed over as a deposit is in the drawer like any other note.
        this.prisma.db.patientBalanceTransaction.aggregate({
          where: { shiftId, method: 'CASH' },
          _sum: { amount: true },
        }),
        this.prisma.db.payment.groupBy({
          by: ['method'],
          where: { shiftId, status: 'COMPLETED', method: { in: [...TRANSFER_METHODS] } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.db.refund.aggregate({
          where: { shiftId, method: { in: [...TRANSFER_METHODS] } },
          _sum: { amount: true },
        }),
      ]);

    const cashIn = cashInAgg._sum.amount ?? ZERO;
    const cashCount = cashInAgg._count._all;
    const cashRefunds = cashRefundAgg._sum.amount ?? ZERO;
    const cashExpenses = expenseAgg._sum.amount ?? ZERO;
    const cashDeposits = depositAgg._sum.amount ?? ZERO;
    const transferIn = transferRows.reduce((acc, r) => acc.add(r._sum.amount ?? ZERO), ZERO);
    const transferRefunds = transferRefundAgg._sum.amount ?? ZERO;

    return {
      cashIn,
      cashCount,
      cashRefunds,
      cashExpenses,
      cashDeposits,
      // The opening float is added by the caller, which is the only part that
      // depends on the shift row rather than on its movements.
      expectedCash: cashIn.add(cashDeposits).sub(cashRefunds).sub(cashExpenses),
      transferIn,
      transferRefunds,
      // Net of refunds, because a card refund nets off the acquirer's own slip.
      // Deliberately NOT reduced by non-cash expenses: those leave the clinic's
      // bank account, not the incoming acquiring stream being reconciled here.
      expectedTransfer: transferIn.sub(transferRefunds),
      transferByMethod: transferRows.map((r) => ({
        method: r.method,
        count: r._count._all,
        amount: r._sum.amount ?? ZERO,
      })),
    };
  }

  async open(dto: OpenShiftInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    const mine = await this.prisma.db.cashierShift.findFirst({
      where: { cashierUserId: user.id, branchId, status: 'OPEN' },
    });
    if (mine) {
      throw new AppException(ErrorCode.SHIFT_ALREADY_OPEN, 'You already have an open shift in this branch', 409);
    }

    // Somebody else already holding a drawer here is legitimate — two windows
    // at one reception is a real arrangement — but it is far more often a
    // manager opening one by accident and then reading their own empty drawer
    // as the clinic's takings. So it is allowed, once it has been said out loud.
    if (!dto.confirmSecondDrawer) {
      const other = await this.prisma.db.cashierShift.findFirst({
        where: { branchId, status: 'OPEN' },
        include: { cashier: { select: { fullName: true } } },
      });
      if (other) {
        throw new AppException(
          ErrorCode.BRANCH_DRAWER_ALREADY_OPEN,
          `${other.cashier.fullName} bu filialda kassa ochgan. O‘zingizga alohida kassa ochmoqchimisiz?`,
          409,
        );
      }
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

    const totals = await this.registerTotals(shift.id);
    const expectedCash = shift.openingCash.add(totals.expectedCash);
    const actualCash = new Prisma.Decimal(dto.actualCash);
    const expectedTransfer = totals.expectedTransfer;

    // A transfer figure can be counted — off the terminal's own sverka and the
    // PSP cabinets — and that comparison catches real errors: a payment taken
    // on the terminal and never keyed in, a receipt entered twice, a card
    // payment recorded as cash. But an acquirer's batch cut-off rarely lines up
    // with a shift boundary, so "I could not check" has to be a first-class
    // answer rather than a number someone was forced to invent.
    const counted = dto.actualTransfer !== undefined && dto.actualTransfer !== '';
    const reason = dto.transferUnverifiedReason?.trim();
    if (expectedTransfer.gt(0) && !counted && !reason) {
      throw new AppException(
        ErrorCode.TRANSFER_COUNT_REQUIRED,
        'O‘tkazma kassada harakat bo‘lgan — terminal hisobotidagi summani kiriting yoki sababini yozing',
        400,
      );
    }
    const actualTransfer = counted ? new Prisma.Decimal(dto.actualTransfer as string) : null;
    const unverifiedReason = counted
      ? null
      : (reason ?? 'O‘tkazma harakati bo‘lmagan');

    const closedAt = new Date();
    const closed = await this.prisma.db.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'CLOSED',
        closedAt,
        closedById: user.id,
        expectedCash,
        actualCash,
        expectedTransfer,
        actualTransfer,
        transferUnverifiedReason: unverifiedReason,
        note: dto.note ?? null,
      },
    });

    return {
      shift: this.mapShift(closed),
      report: {
        openingCash: shift.openingCash.toFixed(2),
        cashIn: totals.cashIn.toFixed(2),
        cashDeposits: totals.cashDeposits.toFixed(2),
        cashOut: totals.cashRefunds.toFixed(2),
        expenseOut: totals.cashExpenses.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        actualCash: actualCash.toFixed(2),
        difference: actualCash.sub(expectedCash).toFixed(2),

        transferIn: totals.transferIn.toFixed(2),
        transferRefunds: totals.transferRefunds.toFixed(2),
        expectedTransfer: expectedTransfer.toFixed(2),
        actualTransfer: actualTransfer ? actualTransfer.toFixed(2) : null,
        // Never a shortage: nobody can be short of money they never held. A gap
        // here means two ledgers disagree and somebody has to look.
        transferDifference: actualTransfer ? actualTransfer.sub(expectedTransfer).toFixed(2) : null,
        transferUnverifiedReason: unverifiedReason,

        byMethod: [
          { method: 'CASH', amount: totals.cashIn.toFixed(2), count: totals.cashCount },
          ...totals.transferByMethod.map((row) => ({
            method: row.method,
            amount: row.amount.toFixed(2),
            count: row.count,
          })),
        ],
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
      include: { cashier: { select: { id: true, fullName: true } } },
    });
    if (!shift) {
      // Whether anyone else is holding a drawer here, so the screen can say so
      // instead of leaving a manager to conclude the clinic has taken nothing.
      const others = await this.prisma.db.cashierShift.count({
        where: { branchId, status: 'OPEN' },
      });
      return others > 0 ? { open: false, otherDrawers: others } : null;
    }

    const totals = await this.registerTotals(shift.id);
    return {
      ...this.mapShift(shift),
      open: true,
      cashier: shift.cashier,
      otherDrawers: await this.prisma.db.cashierShift.count({
        where: { branchId, status: 'OPEN', id: { not: shift.id } },
      }),

      cashIn: totals.cashIn.toFixed(2),
      cashDeposits: totals.cashDeposits.toFixed(2),
      cashOut: totals.cashRefunds.toFixed(2),
      expenseOut: totals.cashExpenses.toFixed(2),
      expectedCashSoFar: shift.openingCash.add(totals.expectedCash).toFixed(2),

      transferTotal: totals.expectedTransfer.toFixed(2),
      transferRefunds: totals.transferRefunds.toFixed(2),
      transferByMethod: totals.transferByMethod.map((r) => ({
        method: r.method,
        count: r.count,
        amount: r.amount.toFixed(2),
      })),
    };
  }

  /**
   * The money this drawer has taken, newest first.
   *
   * The undo for a mistyped payment has existed since the void was built, but
   * only inside the invoice — and a paid invoice leaves the cashier's pending
   * list the moment it is settled, so at the exact moment somebody notices the
   * mistake there is no way to reach it. This is that way.
   */
  async currentPayments(user: AuthUser, branchId: string): Promise<Record<string, unknown>[]> {
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { cashierUserId: user.id, branchId, status: 'OPEN' },
      select: { id: true },
    });
    if (!shift) return [];

    const rows = await this.prisma.db.payment.findMany({
      where: { shiftId: shift.id, status: { in: ['COMPLETED', 'VOIDED'] } },
      orderBy: { paidAt: 'desc' },
      take: 100,
      include: {
        invoice: {
          select: { id: true, number: true, patient: { select: { fullName: true } } },
        },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      amount: p.amount.toFixed(2),
      method: p.method,
      status: p.status,
      paidAt: p.paidAt.toISOString(),
      invoiceId: p.invoiceId,
      invoiceNumber: p.invoice.number,
      patientName: p.invoice.patient?.fullName ?? null,
    }));
  }

  /**
   * Every open register in the branch, for the people who supervise them.
   *
   * This is the number that has never existed anywhere in the product: an owner
   * could see a count of open shifts on the dashboard and nothing else, so the
   * only way to look at the clinic's money was to open a drawer of their own —
   * which then showed them their own empty one.
   */
  async overview(branchId: string): Promise<Record<string, unknown>> {
    const shifts = await this.prisma.db.cashierShift.findMany({
      where: { branchId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      include: { cashier: { select: { id: true, fullName: true } } },
    });

    const registers = await Promise.all(
      shifts.map(async (s) => {
        const t = await this.registerTotals(s.id);
        return {
          shiftId: s.id,
          cashier: s.cashier,
          openedAt: s.openedAt.toISOString(),
          openingCash: s.openingCash.toFixed(2),
          expectedCash: s.openingCash.add(t.expectedCash).toFixed(2),
          transferTotal: t.expectedTransfer.toFixed(2),
        };
      }),
    );

    const sum = (pick: (r: (typeof registers)[number]) => string): string =>
      registers.reduce((acc, r) => acc.add(new Prisma.Decimal(pick(r))), ZERO).toFixed(2);

    // Money that belongs to the branch's day but to no person: online payments
    // arrive through a webhook with nobody at the desk. Attributing them to
    // whoever happened to have a drawer open would make it impossible for that
    // cashier to ever balance.
    const unattached = await this.prisma.db.payment.aggregate({
      where: {
        branchId,
        status: 'COMPLETED',
        shiftId: null,
        method: { in: [...TRANSFER_METHODS] },
        paidAt: { gte: startOfToday() },
      },
      _sum: { amount: true },
    });

    return {
      registers,
      totals: {
        expectedCash: sum((r) => r.expectedCash),
        transferTotal: sum((r) => r.transferTotal),
        openDrawers: registers.length,
      },
      unattachedOnlineToday: (unattached._sum.amount ?? ZERO).toFixed(2),
    };
  }
}

/** Midnight in Tashkent, as an instant. */
function startOfToday(): Date {
  const now = new Date();
  const tashkent = new Date(now.getTime() + 5 * 3600_000);
  tashkent.setUTCHours(0, 0, 0, 0);
  return new Date(tashkent.getTime() - 5 * 3600_000);
}
