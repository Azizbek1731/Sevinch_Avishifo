import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Admission } from '@prisma/client';
import { ErrorCode, type AuthUser } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { nextRoomPeriodAt, roomBillingDate } from './room-billing-calendar';

type BillingActor = Pick<AuthUser, 'id' | 'branchIds'>;

/**
 * Statsionar palata haqi — faqat qabulxona qo‘lda qo‘shadi.
 * Avtomatik scheduler / reconcile yo‘q.
 */
@Injectable()
export class RoomBillingService {
  private readonly logger = new Logger(RoomBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Legacy callers — avtomatik hisob o‘chirilgan. */
  async reconcilePatient(_patientId: string, _branchId: string): Promise<void> {}

  async reconcileBranch(_branchId: string): Promise<void> {}

  async reconcileAdmission(id: string, branchId?: string, _through = new Date()): Promise<Admission> {
    const stay = await this.prisma.db.admission.findFirst({
      where: { id, ...(branchId ? { branchId } : {}) },
    });
    if (!stay) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    return stay;
  }

  /**
   * Qabulxona bitta yoki bir necha 24 soatlik davrni qo‘lda qo‘shadi.
   * Davr `roomBillingNextAt` (yoki yotqizilgan vaqt) dan boshlanadi.
   */
  async addManualPeriods(id: string, days: number, user: BillingActor): Promise<Admission> {
    const count = Math.trunc(days);
    if (!Number.isFinite(count) || count < 1 || count > 31) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Kun soni 1 dan 31 gacha bo‘lishi kerak', 400);
    }
    return this.prisma.db.$transaction(
      async (tx) => {
        let stay: Admission | null = null;
        for (let i = 0; i < count; i++) {
          stay = await this.addOnePeriodInTransaction(tx, id, user);
        }
        return stay!;
      },
      { timeout: 60_000 },
    );
  }

  /** @deprecated Prefer addManualPeriods. */
  async addManualPeriod(id: string, user: BillingActor): Promise<Admission> {
    return this.addManualPeriods(id, 1, user);
  }

  /** @deprecated Kept for any residual callers; prefer addManualPeriods. */
  async accrueInTransaction(
    tx: TenantTransactionClient,
    id: string,
    user?: BillingActor,
    _through = new Date(),
  ): Promise<Admission> {
    if (!user) {
      const stay = await tx.admission.findFirst({ where: { id } });
      if (!stay) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
      return stay;
    }
    return this.addOnePeriodInTransaction(tx, id, user);
  }

  /**
   * Oxirgi qo‘shilgan (to‘lanmagan) kunni qaytaradi.
   * Zanjir buzilmasin deb faqat eng so‘nggi kun o‘chiriladi.
   */
  async reverseManualPeriod(id: string, billingDate: string, user: BillingActor): Promise<Admission> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billingDate)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Sana formati YYYY-MM-DD bo‘lishi kerak', 400);
    }
    return this.prisma.db.$transaction(
      (tx) => this.reverseOnePeriodInTransaction(tx, id, billingDate, user),
      { timeout: 30_000 },
    );
  }

  private async addOnePeriodInTransaction(
    tx: TenantTransactionClient,
    id: string,
    user: BillingActor,
  ): Promise<Admission> {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
    const stay = await tx.admission.findFirst({ where: { id } });
    if (!stay) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    if (user.branchIds.length && !user.branchIds.includes(stay.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
    }
    if (stay.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Faqat faol statsionarga kunlik haq qo‘shiladi', 409);
    }
    if (stay.dailyRoomRate === null) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Avval 24 soatlik o‘rin narxini saqlang',
        409,
      );
    }

    const periodStart = stay.roomBillingNextAt ?? stay.admittedAt;
    const date = roomBillingDate(periodStart);
    const existing = await tx.admissionRoomCharge.findFirst({
      where: { admissionId: id, billingDate: new Date(date) },
    });
    if (existing) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Bu sana (${date}) uchun palata haqi allaqachon qo‘shilgan`,
        409,
      );
    }

    const place = [
      stay.ward ? `Palata ${stay.ward}` : 'Palata',
      stay.bed ? `o‘rin ${stay.bed}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const charge = stay.dailyRoomRate.gt(0)
      ? await tx.chargeItem.create({
          data: {
            clinicId,
            branchId: stay.branchId,
            patientId: stay.patientId,
            admissionId: id,
            title: {
              uz: `${place} — 24 soat (${date})`,
              ru: `Палата ${stay.ward ?? ''}, койка ${stay.bed ?? ''} — 24ч (${date})`,
              en: `Room ${stay.ward ?? ''}, bed ${stay.bed ?? ''} — 24h (${date})`,
            },
            date: new Date(date),
            quantity: 1,
            unitPrice: stay.dailyRoomRate,
            createdById: user.id,
          },
        })
      : null;

    await tx.admissionRoomCharge.create({
      data: {
        clinicId,
        admissionId: id,
        billingDate: new Date(date),
        periodStartedAt: periodStart,
        dailyRate: stay.dailyRoomRate,
        ward: stay.ward,
        bed: stay.bed,
        chargeItemId: charge?.id ?? null,
      },
    });

    // Room days stay on the inpatient account until discharge settlement.

    const nextAt = nextRoomPeriodAt(periodStart);
    const updated = await tx.admission.update({
      where: { id },
      data: {
        roomBillingNextAt: nextAt,
        roomBillingNextDate: new Date(roomBillingDate(nextAt)),
        roomBillingStartsOn: stay.roomBillingStartsOn ?? new Date(date),
        roomRateSetById: stay.roomRateSetById ?? user.id,
      },
    });

    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: 'CREATE',
        entity: 'AdmissionRoomCharge',
        entityId: id,
        diff: {
          source: 'MANUAL_ROOM_BILLING',
          periodStartedAt: periodStart.toISOString(),
          billingDate: date,
          nextAt: nextAt.toISOString(),
          chargeId: charge?.id ?? null,
        },
      },
    });

    this.logger.log(`Manual room day added for admission ${id} (${date})`);
    return updated;
  }

  private async reverseOnePeriodInTransaction(
    tx: TenantTransactionClient,
    id: string,
    billingDate: string,
    user: BillingActor,
  ): Promise<Admission> {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
    const stay = await tx.admission.findFirst({ where: { id } });
    if (!stay) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    if (user.branchIds.length && !user.branchIds.includes(stay.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
    }
    if (stay.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Faqat faol statsionarda kunlik haqni qaytarish mumkin',
        409,
      );
    }

    const rows = await tx.admissionRoomCharge.findMany({
      where: { admissionId: id },
      include: { chargeItem: true },
      orderBy: [{ periodStartedAt: 'asc' }, { billingDate: 'asc' }],
    });
    const active = rows.filter((row) => (row.chargeItem?.status ?? 'FREE') !== 'CANCELLED');
    if (!active.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Qaytariladigan kun topilmadi', 404);
    }
    const latest = active[active.length - 1]!;
    const latestDate = latest.billingDate.toISOString().slice(0, 10);
    if (latestDate !== billingDate) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Faqat oxirgi qo‘shilgan kun (${latestDate}) qaytariladi. Avval undan keyingi kunlarni olib tashlang.`,
        409,
      );
    }

    const charge = latest.chargeItem;
    if (charge) {
      await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "id" = ${charge.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const fresh = await tx.chargeItem.findFirst({ where: { id: charge.id } });
      if (!fresh || fresh.status === 'CANCELLED') {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Kun holati o‘zgardi, sahifani yangilang', 409);
      }
      if (fresh.status === 'INVOICED' && fresh.invoiceLineId) {
        const line = await tx.invoiceLine.findFirst({
          where: { id: fresh.invoiceLineId },
          include: { invoice: true },
        });
        if (!line) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Hisob topilmadi, sahifani yangilang', 409);
        }
        const invoice = line.invoice;
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoice.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
        const payments = await tx.payment.count({
          where: { invoiceId: invoice.id, status: { not: 'VOIDED' } },
        });
        if (
          payments > 0 ||
          invoice.paidTotal.gt(0) ||
          (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED')
        ) {
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Bu kun allaqachon to‘langan yoki hisob yopilgan — qaytarib bo‘lmaydi',
            409,
          );
        }
        // Xona kuni odatda alohida hisobda; bekor qilish bilan charge PENDING ga qaytadi.
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });
        await tx.chargeItem.updateMany({
          where: { invoiceLineId: { in: [line.id] } },
          data: { status: 'PENDING', invoiceLineId: null },
        });
      }
      await tx.admissionRoomCharge.update({
        where: { id: latest.id },
        data: { chargeItemId: null },
      });
      await tx.chargeItem.update({
        where: { id: charge.id },
        data: { status: 'CANCELLED' },
      });
    }

    await tx.admissionRoomCharge.delete({ where: { id: latest.id } });

    const rewindAt = latest.periodStartedAt ?? stay.admittedAt;
    const updated = await tx.admission.update({
      where: { id },
      data: {
        roomBillingNextAt: rewindAt,
        roomBillingNextDate: new Date(roomBillingDate(rewindAt)),
      },
    });

    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: 'DELETE',
        entity: 'AdmissionRoomCharge',
        entityId: id,
        diff: {
          source: 'MANUAL_ROOM_BILLING_REVERSE',
          billingDate,
          periodStartedAt: latest.periodStartedAt?.toISOString() ?? null,
          chargeId: charge?.id ?? null,
          nextAt: rewindAt.toISOString(),
        },
      },
    });

    this.logger.log(`Manual room day reversed for admission ${id} (${billingDate})`);
    return updated;
  }

  async summary(id: string) {
    const stay = await this.prisma.db.admission.findFirst({ where: { id } });
    const rows = await this.prisma.db.admissionRoomCharge.findMany({
      where: { admissionId: id },
      orderBy: [{ periodStartedAt: 'asc' }, { billingDate: 'asc' }],
      include: { chargeItem: true },
    });

    // To‘lov holatini bir so‘rovda olish
    const lineIds = rows
      .map((row) => row.chargeItem?.invoiceLineId)
      .filter((value): value is string => !!value);
    const lines = lineIds.length
      ? await this.prisma.db.invoiceLine.findMany({
          where: { id: { in: lineIds } },
          select: {
            id: true,
            invoice: { select: { status: true, paidTotal: true } },
          },
        })
      : [];
    const invoiceByLine = new Map(lines.map((line) => [line.id, line.invoice]));

    const active = rows.filter((row) => (row.chargeItem?.status ?? 'FREE') !== 'CANCELLED');
    const latestDate = active.length
      ? active[active.length - 1]!.billingDate.toISOString().slice(0, 10)
      : null;

    const total = active.reduce(
      (sum, row) => sum.add(row.dailyRate),
      new Prisma.Decimal(0),
    );
    const nextAt = stay?.roomBillingNextAt ?? stay?.admittedAt ?? null;

    return {
      timeZone: 'Asia/Tashkent',
      periodHours: 24,
      days: active.length,
      total: total.toFixed(2),
      nextPeriodAt: nextAt?.toISOString() ?? null,
      nextPeriodDate: nextAt ? roomBillingDate(nextAt) : null,
      canAddManual: stay?.status === 'ACTIVE' && stay.dailyRoomRate !== null,
      items: rows.map((row) => {
        const date = row.billingDate.toISOString().slice(0, 10);
        const status = row.chargeItem?.status ?? 'FREE';
        const invoice = row.chargeItem?.invoiceLineId
          ? invoiceByLine.get(row.chargeItem.invoiceLineId)
          : null;
        const paid =
          !!invoice &&
          (invoice.paidTotal.gt(0) ||
            invoice.status === 'PAID' ||
            invoice.status === 'PARTIALLY_PAID');
        const canReverse =
          stay?.status === 'ACTIVE' &&
          status !== 'CANCELLED' &&
          date === latestDate &&
          !paid;
        return {
          date,
          periodStartedAt: row.periodStartedAt?.toISOString() ?? null,
          rate: row.dailyRate.toFixed(2),
          ward: row.ward,
          bed: row.bed,
          chargeId: row.chargeItemId,
          status,
          paid,
          canReverse,
        };
      }),
    };
  }
}
