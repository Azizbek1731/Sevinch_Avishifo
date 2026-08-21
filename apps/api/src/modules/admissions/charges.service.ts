import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  type AddChargeInput,
  type AuthUser,
  type InvoiceChargesInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { InvoicesService } from '../billing/invoices.service';

/**
 * What a patient owes but has not been billed for yet.
 *
 * This is the ledger that makes "pay some now, the rest later" work the way
 * clinics actually operate: services are written as they are delivered — a
 * consultation, or a marked-off treatment day on the ward — and the desk later
 * bills whichever of them the patient is paying for. Some pay on arrival, some
 * at discharge, most somewhere in between.
 */
@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  private map(c: {
    id: string;
    admissionId: string | null;
    visitId: string | null;
    serviceId: string | null;
    title: Prisma.JsonValue;
    date: Date;
    quantity: number;
    unitPrice: Prisma.Decimal;
    status: string;
    createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: c.id,
      admissionId: c.admissionId,
      visitId: c.visitId,
      serviceId: c.serviceId,
      title: c.title,
      date: c.date.toISOString().slice(0, 10),
      quantity: c.quantity,
      unitPrice: c.unitPrice.toFixed(2),
      lineTotal: c.unitPrice.mul(c.quantity).toFixed(2),
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    };
  }

  /** Everything written to this patient, newest first, with the pending total. */
  async listForPatient(patientId: string, status?: string): Promise<Record<string, unknown>> {
    const where: Prisma.ChargeItemWhereInput = {
      patientId,
      ...(status ? { status: status as Prisma.EnumChargeStatusFilter['equals'] } : {}),
    };
    const [rows, pending] = await Promise.all([
      this.prisma.db.chargeItem.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 }),
      this.prisma.db.chargeItem.aggregate({
        where: { patientId, status: 'PENDING' },
        _sum: { unitPrice: true },
      }),
    ]);
    // Sum by line, not by unitPrice — quantity matters.
    const pendingTotal = rows
      .filter((r) => r.status === 'PENDING')
      .reduce((acc, r) => acc.add(r.unitPrice.mul(r.quantity)), new Prisma.Decimal(0));
    void pending;
    return {
      items: rows.map((r) => this.map(r)),
      pendingTotal: pendingTotal.toFixed(2),
    };
  }

  async add(dto: AddChargeInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Bemor topilmadi', 404);

    let title: Prisma.InputJsonValue = { uz: dto.title ?? '' };
    let unitPrice = dto.unitPrice ? new Prisma.Decimal(dto.unitPrice) : new Prisma.Decimal(0);

    if (dto.serviceId) {
      const service = await this.prisma.db.service.findFirst({ where: { id: dto.serviceId, isActive: true } });
      if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Xizmat topilmadi', 404);
      title = service.name as Prisma.InputJsonValue;
      if (!dto.unitPrice) {
        const price = await this.prisma.db.servicePrice.findFirst({
          where: { serviceId: dto.serviceId, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        });
        unitPrice = price?.price ?? new Prisma.Decimal(0);
      }
    } else if (!dto.title) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat yoki nom kiriting', 400);
    }

    const created = await this.prisma.db.chargeItem.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        branchId,
        patientId: dto.patientId,
        admissionId: dto.admissionId ?? null,
        visitId: dto.visitId ?? null,
        serviceId: dto.serviceId ?? null,
        title,
        date: new Date(dto.date),
        quantity: dto.quantity,
        unitPrice,
        createdById: user.id,
      },
    });
    return this.map(created);
  }

  async cancel(id: string): Promise<{ id: string }> {
    const c = await this.prisma.db.chargeItem.findFirst({ where: { id } });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Yozuv topilmadi', 404);
    if (c.status === 'INVOICED') {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Hisob-fakturaga kiritilgan xizmatni bekor qilib bo‘lmaydi',
        409,
      );
    }
    await this.prisma.db.chargeItem.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { id };
  }

  /**
   * Turns the ticked charges into one invoice.
   *
   * The selection is claimed with a status-guarded update BEFORE the invoice is
   * created, so two people billing overlapping selections cannot put the same
   * service on two bills — the second one finds nothing left to claim and is
   * told, rather than silently double-charging the patient.
   */
  async invoiceSelected(dto: InvoiceChargesInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
    const charges = await this.prisma.db.chargeItem.findMany({
      where: { id: { in: dto.chargeIds }, status: 'PENDING' },
      orderBy: { date: 'asc' },
    });
    if (charges.length === 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'To‘lanmagan xizmat tanlanmadi', 400);
    }
    const patientIds = new Set(charges.map((c) => c.patientId));
    if (patientIds.size > 1) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmatlar turli bemorlarga tegishli', 400);
    }
    const patientId = charges[0]!.patientId;

    const claimed = await this.prisma.db.chargeItem.updateMany({
      where: { id: { in: charges.map((c) => c.id) }, status: 'PENDING' },
      data: { status: 'INVOICED' },
    });
    if (claimed.count !== charges.length) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Tanlangan xizmatlardan bazilari allaqachon hisob-fakturaga kiritilgan',
        409,
      );
    }

    try {
      return await this.invoices.create(
        {
          patientId,
          branchId,
          lines: charges.map((c) => ({
            serviceId: c.serviceId ?? undefined,
            quantity: c.quantity,
            unitPrice: c.unitPrice.toFixed(2),
          })),
          issue: true,
        } as never,
        user,
      );
    } catch (e) {
      // The invoice failed, so the claim must not stand — otherwise the
      // services are marked billed with no bill behind them.
      await this.prisma.db.chargeItem.updateMany({
        where: { id: { in: charges.map((c) => c.id) } },
        data: { status: 'PENDING' },
      });
      throw e;
    }
  }
}
