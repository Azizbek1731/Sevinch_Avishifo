import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type SurgeryPayout } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  TIMEZONE,
  type AuthUser,
  type CreateSurgeryPayoutInput,
  type VoidSurgeryPayoutInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { lockOpenShift } from '../billing/cash-accounts';

/** The operation fee alone is the percentage basis; medicines are patient costs. */
export function calculateSurgeryPayout(
  type: 'PERCENT' | 'FIXED',
  value: string,
  fee: Prisma.Decimal,
): Prisma.Decimal {
  const input = new Prisma.Decimal(value);
  if (!input.isFinite() || input.lte(0) || (type === 'PERCENT' && input.gt(100))) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      'Jarroh ulushi musbat, foiz esa 100 dan oshmasligi kerak',
      400,
    );
  }
  const amount = (type === 'PERCENT' ? fee.mul(input).div(100) : input).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (amount.lte(0) || amount.gt('999999999999.99')) {
    throw new AppException(ErrorCode.VALIDATION_ERROR, 'Jarrohga beriladigan summa noto‘g‘ri', 400);
  }
  return amount;
}

export function mapSurgeryPayout(p: SurgeryPayout & { doctor?: { fullName: string } }) {
  return {
    id: p.id,
    surgeryId: p.surgeryId,
    doctorUserId: p.doctorUserId,
    patientId: p.patientId,
    doctorName: p.doctor?.fullName ?? null,
    type: p.type,
    value: p.value.toFixed(2),
    basisAmount: p.basisAmount.toFixed(2),
    amount: p.amount.toFixed(2),
    method: p.method,
    expenseId: p.expenseId,
    note: p.note,
    paidAt: p.paidAt.toISOString(),
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidReason: p.voidReason,
  };
}

@Injectable()
export class SurgeryPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(surgeryId: string, dto: CreateSurgeryPayoutInput, user: AuthUser, branchId: string) {
    const clinicId = TenantContext.requireClinicId();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          surgeryId,
          branchId,
          type: dto.type,
          value: new Prisma.Decimal(dto.value).toFixed(2),
          method: dto.method,
          note: dto.note?.trim() || null,
        }),
      )
      .digest('hex');
    const { payout, replayed } = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':surgery-payout:' + dto.idempotencyKey}, 0))`;
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "SurgeryCase" WHERE "id" = ${surgeryId} AND "clinicId" = ${clinicId}
        AND "branchId" = ${branchId} FOR UPDATE`;
      if (!locked.length) throw new AppException(ErrorCode.NOT_FOUND, 'Operatsiya topilmadi', 404);
      const existing = await tx.surgeryPayout.findFirst({
        where: { requestKey: dto.idempotencyKey },
        include: { doctor: { select: { fullName: true } } },
      });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Bu so‘rov kaliti boshqa to‘lov uchun ishlatilgan',
            409,
          );
        return { payout: existing, replayed: true };
      }
      const surgery = await tx.surgeryCase.findFirstOrThrow({
        where: { id: surgeryId, branchId },
        include: {
          serviceCharge: true,
          surgeon: { select: { fullName: true } },
          patient: { select: { fullName: true, mrn: true } },
        },
      });
      if (surgery.status !== 'COMPLETED' || surgery.serviceCharge.status === 'CANCELLED') {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Jarrohga haq berishdan oldin operatsiyani yakunlang',
          409,
        );
      }
      if (await tx.surgeryPayout.count({ where: { surgeryId, voidedAt: null } })) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Bu operatsiya uchun jarroh ulushi allaqachon berilgan',
          409,
        );
      }
      const basisAmount = surgery.serviceCharge.unitPrice.mul(surgery.serviceCharge.quantity);
      const amount = calculateSurgeryPayout(dto.type, dto.value, basisAmount);
      const shift = await tx.cashierShift.findFirst({
        where: { branchId, status: 'OPEN' },
        select: { id: true },
      });
      const shiftId = await lockOpenShift(tx, shift?.id ?? null, true);
      const category = await tx.expenseCategory.upsert({
        where: { clinicId_systemKey: { clinicId, systemKey: 'SURGEON_PAYOUT' } },
        create: { clinicId, systemKey: 'SURGEON_PAYOUT', name: 'Jarroh ulushi' },
        update: { isActive: true },
      });
      const paidAt = new Date();
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(paidAt);
      const title = surgery.serviceCharge.title;
      const serviceName =
        typeof title === 'string'
          ? title
          : title &&
              typeof title === 'object' &&
              !Array.isArray(title) &&
              typeof title.uz === 'string'
            ? title.uz
            : surgeryId;
      const note = dto.note?.trim() || null;
      const expense = await tx.expense.create({
        data: {
          clinicId,
          branchId,
          categoryId: category.id,
          amount,
          method: dto.method,
          shiftId,
          date: new Date(date),
          createdById: user.id,
          note: `${surgery.surgeon.fullName} · ${surgery.patient.fullName} (${surgery.patient.mrn}) · ${serviceName} · ${dto.type === 'PERCENT' ? `${dto.value}% × ${basisAmount.toFixed(2)}` : amount.toFixed(2)}${note ? ` · ${note}` : ''}`,
        },
      });
      const payout = await tx.surgeryPayout.create({
        data: {
          clinicId,
          branchId,
          surgeryId,
          doctorUserId: surgery.surgeonUserId,
          patientId: surgery.patientId,
          type: dto.type,
          value: new Prisma.Decimal(dto.value),
          basisAmount,
          amount,
          method: dto.method,
          expenseId: expense.id,
          requestKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
          note,
          paidAt,
          createdById: user.id,
        },
        include: { doctor: { select: { fullName: true } } },
      });
      return { payout, replayed: false };
    });
    if (!replayed)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'SurgeryPayout',
        entityId: payout.id,
        after: {
          surgeryId,
          doctorUserId: payout.doctorUserId,
          patientId: payout.patientId,
          expenseId: payout.expenseId,
          type: payout.type,
          value: payout.value.toFixed(2),
          basisAmount: payout.basisAmount.toFixed(2),
          amount: payout.amount.toFixed(2),
          method: payout.method,
        },
      });
    return mapSurgeryPayout(payout);
  }

  async void(
    surgeryId: string,
    payoutId: string,
    dto: VoidSurgeryPayoutInput,
    user: AuthUser,
    branchId: string,
  ) {
    const clinicId = TenantContext.requireClinicId();
    const { payout, replayed } = await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "SurgeryCase" WHERE "id" = ${surgeryId} AND "clinicId" = ${clinicId}
        AND "branchId" = ${branchId} FOR UPDATE`;
      if (!locked.length) throw new AppException(ErrorCode.NOT_FOUND, 'Operatsiya topilmadi', 404);
      const existing = await tx.surgeryPayout.findFirst({
        where: { id: payoutId, surgeryId, branchId },
        include: { expense: true, doctor: { select: { fullName: true } } },
      });
      if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Jarroh to‘lovi topilmadi', 404);
      if (existing.voidedAt) return { payout: existing, replayed: true };
      await lockOpenShift(tx, existing.expense.shiftId, true);
      const voidedAt = new Date();
      const changed = await tx.expense.updateMany({
        where: { id: existing.expenseId, deletedAt: null },
        data: { deletedAt: voidedAt, deletedById: user.id },
      });
      if (changed.count !== 1)
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Jarroh chiqimi holati o‘zgargan', 409);
      const payout = await tx.surgeryPayout.update({
        where: { id: payoutId },
        data: { voidedAt, voidedById: user.id, voidReason: dto.reason },
        include: { doctor: { select: { fullName: true } } },
      });
      return { payout, replayed: false };
    });
    if (!replayed)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: 'SurgeryPayout',
        entityId: payoutId,
        before: { voidedAt: null },
        after: {
          voidedAt: payout.voidedAt?.toISOString(),
          reason: dto.reason,
          expenseId: payout.expenseId,
        },
      });
    return mapSurgeryPayout(payout);
  }
}
