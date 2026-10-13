import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CashierShift } from '@prisma/client';
import {
  ErrorCode,
  AuditAction,
  TRANSFER_METHODS,
  type AuthUser,
  type CloseShiftInput,
  type OpenShiftInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { reconcileAccounts, type AccountMovements } from './cash-accounts';

export interface ShiftQuery {
  page: number;
  limit: number;
  branchId?: string;
  status?: 'OPEN' | 'CLOSED';
}

const ZERO = new Prisma.Decimal(0);

/** Live account movements, plus legacy cash/transfer totals for old clients. */
interface RegisterTotals {
  movements: AccountMovements[];
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  private mapShift(s: CashierShift): Record<string, unknown> {
    return {
      id: s.id,
      branchId: s.branchId,
      cashierUserId: s.cashierUserId,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt ? s.closedAt.toISOString() : null,
      openingCash: s.openingCash.toFixed(2),
      openingCard: s.openingCard.toFixed(2),
      openingClick: s.openingClick.toFixed(2),
      expectedCard: s.expectedCard?.toFixed(2) ?? null,
      expectedClick: s.expectedClick?.toFixed(2) ?? null,
      actualCard: s.actualCard?.toFixed(2) ?? null,
      actualClick: s.actualClick?.toFixed(2) ?? null,
      openingTransfer: s.openingTransfer.toFixed(2),
      unallocatedOpeningTransfer: s.openingTransfer.sub(s.openingCard).sub(s.openingClick).toFixed(2),
      requiresOpeningAllocation: !s.openingTransfer.eq(s.openingCard.add(s.openingClick)),
      expectedCash: s.expectedCash ? s.expectedCash.toFixed(2) : null,
      actualCash: s.actualCash ? s.actualCash.toFixed(2) : null,
      expectedTransfer: s.expectedTransfer ? s.expectedTransfer.toFixed(2) : null,
      actualTransfer: s.actualTransfer ? s.actualTransfer.toFixed(2) : null,
      transferUnverifiedReason: s.transferUnverifiedReason,
      closedById: s.closedById,
      note: s.note,
    };
  }

  /** Reconciliation uses only explicitly linked money movements. */
  private async registerTotals(
    shiftId: string,
    db: Pick<typeof this.prisma.db, 'payment' | 'refund' | 'expense' | 'patientBalanceTransaction'> = this.prisma.db,
  ): Promise<RegisterTotals> {
    const [payments, refunds, expenses, deposits] = await Promise.all([
      db.payment.groupBy({ by: ['method'], where: { shiftId, status: 'COMPLETED', method: { not: 'BALANCE' } }, _sum: { amount: true }, _count: { _all: true } }),
      db.refund.groupBy({ by: ['method'], where: { shiftId, method: { not: 'BALANCE' } }, _sum: { amount: true } }),
      db.expense.groupBy({ by: ['method'], where: { shiftId, deletedAt: null }, _sum: { amount: true } }),
      db.patientBalanceTransaction.groupBy({ by: ['method'], where: { shiftId, type: 'DEPOSIT' }, _sum: { amount: true } }),
    ]);
    const methods = new Set<string>(['CASH', ...TRANSFER_METHODS]);
    const movements: AccountMovements[] = [...methods].map((method) => ({
      method,
      receipts: payments.find((r) => r.method === method)?._sum.amount ?? ZERO,
      deposits: deposits.find((r) => r.method === method)?._sum.amount ?? ZERO,
      refunds: refunds.find((r) => r.method === method)?._sum.amount ?? ZERO,
      expenses: expenses.find((r) => r.method === method)?._sum.amount ?? ZERO,
      count: payments.find((r) => r.method === method)?._count._all ?? 0,
    }));
    const cash = movements.find((r) => r.method === 'CASH')!;
    const transfer = movements.filter((r) => r.method !== 'CASH');
    const total = (key: 'receipts' | 'deposits' | 'refunds' | 'expenses'): Prisma.Decimal =>
      transfer.reduce((sum, row) => sum.add(row[key]), ZERO);
    return {
      movements,
      cashIn: cash.receipts, cashCount: cash.count, cashRefunds: cash.refunds,
      cashExpenses: cash.expenses, cashDeposits: cash.deposits,
      expectedCash: cash.receipts.add(cash.deposits).sub(cash.refunds).sub(cash.expenses),
      transferIn: total('receipts'), transferRefunds: total('refunds'),
      expectedTransfer: total('receipts').add(total('deposits')).sub(total('refunds')).sub(total('expenses')),
      transferByMethod: transfer.map((r) => ({ method: r.method, count: r.count, amount: r.receipts })),
    };
  }

  private accounts(shift: CashierShift, totals: RegisterTotals, counted = false) {
    return reconcileAccounts(totals.movements, {
      CASH: shift.openingCash, CARD: shift.openingCard, CLICK: shift.openingClick,
    }, counted ? { CASH: shift.actualCash, CARD: shift.actualCard, CLICK: shift.actualClick } : undefined);
  }

  async open(dto: OpenShiftInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    if (this.config.env.SINGLE_CLINIC_MODE && new Prisma.Decimal(dto.openingTransfer ?? '0').gt(0)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Karta va Click boshlang‘ich qoldiqlarini alohida kiriting', 400);
    }
    // ONE register per branch. Per-user drawers made the owner, reception and
    // the cashier each see "the" register and each see a different one; the
    // clinics this is sold to run one physical box, so the model matches that
    // now. A partial unique index backs this check against a race.
    const open = await this.prisma.db.cashierShift.findFirst({
      where: { branchId, status: 'OPEN' },
      include: { cashier: { select: { fullName: true } } },
    });
    if (open) {
      throw new AppException(
        ErrorCode.SHIFT_ALREADY_OPEN,
        `Kassa allaqachon ochiq (${open.cashier.fullName} ochgan). Avval uni yoping.`,
        409,
      );
    }

    // The header value is checked against the caller's branch list, but an
    // owner's empty list means "all branches" — of their OWN clinic. The
    // partial unique index is global, so an unvalidated id could lock another
    // clinic's register.
    const branch = await this.prisma.db.branch.findFirst({ where: { id: branchId } });
    if (!branch) throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);

    try {
      const shift = await this.prisma.db.cashierShift.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: TenantContext.requireClinicId(),
          branchId,
          cashierUserId: user.id,
          status: 'OPEN',
          openingCash: new Prisma.Decimal(dto.openingCash ?? '0'),
          openingCard: new Prisma.Decimal(dto.openingCard ?? '0'),
          openingClick: new Prisma.Decimal(dto.openingClick ?? '0'),
          openingTransfer: this.config.env.SINGLE_CLINIC_MODE
            ? new Prisma.Decimal(dto.openingCard ?? '0').add(dto.openingClick ?? '0')
            : new Prisma.Decimal(dto.openingTransfer ?? '0'),
        },
      });
      await this.audit.log({ action: AuditAction.CREATE, entity: 'CashierShift', entityId: shift.id, after: this.mapShift(shift) });
      return this.mapShift(shift);
    } catch (e) {
      // Two people pressed open at once: the partial unique index caught what
      // the check above raced past. Same answer as the slow path, not a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppException(ErrorCode.SHIFT_ALREADY_OPEN, 'Kassa allaqachon ochiq.', 409);
      }
      throw e;
    }
  }

  /** Close the branch register and return the X/Z reconciliation report. */
  async close(dto: CloseShiftInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    if (this.config.env.SINGLE_CLINIC_MODE && (dto.actualCard === undefined || dto.actualClick === undefined)) {
      throw new AppException(ErrorCode.TRANSFER_COUNT_REQUIRED, 'Naqd, karta va Click yakuniy qoldiqlarini alohida kiriting', 400);
    }
    // Not filtered by opener: the register belongs to the branch, and whoever
    // holds shifts.manage may count it out. closedById records who did.
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { branchId, status: 'OPEN' },
    });
    if (!shift) {
      throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'No open shift in this branch', 409);
    }

    // One closer wins. The status flip is the claim: it is guarded, so a
    // second simultaneous closer gets a 409 instead of silently overwriting a
    // signed-off Z-report, and it holds the row lock, so a payment that
    // re-checks the register FOR SHARE either commits before the flip (and is
    // counted below) or sees CLOSED and refuses. Totals are computed inside
    // the same transaction for exactly that reason.
    const closedAt = new Date();
    const closed = await this.prisma.db.$transaction(async (tx) => {
      const claimed = await tx.cashierShift.updateMany({
        where: { id: shift.id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt, closedById: user.id },
      });
      if (claimed.count === 0) {
        throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'No open shift in this branch', 409);
      }

      const unallocated = shift.openingTransfer.sub(shift.openingCard).sub(shift.openingClick);
      let accountShift = shift;
      if (this.config.env.SINGLE_CLINIC_MODE && !unallocated.eq(0)) {
        if (dto.openingCard === undefined || dto.openingClick === undefined ||
            !new Prisma.Decimal(dto.openingCard).add(dto.openingClick).eq(shift.openingTransfer)) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Avval eski o‘tkazma boshlang‘ich qoldig‘ini karta va Click o‘rtasida to‘liq taqsimlang', 400);
        }
        accountShift = await tx.cashierShift.update({ where: { id: shift.id }, data: {
          openingCard: new Prisma.Decimal(dto.openingCard), openingClick: new Prisma.Decimal(dto.openingClick),
        } });
      } else if (dto.openingCard !== undefined || dto.openingClick !== undefined) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Smena boshlang‘ich qoldiqlarini o‘zgartirib bo‘lmaydi', 400);
      }
      const totals = await this.registerTotals(shift.id, tx);
      const expectedCash = shift.openingCash.add(totals.expectedCash);
      const actualCash = new Prisma.Decimal(dto.actualCash);
      const expectedTransfer = shift.openingTransfer.add(totals.expectedTransfer);

      // Both books opened with a counted figure, so both close with one — or
      // with a stated reason. Throwing here rolls the claim back and the
      // register stays open.
      const actualCard = dto.actualCard === undefined ? null : new Prisma.Decimal(dto.actualCard);
      const actualClick = dto.actualClick === undefined ? null : new Prisma.Decimal(dto.actualClick);
      const separateAccounts = this.accounts(accountShift, totals);
      const expectedCard = new Prisma.Decimal(separateAccounts.find((a) => a.method === 'CARD')!.expected);
      const expectedClick = new Prisma.Decimal(separateAccounts.find((a) => a.method === 'CLICK')!.expected);
      const transferInput = actualCard !== null && actualClick !== null ? actualCard.add(actualClick).toFixed(2) : dto.actualTransfer;
      const counted = transferInput !== undefined && transferInput !== '';
      const reason = dto.transferUnverifiedReason?.trim();
      if (expectedTransfer.gt(0) && !counted && !reason) {
        throw new AppException(
          ErrorCode.TRANSFER_COUNT_REQUIRED,
          'O‘tkazma kassasi uchun yakuniy summani kiriting yoki nima uchun aniqlab bo‘lmaganini yozing',
          400,
        );
      }
      const actualTransfer = counted ? new Prisma.Decimal(transferInput as string) : null;
      const unverifiedReason = counted ? null : (reason ?? 'O‘tkazma harakati bo‘lmagan');

      const row = await tx.cashierShift.update({
        where: { id: shift.id },
        data: {
          expectedCash,
          actualCash,
          expectedCard, expectedClick, actualCard, actualClick,
          expectedTransfer,
          actualTransfer,
          transferUnverifiedReason: unverifiedReason,
          note: dto.note ?? null,
        },
      });
      return { row, totals, expectedCash, actualCash, expectedTransfer, actualTransfer, unverifiedReason };
    });

    const { totals, expectedCash, actualCash, expectedTransfer, actualTransfer, unverifiedReason } = closed;

    await this.audit.log({ action: AuditAction.UPDATE, entity: 'CashierShift', entityId: shift.id, before: { status: 'OPEN' }, after: this.mapShift(closed.row) });
    return {
      shift: this.mapShift(closed.row),
      report: {
        accounts: this.accounts(closed.row, totals, true),
        openingCash: shift.openingCash.toFixed(2),
        openingTransfer: shift.openingTransfer.toFixed(2),
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

  /**
   * The branch register (null when none is open).
   *
   * Deliberately NOT filtered by caller: everyone in the branch reads the same
   * register, which is the entire point of the redesign — two accounts showing
   * two different totals for "the" kassa is the confusion this replaces.
   */
  async current(_user: AuthUser, branchId: string): Promise<Record<string, unknown> | null> {
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { branchId, status: 'OPEN' },
      include: { cashier: { select: { id: true, fullName: true } } },
    });
    if (!shift) return null;

    const totals = await this.registerTotals(shift.id);
    return {
      ...this.mapShift(shift),
      open: true,
      cashier: shift.cashier,
      accounts: this.accounts(shift, totals),
      expectedCardSoFar: this.accounts(shift, totals).find((a) => a.method === 'CARD')!.expected,
      expectedClickSoFar: this.accounts(shift, totals).find((a) => a.method === 'CLICK')!.expected,

      cashIn: totals.cashIn.toFixed(2),
      cashDeposits: totals.cashDeposits.toFixed(2),
      cashOut: totals.cashRefunds.toFixed(2),
      expenseOut: totals.cashExpenses.toFixed(2),
      expectedCashSoFar: shift.openingCash.add(totals.expectedCash).toFixed(2),

      transferTotal: shift.openingTransfer.add(totals.expectedTransfer).toFixed(2),
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
  async currentPayments(_user: AuthUser, branchId: string): Promise<Record<string, unknown>[]> {
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { branchId, status: 'OPEN' },
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
      note: p.note,
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
          accounts: this.accounts(s, t),
          unallocatedOpeningTransfer: s.openingTransfer.sub(s.openingCard).sub(s.openingClick).toFixed(2),
          cashier: s.cashier,
          openedAt: s.openedAt.toISOString(),
          openingCash: s.openingCash.toFixed(2),
          openingTransfer: s.openingTransfer.toFixed(2),
          expectedCash: s.openingCash.add(t.expectedCash).toFixed(2),
          transferTotal: s.openingTransfer.add(t.expectedTransfer).toFixed(2),
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
        unallocatedOpeningTransfer: sum((r) => r.unallocatedOpeningTransfer),
        accounts: (['CASH', 'CARD', 'CLICK'] as const).map((method) => {
          const rows = registers.flatMap((r) => r.accounts).filter((a) => a.method === method);
          const sumField = (key: 'opening' | 'receipts' | 'deposits' | 'refunds' | 'expenses' | 'expected') => rows.reduce((acc, a) => acc.add(a[key]), ZERO).toFixed(2);
          return { method, opening: sumField('opening'), receipts: sumField('receipts'), deposits: sumField('deposits'), refunds: sumField('refunds'), expenses: sumField('expenses'), expected: sumField('expected'), actual: null, difference: null };
        }),
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
