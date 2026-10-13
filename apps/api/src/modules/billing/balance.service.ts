import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PatientBalanceTransaction } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type AddDepositInput,
  type AuthUser,
  type DebtorQueryInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { skipTake } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { assertManualMethod, lockOpenShift } from './cash-accounts';

@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  private mapTransaction(t: PatientBalanceTransaction): Record<string, unknown> {
    return {
      id: t.id,
      patientId: t.patientId,
      type: t.type,
      method: t.method,
      shiftId: t.shiftId,
      amount: t.amount.toFixed(2),
      invoiceId: t.invoiceId,
      note: t.note,
      createdById: t.createdById,
      createdAt: t.createdAt.toISOString(),
    };
  }

  /** Credit a patient deposit and its receiving cash account atomically. */
  async addDeposit(
    patientId: string,
    dto: AddDepositInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    assertManualMethod(dto.method, this.config.env.SINGLE_CLINIC_MODE);
    if (dto.patientId !== patientId) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'patientId mismatch between path and body', 400);
    }
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    // Deposits are real receipts; applying them to an invoice later is not.
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { branchId, status: 'OPEN' },
    });
    if (!shift && (this.config.env.SINGLE_CLINIC_MODE || dto.method === 'CASH')) {
      throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Open cashier shift required for cash deposits', 409);
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Amount must be positive', 400);

    const { tx, balance } = await this.prisma.db.$transaction(async (db) => {
      // Same rule as payments: the register must still be open when the row
      // lands, and the share lock makes a racing close() count this deposit.
      const liveShiftId = await lockOpenShift(db, shift?.id ?? null, this.config.env.SINGLE_CLINIC_MODE || dto.method === 'CASH');
      const updated = await db.patient.update({
        where: { id: patientId },
        data: { balance: { increment: amount } },
        select: { balance: true },
      });
      const created = await db.patientBalanceTransaction.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: TenantContext.requireClinicId(),
          patientId,
          type: 'DEPOSIT',
          amount,
          // Recorded so the drawer knows about it. Without this the cash was
          // physically in the till and invisible to the system, and the shift
          // closed over by exactly the deposit every time.
          shiftId: liveShiftId,
          method: dto.method,
          note: dto.note ?? null,
          createdById: user.id,
        },
      });
      return { tx: created, balance: updated.balance };
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'PatientBalanceTransaction',
      entityId: tx.id,
      after: { patientId, type: 'DEPOSIT', amount: amount.toFixed(2), method: dto.method, shiftId: tx.shiftId },
    });

    return { balance: balance.toFixed(2), transaction: this.mapTransaction(tx) };
  }

  async getBalance(
    patientId: string,
    q: { page: number; limit: number },
  ): Promise<Record<string, unknown>> {
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { balance: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    const where: Prisma.PatientBalanceTransactionWhereInput = { patientId };
    const [rows, total] = await Promise.all([
      this.prisma.db.patientBalanceTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.db.patientBalanceTransaction.count({ where }),
    ]);

    return {
      balance: patient.balance.toFixed(2),
      transactions: {
        items: rows.map((r) => this.mapTransaction(r)),
        meta: { page: q.page, limit: q.limit, total },
      },
    };
  }

  /**
   * Debtors: patients with an unpaid remainder on ISSUED/PARTIALLY_PAID
   * invoices. Aggregated per patient with the oldest open invoice date and the
   * clinic-wide total debt. Grouped in the DB, ranked/paged in memory (the
   * debtor set per clinic is small).
   */
  async debtors(q: DebtorQueryInput): Promise<Record<string, unknown>> {
    const groups = await this.prisma.db.invoice.groupBy({
      by: ['patientId'],
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      _sum: { total: true, paidTotal: true },
      _min: { issuedAt: true, createdAt: true },
    });

    const zero = new Prisma.Decimal(0);
    const minDebt = q.minDebt !== undefined ? new Prisma.Decimal(q.minDebt) : null;
    const debtorRows = groups
      .map((g) => ({
        patientId: g.patientId,
        debt: (g._sum.total ?? zero).sub(g._sum.paidTotal ?? zero),
        oldestInvoiceDate: g._min.issuedAt ?? g._min.createdAt ?? null,
      }))
      .filter((d) => d.debt.gt(0) && (minDebt === null || d.debt.gte(minDebt)))
      .sort((a, b) => b.debt.cmp(a.debt));

    const totalDebt = debtorRows.reduce((acc, d) => acc.add(d.debt), zero);
    const total = debtorRows.length;
    const { skip, take } = skipTake(q);
    const page = debtorRows.slice(skip, skip + take);

    const patients = await this.prisma.db.patient.findMany({
      where: { id: { in: page.map((d) => d.patientId) } },
      select: { id: true, mrn: true, fullName: true, phone: true },
    });
    const patientById = new Map(patients.map((p) => [p.id, p]));

    return {
      items: page.map((d) => ({
        patient: patientById.get(d.patientId) ?? { id: d.patientId },
        debt: d.debt.toFixed(2),
        oldestInvoiceDate: d.oldestInvoiceDate ? d.oldestInvoiceDate.toISOString() : null,
      })),
      meta: { page: q.page, limit: q.limit, total },
      totalDebt: totalDebt.toFixed(2),
    };
  }
}
