import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, type Admission } from '@prisma/client';
import { ErrorCode, type AuthUser } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { InvoicesService } from './invoices.service';
import { nextRoomBillingDate, roomBillingDate } from './room-billing-calendar';

type BillingActor = Pick<AuthUser, 'id' | 'branchIds'>;

/** Persist room fees at admission, on reads/payment, and after each local midnight. */
@Injectable()
export class RoomBillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomBillingService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;

  constructor(private readonly prisma: PrismaService, private readonly invoices: InvoicesService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.sweep(); }, 60_000);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      // Scheduler entry point has no staff tenant. Enumerate only due stays,
      // then perform every write inside its explicit clinic context.
      const due = await this.prisma.unscoped.admission.findMany({
        where: {
          status: 'ACTIVE', dailyRoomRate: { not: null },
          roomBillingNextDate: { lte: new Date(roomBillingDate(new Date())) },
          roomRateSetById: { not: null }, patient: { deletedAt: null },
        },
        select: { id: true, clinicId: true, branchId: true },
        orderBy: { roomBillingNextDate: 'asc' }, take: 500,
      });
      for (const stay of due) {
        try {
          await TenantContext.run({ clinicId: stay.clinicId }, () =>
            this.reconcileAdmission(stay.id, stay.branchId));
        } catch {
          this.logger.warn(`Room billing deferred for admission ${stay.id}; it will retry`);
        }
      }
    } catch {
      this.logger.warn('Room billing sweep could not complete; it will retry');
    } finally {
      this.sweeping = false;
    }
  }

  async reconcilePatient(patientId: string, branchId: string): Promise<void> {
    await this.reconcileScope({ patientId, branchId });
  }

  async reconcileBranch(branchId: string): Promise<void> {
    await this.reconcileScope({ branchId });
  }

  private async reconcileScope(scope: { patientId?: string; branchId: string }): Promise<void> {
    const stays = await this.prisma.db.admission.findMany({
      where: {
        ...scope, status: 'ACTIVE', dailyRoomRate: { not: null },
        roomBillingNextDate: { lte: new Date(roomBillingDate(new Date())) },
      },
      select: { id: true }, orderBy: { id: 'asc' },
    });
    for (const stay of stays) await this.reconcileAdmission(stay.id, scope.branchId);
  }

  async reconcileAdmission(id: string, branchId?: string, through = new Date()): Promise<Admission> {
    const stay = await this.prisma.db.admission.findFirst({ where: { id, ...(branchId ? { branchId } : {}) } });
    if (!stay) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    // Most page refreshes fall on a day already assessed: no write transaction
    // or row lock is needed until the next local calendar date is due.
    if (stay.status !== 'ACTIVE' || stay.dailyRoomRate === null || !stay.roomBillingNextDate ||
        stay.roomBillingNextDate.toISOString().slice(0, 10) > roomBillingDate(through)) return stay;
    return this.prisma.db.$transaction(
      (tx) => this.accrueInTransaction(tx, id, undefined, through),
      { timeout: 30_000 },
    );
  }

  /** Caller may already hold this admission lock; the same lock order is retained. */
  async accrueInTransaction(
    tx: TenantTransactionClient,
    id: string,
    user?: BillingActor,
    through = new Date(),
  ): Promise<Admission> {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
    const stay = await tx.admission.findFirst({ where: { id } });
    if (!stay) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    if (user && user.branchIds.length && !user.branchIds.includes(stay.branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
    if (stay.status !== 'ACTIVE' || stay.dailyRoomRate === null || !stay.roomBillingNextDate) return stay;
    const actor = user ?? (stay.roomRateSetById ? { id: stay.roomRateSetById, branchIds: [stay.branchId] } : null);
    if (!actor) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Palata narxini qayta saqlang', 409);

    const lastDate = roomBillingDate(through);
    let date = stay.roomBillingNextDate.toISOString().slice(0, 10);
    if (date > lastDate) return stay;
    const chargeIds: string[] = [];
    while (date <= lastDate) {
      const existing = await tx.admissionRoomCharge.findFirst({ where: { admissionId: id, billingDate: new Date(date) } });
      if (!existing) {
        const place = [stay.ward ? `Palata ${stay.ward}` : 'Palata', stay.bed ? `o‘rin ${stay.bed}` : null].filter(Boolean).join(', ');
        const charge = stay.dailyRoomRate.gt(0)
          ? await tx.chargeItem.create({
              data: {
                clinicId, branchId: stay.branchId, patientId: stay.patientId, admissionId: id,
                title: { uz: `${place} — ${date}`, ru: `Палата ${stay.ward ?? ''}, койка ${stay.bed ?? ''} — ${date}`, en: `Room ${stay.ward ?? ''}, bed ${stay.bed ?? ''} — ${date}` },
                date: new Date(date), quantity: 1, unitPrice: stay.dailyRoomRate, createdById: actor.id,
              },
            })
          : null;
        await tx.admissionRoomCharge.create({ data: {
          clinicId, admissionId: id, billingDate: new Date(date), dailyRate: stay.dailyRoomRate,
          ward: stay.ward, bed: stay.bed, chargeItemId: charge?.id ?? null,
        } });
        if (charge) chargeIds.push(charge.id);
      }
      date = nextRoomBillingDate(date);
    }
    // Zero-price days still get immutable snapshots but do not clutter cashier
    // with zero invoices. Cancelled/paid days are never recreated on a retry.
    if (chargeIds.length) await this.invoices.issueChargesInTransaction(tx, chargeIds, actor, stay.branchId);
    const updated = await tx.admission.update({ where: { id }, data: { roomBillingNextDate: new Date(date) } });
    await tx.auditLog.create({ data: {
      clinicId, userId: actor.id, action: 'CREATE', entity: 'AdmissionRoomCharge', entityId: id,
      diff: { source: 'CALENDAR_ROOM_BILLING', through: lastDate, nextDate: date, chargeIds },
    } });
    return updated;
  }

  async summary(id: string) {
    const rows = await this.prisma.db.admissionRoomCharge.findMany({
      where: { admissionId: id }, orderBy: { billingDate: 'asc' }, include: { chargeItem: true },
    });
    const total = rows.reduce((sum, row) => row.chargeItem?.status === 'CANCELLED' ? sum : sum.add(row.dailyRate), new Prisma.Decimal(0));
    return {
      timeZone: 'Asia/Tashkent', days: rows.length, total: total.toFixed(2),
      items: rows.map((row) => ({
        date: row.billingDate.toISOString().slice(0, 10), rate: row.dailyRate.toFixed(2),
        ward: row.ward, bed: row.bed, chargeId: row.chargeItemId,
        status: row.chargeItem?.status ?? 'FREE',
      })),
    };
  }
}
