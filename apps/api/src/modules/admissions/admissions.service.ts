import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Admission, TreatmentOrder } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type AdmitPatientInput,
  type AdmissionQueryInput,
  type AuthUser,
  type CreateOrderInput,
  type DailyNoteInput,
  type DischargeInput,
  type MarkAdministrationInput,
  type UpdateAdmissionInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { AuditService } from '../../core/audit/audit.service';
import { PricingService } from '../services/pricing.service';
import { InvoicesService } from '../billing/invoices.service';
import { RoomBillingService } from '../billing/room-billing.service';
import { roomBillingDate, roomBillingDayCount } from '../billing/room-billing-calendar';

/** Every planned date of an order, from its schedule. */
function plannedDates(
  order: Pick<TreatmentOrder, 'schedule' | 'startDate' | 'timesPlanned'>,
): string[] {
  const step = order.schedule === 'EVERY_OTHER_DAY' ? 2 : 1;
  const times = order.schedule === 'ONCE' ? 1 : order.timesPlanned;
  const out: string[] = [];
  const start = new Date(order.startDate);
  for (let i = 0; i < times; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * step);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly roomBilling: RoomBillingService,
  ) {}

  private map(a: Admission): Record<string, unknown> {
    return {
      id: a.id,
      branchId: a.branchId,
      patientId: a.patientId,
      historyNumber: a.historyNumber,
      status: a.status,
      department: a.department,
      ward: a.ward,
      bed: a.bed,
      dailyRoomRate: a.dailyRoomRate?.toFixed(2) ?? null,
      roomBillingStartsOn: a.roomBillingStartsOn?.toISOString().slice(0, 10) ?? null,
      roomBillingNextDate: a.roomBillingNextDate?.toISOString().slice(0, 10) ?? null,
      attendingDoctorUserId: a.attendingDoctorUserId,
      admittedAt: a.admittedAt.toISOString(),
      dischargedAt: a.dischargedAt ? a.dischargedAt.toISOString() : null,
      referredBy: a.referredBy,
      referralDiagnosis: a.referralDiagnosis,
      admissionDiagnosis: a.admissionDiagnosis,
      clinicalDiagnosis: a.clinicalDiagnosis,
      clinicalDiagnosisAt: a.clinicalDiagnosisAt
        ? a.clinicalDiagnosisAt.toISOString().slice(0, 10)
        : null,
      finalDiagnosisMain: a.finalDiagnosisMain,
      finalDiagnosisComplication: a.finalDiagnosisComplication,
      finalDiagnosisComorbid: a.finalDiagnosisComorbid,
      firstTimeThisYear: a.firstTimeThisYear,
      outcome: a.outcome,
      complaints: a.complaints,
      anamnesisMorbi: a.anamnesisMorbi,
      anamnesisVitae: a.anamnesisVitae,
      objectiveStatus: a.objectiveStatus,
      preliminaryDiagnosis: a.preliminaryDiagnosis,
      treatmentPlan: a.treatmentPlan,
      epicrisis: a.epicrisis,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /** "KT-2026-0001", sequential per clinic per year. */
  private async nextHistoryNumber(db: TenantTransactionClient = this.prisma.db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `KT-${year}-`;
    const last = await db.admission.findFirst({
      where: { historyNumber: { startsWith: prefix } },
      orderBy: { historyNumber: 'desc' },
      select: { historyNumber: true },
    });
    const n = last ? Number(last.historyNumber.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  async admit(
    dto: AdmitPatientInput,
    user: AuthUser,
    branchId: string,
  ): Promise<Record<string, unknown>> {
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Bemor topilmadi', 404);

    // One stay at a time: a second ACTIVE admission would split the same
    // treatment across two histories and two bills.
    const open = await this.prisma.db.admission.findFirst({
      where: { patientId: dto.patientId, status: 'ACTIVE' },
    });
    if (open) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Bemor allaqachon statsionarda (${open.historyNumber})`,
        409,
      );
    }

    const attendingDoctorUserId =
      dto.attendingDoctorUserId ?? (user.role === 'DOCTOR' ? user.id : null);
    if (attendingDoctorUserId) await this.validateDoctor(attendingDoctorUserId, branchId);

    const admittedAt = dto.admittedAt ? new Date(dto.admittedAt) : new Date();
    if (admittedAt.getTime() > Date.now())
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Yotqizish sanasi kelajakda bo‘lishi mumkin emas', 400);
    if (user.branchIds.length && !user.branchIds.includes(branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
    const clinicId = TenantContext.requireClinicId();
    const created = await this.prisma.db.$transaction(async (tx) => {
      // Concurrent admission retries must not create two stays or duplicate room fees.
      await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${dto.patientId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const existing = await tx.admission.findFirst({ where: { patientId: dto.patientId, status: 'ACTIVE' } });
      if (existing) throw new AppException(ErrorCode.VALIDATION_ERROR, `Bemor allaqachon statsionarda (${existing.historyNumber})`, 409);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':admission-number'}, 0))`;
      const hasRate = dto.dailyRoomRate !== undefined;
      const start = hasRate ? new Date(roomBillingDate(admittedAt)) : null;
      const stay = await tx.admission.create({ data: {
        clinicId, branchId, patientId: dto.patientId, historyNumber: await this.nextHistoryNumber(tx),
        department: dto.department ?? null, ward: dto.ward ?? null, bed: dto.bed ?? null,
        attendingDoctorUserId, admittedAt,
        dailyRoomRate: dto.dailyRoomRate ?? null,
        roomBillingStartsOn: start, roomBillingNextDate: start,
        roomRateSetById: hasRate ? user.id : null,
        referredBy: dto.referredBy ?? null, referralDiagnosis: dto.referralDiagnosis ?? null,
        admissionDiagnosis: dto.admissionDiagnosis ?? null, firstTimeThisYear: dto.firstTimeThisYear ?? null,
      } });
      await tx.patient.update({ where: { id: dto.patientId }, data: { careType: 'INPATIENT' } });
      return hasRate ? this.roomBilling.accrueInTransaction(tx, stay.id, user) : stay;
    }, { timeout: 30_000 });
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Admission',
      entityId: created.id,
      after: { patientId: dto.patientId, branchId, attendingDoctorUserId },
    });
    return this.map(created);
  }

  private async require(id: string): Promise<Admission> {
    const a = await this.prisma.db.admission.findFirst({ where: { id } });
    if (!a) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    return a;
  }

  /** Surgery and ward mutations share this first lock, including discharge. */
  private async lockAdmission(tx: TenantTransactionClient, id: string): Promise<Admission> {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
    const admission = await tx.admission.findFirst({ where: { id } });
    if (!admission) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    return admission;
  }

  private async validateDoctor(doctorId: string, branchId: string): Promise<void> {
    // User is platform-scoped; explicitly require this clinic and branch.
    const doctor = await this.prisma.unscoped.user.findFirst({
      where: {
        id: doctorId,
        clinicId: TenantContext.requireClinicId(),
        role: 'DOCTOR',
        status: 'ACTIVE',
        deletedAt: null,
        branches: { some: { branchId } },
      },
      select: { id: true },
    });
    if (!doctor) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Faol shifokorni tanlang', 400);
  }

  /** Financial rows cannot move between pending and invoiced during closure. */
  private async lockStayCharges(tx: TenantTransactionClient, id: string): Promise<void> {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "admissionId" = ${id} AND "clinicId" = ${clinicId} ORDER BY "id" FOR UPDATE`;
  }

  private requireActive(a: Admission): void {
    if (a.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Bemor chiqarilgan — tarixni o‘zgartirib bo‘lmaydi',
        409,
      );
    }
  }

  /**
   * Removes a stay outright — the one opened on the wrong patient, or the
   * duplicate opened because the first attempt looked like it failed.
   *
   * Money already billed is left alone: an invoice is a document the patient
   * may hold a copy of, and deleting a stay must not quietly rewrite it. Only
   * the charges this stay raised and never billed are cancelled with it, along
   * with the treatment sheet and rounds, which mean nothing without the stay.
   */
  async remove(id: string): Promise<{ id: string; invoicedKept: number }> {
    const invoicedKept = await this.prisma.db.$transaction(async (tx) => {
      const a = await this.lockAdmission(tx, id);
      if (await tx.surgeryCase.count({ where: { admissionId: id } })) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Operatsiya tarixi mavjud — yotqizishni o‘chirish mumkin emas',
          409,
        );
      }
      await this.lockStayCharges(tx, id);
      const kept = await tx.chargeItem.count({ where: { admissionId: id, status: 'INVOICED' } });
      const orders = await tx.treatmentOrder.findMany({
        where: { admissionId: id },
        select: { id: true },
      });
      const orderIds = orders.map((o) => o.id);
      await tx.admissionRoomCharge.deleteMany({ where: { admissionId: id } });
      await tx.treatmentOrder.updateMany({
        where: { admissionId: id, billingChargeId: { not: null } },
        data: { billingChargeId: null },
      });
      // Charges point at administrations, so they go first.
      await tx.chargeItem.deleteMany({ where: { admissionId: id, status: { not: 'INVOICED' } } });
      // A billed charge outlives the stay, but must stop pointing at a row
      // that no longer exists.
      await tx.chargeItem.updateMany({
        where: { admissionId: id },
        data: { admissionId: null, administrationId: null },
      });
      if (orderIds.length > 0) {
        await tx.treatmentAdministration.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      await tx.treatmentOrder.deleteMany({ where: { admissionId: id } });
      await tx.admissionDailyNote.deleteMany({ where: { admissionId: id } });
      await tx.admission.delete({ where: { id } });

      // Only when this was their last open stay — the same guard discharge uses.
      if (a.status === 'ACTIVE') {
        const stillIn = await tx.admission.count({
          where: { patientId: a.patientId, status: 'ACTIVE' },
        });
        if (stillIn === 0) {
          await tx.patient.update({
            where: { id: a.patientId },
            data: { careType: 'AMBULATORY' },
          });
        }
      }
      return kept;
    });
    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Admission',
      entityId: id,
      after: { invoicedKept },
    });
    return { id, invoicedKept };
  }

  async update(id: string, dto: UpdateAdmissionInput, user?: AuthUser): Promise<Record<string, unknown>> {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const a = await this.lockAdmission(tx, id);
      this.requireActive(a);
      if (user?.branchIds.length && !user.branchIds.includes(a.branchId))
        throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
      if (dto.attendingDoctorUserId)
        await this.validateDoctor(dto.attendingDoctorUserId, a.branchId);
      // Already-started calendar dates keep their original rate and location.
      // Newly configured legacy stays begin today, never at an unknown old tariff.
      if (dto.dailyRoomRate !== undefined && !user)
        throw new AppException(ErrorCode.FORBIDDEN, 'Palata narxini saqlash uchun foydalanuvchi kerak', 403);
      if (dto.dailyRoomRate !== undefined || dto.ward !== undefined || dto.bed !== undefined)
        await this.roomBilling.accrueInTransaction(tx, id, user);
      const row = await tx.admission.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.dailyRoomRate !== undefined ? {
            roomRateSetById: user!.id,
            ...(a.dailyRoomRate === null ? {
              roomBillingStartsOn: new Date(roomBillingDate(new Date())),
              roomBillingNextDate: new Date(roomBillingDate(new Date())),
            } : {}),
          } : {}),
          clinicalDiagnosisAt: dto.clinicalDiagnosisAt ? new Date(dto.clinicalDiagnosisAt) : undefined,
        },
      });
      return dto.dailyRoomRate !== undefined && a.dailyRoomRate === null
        ? this.roomBilling.accrueInTransaction(tx, id, user)
        : row;
    }, { timeout: 30_000 });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Admission',
      entityId: id,
      after: dto,
    });
    return this.map(updated);
  }

  /**
   * The money picture for one stay.
   *
   * "This stay's debt" is reachable only through the charges it raised:
   * ChargeItem.invoiceLineId -> InvoiceLine -> Invoice. Debt itself is the same
   * figure the patient card and the debtors report use — the unpaid remainder
   * of ISSUED/PARTIALLY_PAID invoices — so the three can never disagree.
   *
   * An invoice that mixes ward lines with walk-in lines blocks for its WHOLE
   * remaining balance. paidTotal is an invoice-level number with no per-line
   * allocation, so any "the ward's share of this" figure would be invented, and
   * a cashier cannot collect an invented number.
   */
  private async stayMoney(
    admissionId: string,
    patientId: string,
    db: TenantTransactionClient = this.prisma.db,
  ): Promise<{
    pending: Array<{ id: string; title: Prisma.JsonValue; unitPrice: string; quantity: number }>;
    pendingTotal: Prisma.Decimal;
    stayInvoices: Array<{
      id: string;
      number: string;
      status: string;
      total: string;
      paidTotal: string;
      due: string;
    }>;
    stayDebt: Prisma.Decimal;
    otherDebt: Prisma.Decimal;
    deposit: Prisma.Decimal;
  }> {
    const zero = new Prisma.Decimal(0);

    const pendingRows = await db.chargeItem.findMany({
      where: { admissionId, status: 'PENDING' },
      select: { id: true, title: true, unitPrice: true, quantity: true },
      orderBy: { date: 'asc' },
    });
    const pendingTotal = pendingRows.reduce((acc, c) => acc.add(c.unitPrice.mul(c.quantity)), zero);

    const linked = await db.chargeItem.findMany({
      where: { admissionId, invoiceLineId: { not: null } },
      select: { invoiceLineId: true },
    });
    const lineIds = linked.map((l) => l.invoiceLineId).filter((x): x is string => x !== null);
    const stayInvoiceIds =
      lineIds.length > 0
        ? [
            ...new Set(
              (
                await db.invoiceLine.findMany({
                  where: { id: { in: lineIds } },
                  select: { invoiceId: true },
                })
              ).map((l) => l.invoiceId),
            ),
          ]
        : [];

    const openStay =
      stayInvoiceIds.length > 0
        ? await db.invoice.findMany({
            where: { id: { in: stayInvoiceIds }, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
            select: { id: true, number: true, status: true, total: true, paidTotal: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];
    const stayDebt = openStay.reduce((acc, i) => acc.add(i.total.sub(i.paidTotal)), zero);

    // Everything else the patient owes. Shown so the desk knows, never enforced
    // — see discharge() for why it must not hold a bed.
    const allOpen = await db.invoice.aggregate({
      where: { patientId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      _sum: { total: true, paidTotal: true },
    });
    const totalDebt = (allOpen._sum.total ?? zero).sub(allOpen._sum.paidTotal ?? zero);
    const otherDebt = totalDebt.sub(stayDebt);

    const patient = await db.patient.findFirst({
      where: { id: patientId },
      select: { balance: true },
    });

    return {
      pending: pendingRows.map((c) => ({
        id: c.id,
        title: c.title,
        unitPrice: c.unitPrice.toFixed(2),
        quantity: c.quantity,
      })),
      pendingTotal,
      stayInvoices: openStay.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        total: i.total.toFixed(2),
        paidTotal: i.paidTotal.toFixed(2),
        due: i.total.sub(i.paidTotal).toFixed(2),
      })),
      stayDebt,
      otherDebt: otherDebt.gt(0) ? otherDebt : zero,
      deposit: patient?.balance ?? zero,
    };
  }

  /**
   * What stands between this stay and its discharge, answered before the user
   * fills in a form they may not be allowed to submit.
   */
  async dischargeCheck(id: string, branchId?: string): Promise<Record<string, unknown>> {
    const a = await this.roomBilling.reconcileAdmission(id, branchId);
    const money = await this.stayMoney(id, a.patientId);
    const blockers: string[] = [];
    if (money.pending.length > 0) blockers.push('UNBILLED');
    if (money.stayDebt.gt(0)) blockers.push('DEBT');

    return {
      admissionId: a.id,
      historyNumber: a.historyNumber,
      status: a.status,
      patientId: a.patientId,
      canDischarge: a.status === 'ACTIVE' && blockers.length === 0,
      blockers,
      unbilled: {
        count: money.pending.length,
        total: money.pendingTotal.toFixed(2),
        items: money.pending,
      },
      stayDebt: money.stayDebt.toFixed(2),
      stayInvoices: money.stayInvoices,
      otherDebt: money.otherDebt.toFixed(2),
      deposit: money.deposit.toFixed(2),
    };
  }

  async discharge(
    id: string,
    dto: DischargeInput,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    // `force` closes the stay over anything still outstanding. It is a
    // deliberate act by someone holding admissions.force (the desk and the
    // administrator), never the default path — the blockers below still guide
    // everyone else through billing and payment first.
    const forced = dto.force === true || dto.debtAcknowledged === true;
    if (forced && !user.permissions.includes('admissions.force')) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Majburiy chiqarish uchun administrator yoki qabulxona huquqi kerak',
        403,
      );
    }

    const cutoff = dto.dischargedAt ? new Date(dto.dischargedAt) : new Date();
    const currentStay = await this.require(id);
    if (user.branchIds.length && !user.branchIds.includes(currentStay.branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'Bu filialga kirish huquqi yo‘q', 403);
    if (cutoff < currentStay.admittedAt || cutoff.getTime() > Date.now())
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Chiqarish sanasi yotqizilgan sana va hozirgi vaqt oralig‘ida bo‘lishi kerak', 400);
    const laterDay = await this.prisma.db.admissionRoomCharge.findFirst({
      where: { admissionId: id, billingDate: { gt: new Date(roomBillingDate(cutoff)) } }, select: { id: true },
    });
    if (laterDay) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Keyingi kunlar uchun palata hisobi mavjud. Chiqarish sanasini tekshiring.', 409);
    await this.roomBilling.reconcileAdmission(id, currentStay.branchId, cutoff);

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const a = await this.lockAdmission(tx, id);
      this.requireActive(a);
      const finalCutoff = dto.dischargedAt ? cutoff : new Date();
      const laterRoomDay = await tx.admissionRoomCharge.findFirst({
        where: { admissionId: id, billingDate: { gt: new Date(roomBillingDate(finalCutoff)) } }, select: { id: true },
      });
      if (laterRoomDay) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Keyingi kunlar uchun palata hisobi mavjud. Chiqarish sanasini tekshiring.', 409);
      await this.roomBilling.accrueInTransaction(tx, id, user, finalCutoff);
      await this.lockStayCharges(tx, id);
      const clinicId = TenantContext.requireClinicId();
      await tx.$queryRaw`
        SELECT i."id" FROM "Invoice" i
        WHERE i."clinicId" = ${clinicId} AND EXISTS (
          SELECT 1 FROM "ChargeItem" c JOIN "InvoiceLine" l ON l."id" = c."invoiceLineId"
          WHERE c."admissionId" = ${id} AND c."clinicId" = ${clinicId} AND l."invoiceId" = i."id"
        ) ORDER BY i."id" FOR UPDATE
      `;
      const money = await this.stayMoney(id, a.patientId, tx);
      if (!forced) {
        // Services not yet on a bill. Discharging over them is how a stay gets
        // silently written off, so it is refused — but with the count, so the
        // dialog can offer to raise the invoice instead of dead-ending.
        if (money.pending.length > 0) {
          throw new AppException(
            ErrorCode.ADMISSION_CHARGES_UNBILLED,
            `Hisob-fakturaga kiritilmagan ${money.pending.length} ta xizmat bor — avval hisob-faktura chiqaring`,
            409,
            [{ count: money.pending.length, total: money.pendingTotal.toFixed(2) }],
          );
        }

        // Money owed for THIS stay. Deliberately not the patient's whole debt:
        // the same patient may run up outpatient bills while lying in the bed,
        // and an unrelated old invoice must never be what keeps a bed occupied.
        // Old debt is collections (the debtors report), not bed management.
        if (money.stayDebt.gt(0)) {
          throw new AppException(
            ErrorCode.ADMISSION_DEBT_UNPAID,
            `Bu yotqizish bo‘yicha ${money.stayDebt.toFixed(2)} so‘m qarz bor — avval to‘lovni qabul qiling`,
            409,
            [{ debt: money.stayDebt.toFixed(2), invoices: money.stayInvoices }],
          );
        }
      }

      const adm = await tx.admission.update({
        where: { id },
        data: {
          status: 'DISCHARGED',
          dischargedAt: finalCutoff,
          outcome: dto.outcome,
          finalDiagnosisMain: dto.finalDiagnosisMain,
          finalDiagnosisComplication: dto.finalDiagnosisComplication ?? null,
          finalDiagnosisComorbid: dto.finalDiagnosisComorbid ?? null,
          epicrisis: dto.epicrisis ?? a.epicrisis,
          // Everything still outstanding, billed or not. Written on every
          // discharge, 0.00 included: "settled at closure" is a fact worth
          // recording, and the invoices behind it may later be cancelled or
          // refunded and stop answering the question. When a stay is forced
          // out, this is the only place the amount survives.
          debtAtDischarge: money.stayDebt.add(money.pendingTotal),
        },
      });
      // Only when this was their last open stay — a patient cannot be sent home
      // from one ward while still lying in another.
      const stillIn = await tx.admission.count({
        where: { patientId: a.patientId, status: 'ACTIVE', id: { not: id } },
      });
      if (stillIn === 0) {
        await tx.patient.update({
          where: { id: a.patientId },
          data: { careType: 'AMBULATORY' },
        });
      }
      return adm;
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Admission',
      entityId: id,
      after: {
        status: updated.status,
        dischargedAt: updated.dischargedAt,
        debtAtDischarge: updated.debtAtDischarge?.toFixed(2),
        forced,
      },
    });
    return this.map(updated);
  }

  async list(q: AdmissionQueryInput): Promise<PaginatedResult<Record<string, unknown>>> {
    const where: Prisma.AdmissionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.admission.findMany({
        where,
        orderBy: { admittedAt: 'desc' },
        ...skipTake(q),
        include: {
          patient: { select: { id: true, mrn: true, fullName: true, dob: true, gender: true } },
        },
      }),
      this.prisma.db.admission.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...this.map(r), patient: r.patient })),
      { page: q.page, limit: q.limit, total },
    );
  }

  /** The full 003 history: title page, orders with their sheet, daily notes. */
  async getById(id: string, branchId?: string): Promise<Record<string, unknown>> {
    await this.roomBilling.reconcileAdmission(id, branchId);
    const a = await this.prisma.db.admission.findFirst({
      where: { id },
      include: {
        patient: true,
        orders: {
          orderBy: { createdAt: 'asc' },
          include: {
            service: { select: { id: true, name: true, code: true } },
            administrations: { orderBy: { date: 'asc' }, include: { charge: true } },
            billingCharge: true,
          },
        },
        dailyNotes: { orderBy: { date: 'asc' } },
      },
    });
    if (!a) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);

    // A legacy one-dose order can already have its exact bill attached to the
    // delivered dose. Expose it without rewriting or re-billing old records.
    const orders = a.orders.map((order) => ({
      ...order,
      billingCharge: order.billingCharge ?? (
        !order.billedOnOrder && plannedDates(order).length * order.timesPerDay === 1
          ? order.administrations.find((mark) => mark.status === 'GIVEN')?.charge ?? null
          : null
      ),
    }));
    const lineIds = orders.flatMap((order) =>
      order.billingCharge?.invoiceLineId ? [order.billingCharge.invoiceLineId] : [],
    );
    const invoiceLines = lineIds.length
      ? await this.prisma.db.invoiceLine.findMany({
          where: { id: { in: lineIds } },
          include: { invoice: true },
        })
      : [];
    const invoicesByLine = new Map(invoiceLines.map((line) => [line.id, line.invoice]));

    return {
      ...this.map(a),
      patient: a.patient,
      roomBilling: await this.roomBilling.summary(id),
      orders: orders.map((o) => ({
        id: o.id,
        serviceId: o.serviceId,
        service: o.service,
        schedule: o.schedule,
        startDate: o.startDate.toISOString().slice(0, 10),
        timesPlanned: o.timesPlanned,
        note: o.note,
        stoppedAt: o.stoppedAt ? o.stoppedAt.toISOString() : null,
        timesPerDay: o.timesPerDay,
        billedOnOrder: o.billedOnOrder,
        billing: o.billingCharge
          ? {
              chargeId: o.billingCharge.id,
              status: o.billingCharge.status,
              lineTotal: o.billingCharge.unitPrice.mul(o.billingCharge.quantity).toFixed(2),
              invoice: (() => {
                const invoice = o.billingCharge.invoiceLineId
                  ? invoicesByLine.get(o.billingCharge.invoiceLineId)
                  : null;
                return invoice
                  ? {
                      id: invoice.id,
                      number: invoice.number,
                      status: invoice.status,
                      total: invoice.total.toFixed(2),
                      paidTotal: invoice.paidTotal.toFixed(2),
                      due: Prisma.Decimal.max(invoice.total.sub(invoice.paidTotal), 0).toFixed(2),
                    }
                  : null;
              })(),
            }
          : null,
        /** Every planned day with a mark per dose — the treatment sheet as a grid. */
        days: plannedDates(o).map((date) => ({
          date,
          slots: Array.from({ length: o.timesPerDay }, (_, i) => {
            const slot = i + 1;
            const done = o.administrations.find(
              (x) => x.slot === slot && x.date.toISOString().slice(0, 10) === date,
            );
            return { slot, status: done ? done.status : null };
          }),
        })),
      })),
      dailyNotes: a.dailyNotes.map((n) => ({
        id: n.id,
        date: n.date.toISOString().slice(0, 10),
        doctorUserId: n.doctorUserId,
        condition: n.condition,
        temperatureC: n.temperatureC,
        pulseBpm: n.pulseBpm,
        bpSystolic: n.bpSystolic,
        bpDiastolic: n.bpDiastolic,
        note: n.note,
      })),
    };
  }

  /**
   * Everything the 003 form needs on one page, letterhead included.
   *
   * The print view is a faithful reproduction of the paper form, so it needs
   * the clinic header, the full patient identity block (the paper form asks
   * for address and passport, which the detail view does not show), the
   * attending doctor, and every narrative field at once.
   */
  async printPayload(id: string): Promise<Record<string, unknown>> {
    const a = await this.prisma.db.admission.findFirst({
      where: { id },
      include: {
        patient: true,
        orders: {
          orderBy: { createdAt: 'asc' },
          include: {
            service: { select: { name: true } },
            administrations: { orderBy: { date: 'asc' } },
          },
        },
        dailyNotes: { orderBy: { date: 'asc' } },
      },
    });
    if (!a) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);

    // Clinic is not tenant-auto-scoped — justified letterhead read of own clinic row.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { name: true, logoUrl: true, address: true, phone: true },
    });
    const doctor = a.attendingDoctorUserId
      ? await this.prisma.db.user.findFirst({
          where: { id: a.attendingDoctorUserId },
          select: { fullName: true },
        })
      : null;

    return {
      clinic: {
        name: clinic?.name ?? '',
        logoUrl: clinic?.logoUrl ?? null,
        address: clinic?.address ?? null,
        phone: clinic?.phone ?? null,
      },
      admission: {
        ...this.map(a),
        // Admission and discharge calendar dates both count in Asia/Tashkent.
        bedDays: roomBillingDayCount(a.admittedAt, a.dischargedAt ?? new Date()),
      },
      patient: {
        fullName: a.patient.fullName,
        mrn: a.patient.mrn,
        dob: a.patient.dob ? a.patient.dob.toISOString().slice(0, 10) : null,
        gender: a.patient.gender,
        address: a.patient.address,
        phone: a.patient.phone,
        passportId: a.patient.passportId,
        bloodGroup: a.patient.bloodGroup,
        allergies: a.patient.allergies,
      },
      doctor: { fullName: doctor?.fullName ?? null },
      orders: a.orders.map((o) => ({
        service: o.service.name,
        schedule: o.schedule,
        startDate: o.startDate.toISOString().slice(0, 10),
        timesPlanned: o.timesPlanned,
        timesPerDay: o.timesPerDay,
        days: plannedDates(o).map((date) => ({
          date,
          slots: Array.from({ length: o.timesPerDay }, (_, i) => {
            const slot = i + 1;
            const done = o.administrations.find(
              (x) => x.slot === slot && x.date.toISOString().slice(0, 10) === date,
            );
            return { slot, status: done ? done.status : null };
          }),
        })),
      })),
      dailyNotes: a.dailyNotes.map((n) => ({
        date: n.date.toISOString().slice(0, 10),
        condition: n.condition,
        temperatureC: n.temperatureC,
        pulseBpm: n.pulseBpm,
        bpSystolic: n.bpSystolic,
        bpDiastolic: n.bpDiastolic,
      })),
    };
  }

  // ------------------------------------------------------- treatment sheet

  async createOrder(
    admissionId: string,
    dto: CreateOrderInput,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();
    const schedule = {
      serviceId: dto.serviceId,
      schedule: dto.schedule,
      startDate: dto.startDate,
      timesPlanned: dto.schedule === 'ONCE' ? 1 : dto.timesPlanned,
      timesPerDay: dto.schedule === 'ONCE' ? 1 : dto.timesPerDay,
      note: dto.note ?? null,
    };
    const requestFingerprint = createHash('sha256').update(JSON.stringify(schedule)).digest('hex');
    const result = await this.prisma.db.$transaction(async (tx) => {
      const a = await this.lockAdmission(tx, admissionId);
      if (dto.idempotencyKey) {
        const replay = await tx.treatmentOrder.findFirst({
          where: { admissionId, requestKey: dto.idempotencyKey },
        });
        if (replay) {
          if (replay.requestFingerprint !== requestFingerprint)
            throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu so‘rov kaliti boshqa tayinlov uchun ishlatilgan', 409);
          return { order: replay, created: false };
        }
      }
      this.requireActive(a);
      const service = await tx.service.findFirst({ where: { id: dto.serviceId, isActive: true, category: { isActive: true } }, include: { category: { select: { kind: true } } } });
      if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Xizmat topilmadi', 404);
      if (service.category.kind === 'SURGERY') throw new AppException(ErrorCode.VALIDATION_ERROR, 'Operatsiyani statsionar kartasining Operatsiyalar bo‘limidan kiriting', 400);
      const unitPrice = await this.orderPrice(tx, service.id, a.branchId);
      const charge = await tx.chargeItem.create({
        data: {
          clinicId,
          branchId: a.branchId,
          patientId: a.patientId,
          admissionId,
          serviceId: service.id,
          title: service.name as Prisma.InputJsonValue,
          date: new Date(dto.startDate),
          quantity: schedule.timesPlanned * schedule.timesPerDay,
          unitPrice,
          createdById: user.id,
        },
      });
      const order = await tx.treatmentOrder.create({
        data: {
          ...schedule,
          clinicId,
          admissionId,
          doctorUserId: user.id,
          startDate: new Date(dto.startDate),
          billedOnOrder: true,
          billingChargeId: charge.id,
          requestKey: dto.idempotencyKey ?? null,
          requestFingerprint: dto.idempotencyKey ? requestFingerprint : null,
        },
      });
      await this.invoices.issueChargesInTransaction(tx, [charge.id], user, a.branchId);
      await tx.auditLog.create({
        data: {
          clinicId,
          userId: user.id,
          action: AuditAction.CREATE,
          entity: 'TreatmentOrder',
          entityId: order.id,
          diff: { after: { admissionId, ...schedule, billingChargeId: charge.id, quantity: charge.quantity } },
        },
      });
      return { order, created: true };
    });
    return { id: result.order.id, days: plannedDates(result.order), billingChargeId: result.order.billingChargeId };
  }

  /** Resolve and snapshot the effective price inside the same billing transaction. */
  private async orderPrice(tx: TenantTransactionClient, serviceId: string, branchId: string) {
    const now = new Date();
    const prices = await tx.servicePrice.findMany({
      where: {
        serviceId,
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          { OR: [{ branchId }, { branchId: null }] },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const price = prices.find((row) => row.branchId === branchId) ?? prices.find((row) => row.branchId === null);
    if (!price) throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat narxi belgilanmagan', 400);
    return price.price;
  }

  async stopOrder(orderId: string): Promise<{ id: string }> {
    const order = await this.prisma.db.treatmentOrder.findFirst({ where: { id: orderId } });
    if (!order) throw new AppException(ErrorCode.NOT_FOUND, 'Tayinlov topilmadi', 404);
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const admission = await this.lockAdmission(tx, order.admissionId);
      this.requireActive(admission);
      return tx.treatmentOrder.updateMany({
        where: { id: orderId, admissionId: order.admissionId, stoppedAt: null },
        data: { stoppedAt: new Date() },
      });
    });
    if (changed.count)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: 'TreatmentOrder',
        entityId: orderId,
        after: { stopped: true },
      });
    return { id: orderId };
  }

  /**
   * Optional clinical history. Upfront-billed orders never change money here.
   * Legacy orders still create a charge on GIVEN; a correction can cancel only
   * their un-invoiced charge, preserving the historical billing workflow.
   */
  async markAdministration(
    admissionId: string,
    dto: MarkAdministrationInput,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      const a = await this.lockAdmission(tx, admissionId);
      this.requireActive(a);
      const order = await tx.treatmentOrder.findFirst({
        where: { id: dto.orderId, admissionId },
        include: { service: true },
      });
      if (!order) throw new AppException(ErrorCode.NOT_FOUND, 'Tayinlov topilmadi', 404);
      if (!plannedDates(order).includes(dto.date) || dto.slot < 1 || dto.slot > order.timesPerDay) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Bu sana yoki mahal tayinlov jadvalida yo‘q',
          400,
        );
      }
      const existing = await tx.treatmentAdministration.findFirst({
        where: { orderId: dto.orderId, date: new Date(dto.date), slot: dto.slot },
        include: { charge: true },
      });
      // Reception has already billed every planned dose. A clinical mark is
      // still a useful historical fact, but may neither bill a second time nor
      // silently subtract money from an issued invoice.
      if (order.billedOnOrder) {
        if (existing?.status === dto.status)
          return { id: existing.id, status: existing.status, changed: false };
        if (dto.status === 'GIVEN' && (order.stoppedAt || !order.service.isActive))
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Tayinlov yoki xizmat faol emas', 409);
        const administration = existing
          ? await tx.treatmentAdministration.update({
              where: { id: existing.id },
              data: { status: dto.status, markedById: user.id },
            })
          : await tx.treatmentAdministration.create({
              data: {
                clinicId,
                orderId: order.id,
                date: new Date(dto.date),
                slot: dto.slot,
                status: dto.status,
                markedById: user.id,
              },
            });
        return { id: administration.id, status: administration.status, changed: true };
      }
      let charge = existing?.charge ?? null;
      if (charge) {
        // Invoice creation claims this same row. Re-read after the lock so a
        // just-billed administration cannot be cancelled from a stale snapshot.
        await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "id" = ${charge.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
        charge = await tx.chargeItem.findFirst({ where: { id: charge.id } });
      }
      const replay =
        existing?.status === dto.status &&
        (dto.status === 'GIVEN'
          ? charge && charge.status !== 'CANCELLED'
          : !charge || charge.status === 'CANCELLED');
      if (replay && existing) return { id: existing.id, status: existing.status, changed: false };
      if (charge?.status === 'INVOICED' || charge?.invoiceLineId) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Bu xizmat hisob-fakturaga kiritilgan — belgini o‘zgartirib bo‘lmaydi',
          409,
        );
      }
      if (dto.status === 'GIVEN' && (order.stoppedAt || !order.service.isActive)) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Tayinlov yoki xizmat faol emas', 409);
      }
      // Resolve a price only for a new charge. A retry or a corrected mark
      // retains its original charge snapshot, even after the catalogue changes.
      let price: Prisma.Decimal | null = null;
      if (dto.status === 'GIVEN' && !charge) {
        const priceStr = await this.pricing.getCurrentPrice(order.serviceId, a.branchId);
        if (priceStr === null)
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Xizmat narxi belgilanmagan', 400);
        price = new Prisma.Decimal(priceStr);
      }
      const administration = existing
        ? await tx.treatmentAdministration.update({
            where: { id: existing.id },
            data: { status: dto.status, markedById: user.id },
          })
        : await tx.treatmentAdministration.create({
            data: {
              clinicId,
              orderId: dto.orderId,
              date: new Date(dto.date),
              slot: dto.slot,
              status: dto.status,
              markedById: user.id,
            },
          });
      if (charge) {
        await tx.chargeItem.update({
          where: { id: charge.id },
          data: { status: dto.status === 'GIVEN' ? 'PENDING' : 'CANCELLED' },
        });
      } else if (price !== null) {
        await tx.chargeItem.create({
          data: {
            clinicId,
            branchId: a.branchId,
            patientId: a.patientId,
            admissionId,
            administrationId: administration.id,
            serviceId: order.serviceId,
            title: order.service.name as Prisma.InputJsonValue,
            date: new Date(dto.date),
            quantity: 1,
            unitPrice: price,
            createdById: user.id,
          },
        });
      }
      return { id: administration.id, status: dto.status, changed: true };
    });
    if (result.changed)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: 'TreatmentAdministration',
        entityId: result.id,
        after: { admissionId, ...dto },
      });
    return { id: result.id, status: result.status };
  }

  // ------------------------------------------------------------ daily notes

  async addDailyNote(
    admissionId: string,
    dto: DailyNoteInput,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const note = await this.prisma.db.$transaction(async (tx) => {
      const a = await this.lockAdmission(tx, admissionId);
      this.requireActive(a);
      return tx.admissionDailyNote.create({
        data: {
          clinicId: TenantContext.requireClinicId(),
          admissionId,
          doctorUserId: user.id,
          date: new Date(dto.date),
          condition: dto.condition,
          temperatureC: dto.temperatureC ?? null,
          pulseBpm: dto.pulseBpm ?? null,
          bpSystolic: dto.bpSystolic ?? null,
          bpDiastolic: dto.bpDiastolic ?? null,
          note: dto.note ?? null,
        },
      });
    });
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'AdmissionDailyNote',
      entityId: note.id,
      after: { admissionId, date: dto.date },
    });
    return { id: note.id, date: dto.date };
  }
}
