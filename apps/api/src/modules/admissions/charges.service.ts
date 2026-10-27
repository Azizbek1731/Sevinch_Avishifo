import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type ChargeQueryInput,
  type AddChargeInput,
  type AuthUser,
  type InvoiceChargesInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { PricingService } from '../services/pricing.service';
import { InvoicesService } from '../billing/invoices.service';
import { LabService } from '../lab/lab.service';

/**
 * Patient charge ledger. Walk-in costs are issued to the cashier immediately.
 * Costs on an ACTIVE admission stay PENDING on the inpatient account and are
 * invoiced at discharge (or when the desk raises a bill explicitly).
 */
@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly lab: LabService,
  ) {}

  private map(c: {
    id: string;
    admissionId: string | null;
    visitId: string | null;
    serviceId: string | null;
    surgeryId?: string | null;
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
      surgeryId: c.surgeryId ?? null,
      title: c.title,
      date: c.date.toISOString().slice(0, 10),
      quantity: c.quantity,
      unitPrice: c.unitPrice.toFixed(2),
      lineTotal: c.unitPrice.mul(c.quantity).toFixed(2),
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    };
  }

  /** Pending total covers the complete filtered ledger, independent of display limit. */
  async listForPatient(
    query: ChargeQueryInput,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const scope = {
      patientId: query.patientId,
      branchId,
      ...(query.admissionId ? { admissionId: query.admissionId } : {}),
    };
    const [rows, pending] = await Promise.all([
      this.prisma.db.chargeItem.findMany({
        where: { ...scope, ...(query.status ? { status: query.status } : {}) },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
      this.prisma.db.chargeItem.findMany({
        where: { ...scope, status: 'PENDING' },
        select: { unitPrice: true, quantity: true },
      }),
    ]);
    const pendingTotal = pending.reduce(
      (acc, r) => acc.add(r.unitPrice.mul(r.quantity)),
      new Prisma.Decimal(0),
    );
    return { items: rows.map((r) => this.map(r)), pendingTotal: pendingTotal.toFixed(2) };
  }

  async add(
    dto: AddChargeInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    if (user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    const clinicId = TenantContext.requireClinicId();
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      branchId, patientId: dto.patientId, admissionId: dto.admissionId ?? null,
      visitId: dto.visitId ?? null, serviceId: dto.serviceId ?? null,
      title: dto.title ?? null, date: dto.date, quantity: dto.quantity,
      unitPrice: dto.unitPrice === undefined ? null : new Prisma.Decimal(dto.unitPrice).toFixed(2),
    })).digest('hex');
    const result = await this.prisma.db.$transaction(async (tx) => {
      if (dto.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':charge:' + dto.idempotencyKey}, 0))`;
        const replay = await tx.chargeItem.findFirst({ where: { requestKey: dto.idempotencyKey } });
        if (replay) {
          if (replay.requestFingerprint !== requestFingerprint) {
            throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu so‘rov kaliti boshqa xarajat uchun ishlatilgan', 409);
          }
          return { charge: replay, created: false };
        }
      }
      const patient = await tx.patient.findFirst({
        where: { id: dto.patientId, deletedAt: null },
        select: { id: true },
      });
      if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Bemor topilmadi', 404);

      if (dto.admissionId) {
        await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${dto.admissionId} AND "clinicId" = ${clinicId} AND "branchId" = ${branchId} FOR UPDATE`;
        const admission = await tx.admission.findFirst({
          where: { id: dto.admissionId, patientId: dto.patientId, branchId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!admission)
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Faol statsionar yozuvi topilmadi', 400);
      }
      if (dto.visitId) {
        const visit = await tx.visit.findFirst({
          where: { id: dto.visitId, patientId: dto.patientId, branchId },
          select: { id: true },
        });
        if (!visit) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bemor qabuli topilmadi', 400);
      }

      let title: Prisma.InputJsonValue = { uz: dto.title ?? '' };
      let unitPrice = dto.unitPrice ? new Prisma.Decimal(dto.unitPrice) : new Prisma.Decimal(0);
      let serviceKind: string | null = null;

      if (dto.serviceId) {
        const service = await tx.service.findFirst({
          where: { id: dto.serviceId, isActive: true },
          include: { category: { select: { kind: true } } },
        });
        if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Xizmat topilmadi', 404);
        if (service.category.kind === 'SURGERY') throw new AppException(ErrorCode.VALIDATION_ERROR, 'Operatsiyani statsionar kartasining Operatsiyalar bo‘limidan kiriting', 400);
        serviceKind = service.category.kind;
        title = service.name as Prisma.InputJsonValue;
        if (!dto.unitPrice) {
          const price = await this.pricing.getCurrentPrice(dto.serviceId, branchId);
          if (price === null)
            throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat narxi belgilanmagan', 400);
          unitPrice = new Prisma.Decimal(price);
        }
      } else if (!dto.title || dto.unitPrice === undefined) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat yoki nom va narx kiriting', 400);
      }

      const charge = await tx.chargeItem.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId,
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
          requestKey: dto.idempotencyKey ?? null,
          requestFingerprint: dto.idempotencyKey ? requestFingerprint : null,
        },
      });
      // Inpatient: leave on the stay account until discharge. Walk-in: bill now.
      if (!dto.admissionId) {
        await this.invoices.issueChargesInTransaction(tx, [charge.id], user, branchId);
      } else if (serviceKind === 'LAB' && dto.serviceId) {
        await this.lab.prepareInpatientOrderForCharge(tx, {
          patientId: dto.patientId,
          branchId,
          serviceId: dto.serviceId,
          visitId: dto.visitId ?? null,
          orderedById: user.id,
        });
      }
      return { charge: await tx.chargeItem.findFirstOrThrow({ where: { id: charge.id } }), created: true };
    });
    if (result.created) await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'ChargeItem',
      entityId: result.charge.id,
      after: {
        patientId: dto.patientId,
        admissionId: dto.admissionId ?? null,
        branchId,
        quantity: result.charge.quantity,
        unitPrice: result.charge.unitPrice.toFixed(2),
      },
    });
    return this.map(result.charge);
  }

  async cancel(id: string, branchId: string): Promise<{ id: string }> {
    const c = await this.prisma.db.chargeItem.findFirst({ where: { id, branchId } });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Yozuv topilmadi', 404);
    if (c.surgeryId) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Operatsiya xarajatini operatsiya kartasidan bekor qiling', 409);
    if (c.status === 'INVOICED') {
      // …unless the bill it was on is gone. Cancelling an invoice used to leave
      // its services INVOICED forever: unbillable because already claimed, and
      // unremovable because of this check. Nothing could then close the stay.
      const line = c.invoiceLineId
        ? await this.prisma.db.invoiceLine.findFirst({
            where: { id: c.invoiceLineId },
            select: { invoice: { select: { status: true } } },
          })
        : null;
      const billIsGone = line === null || line.invoice.status === 'CANCELLED';
      if (!billIsGone) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Xizmat hisob-fakturada — avval hisob-fakturani bekor qiling',
          409,
        );
      }
    }
    const changed = await this.prisma.db.chargeItem.updateMany({
      where: { id, branchId, status: c.status, invoiceLineId: c.invoiceLineId },
      data: { status: 'CANCELLED' },
    });
    if (changed.count !== 1)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Xizmat holati o‘zgardi, sahifani yangilang',
        409,
      );
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'ChargeItem',
      entityId: id,
      before: { status: c.status },
      after: { status: 'CANCELLED' },
    });
    return { id };
  }

  /** Claims, invoice lines and issuance commit together in InvoicesService. */
  async invoiceSelected(
    dto: InvoiceChargesInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const ids = [...new Set(dto.chargeIds)];
    const charges = await this.prisma.db.chargeItem.findMany({
      where: { id: { in: ids }, branchId, status: 'PENDING', invoiceLineId: null },
      orderBy: { date: 'asc' },
    });
    if (charges.length !== ids.length || ids.length === 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Xizmatlar holati o‘zgargan yoki boshqa filialga tegishli',
        409,
      );
    }
    if (new Set(charges.map((c) => c.patientId)).size !== 1) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Xizmatlar turli bemorlarga tegishli',
        400,
      );
    }
    return this.invoices.create(
      {
        patientId: charges[0]!.patientId,
        branchId,
        lines: charges.map((c) => ({
          serviceId: c.serviceId ?? undefined,
          title: this.chargeTitle(c.title),
          quantity: c.quantity,
          unitPrice: c.unitPrice.toFixed(2),
          discount: '0',
          chargeItemId: c.id,
        })),
      },
      user,
      { issueImmediately: true },
    );
  }

  private chargeTitle(title: Prisma.JsonValue): string {
    if (typeof title === 'string') return title;
    if (title && typeof title === 'object' && !Array.isArray(title)) {
      for (const locale of ['uz', 'ru', 'en']) {
        if (typeof title[locale] === 'string') return title[locale];
      }
    }
    throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat nomi topilmadi', 400);
  }
}
