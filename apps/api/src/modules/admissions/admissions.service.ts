import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Admission, TreatmentOrder } from '@prisma/client';
import {
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
import { PricingService } from '../services/pricing.service';

/** Every planned date of an order, from its schedule. */
function plannedDates(order: Pick<TreatmentOrder, 'schedule' | 'startDate' | 'timesPlanned'>): string[] {
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
      attendingDoctorUserId: a.attendingDoctorUserId,
      admittedAt: a.admittedAt.toISOString(),
      dischargedAt: a.dischargedAt ? a.dischargedAt.toISOString() : null,
      referredBy: a.referredBy,
      referralDiagnosis: a.referralDiagnosis,
      admissionDiagnosis: a.admissionDiagnosis,
      clinicalDiagnosis: a.clinicalDiagnosis,
      clinicalDiagnosisAt: a.clinicalDiagnosisAt ? a.clinicalDiagnosisAt.toISOString().slice(0, 10) : null,
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
  private async nextHistoryNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `KT-${year}-`;
    const last = await this.prisma.db.admission.findFirst({
      where: { historyNumber: { startsWith: prefix } },
      orderBy: { historyNumber: 'desc' },
      select: { historyNumber: true },
    });
    const n = last ? Number(last.historyNumber.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  async admit(dto: AdmitPatientInput, user: AuthUser, branchId: string): Promise<Record<string, unknown>> {
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

    const created = await this.prisma.db.admission.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        branchId,
        patientId: dto.patientId,
        historyNumber: await this.nextHistoryNumber(),
        department: dto.department ?? null,
        ward: dto.ward ?? null,
        bed: dto.bed ?? null,
        attendingDoctorUserId: dto.attendingDoctorUserId ?? user.id,
        admittedAt: dto.admittedAt ? new Date(dto.admittedAt) : new Date(),
        referredBy: dto.referredBy ?? null,
        referralDiagnosis: dto.referralDiagnosis ?? null,
        admissionDiagnosis: dto.admissionDiagnosis ?? null,
        firstTimeThisYear: dto.firstTimeThisYear ?? null,
      },
    });
    // Admitting is also the moment the patient becomes an inpatient.
    await this.prisma.db.patient.update({
      where: { id: dto.patientId },
      data: { careType: 'INPATIENT' },
    });
    return this.map(created);
  }

  private async require(id: string): Promise<Admission> {
    const a = await this.prisma.db.admission.findFirst({ where: { id } });
    if (!a) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);
    return a;
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
    const a = await this.require(id);

    const invoicedKept = await this.prisma.db.chargeItem.count({
      where: { admissionId: id, status: 'INVOICED' },
    });

    await this.prisma.db.$transaction(async (tx) => {
      const orders = await tx.treatmentOrder.findMany({
        where: { admissionId: id },
        select: { id: true },
      });
      const orderIds = orders.map((o) => o.id);
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
    });

    return { id, invoicedKept };
  }

  async update(id: string, dto: UpdateAdmissionInput): Promise<Record<string, unknown>> {
    const a = await this.require(id);
    this.requireActive(a);
    const updated = await this.prisma.db.admission.update({
      where: { id },
      data: {
        ...dto,
        clinicalDiagnosisAt: dto.clinicalDiagnosisAt ? new Date(dto.clinicalDiagnosisAt) : undefined,
        attendingDoctorUserId: dto.attendingDoctorUserId ?? undefined,
      },
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
  private async stayMoney(admissionId: string, patientId: string): Promise<{
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

    const pendingRows = await this.prisma.db.chargeItem.findMany({
      where: { admissionId, status: 'PENDING' },
      select: { id: true, title: true, unitPrice: true, quantity: true },
      orderBy: { date: 'asc' },
    });
    const pendingTotal = pendingRows.reduce(
      (acc, c) => acc.add(c.unitPrice.mul(c.quantity)),
      zero,
    );

    const linked = await this.prisma.db.chargeItem.findMany({
      where: { admissionId, invoiceLineId: { not: null } },
      select: { invoiceLineId: true },
    });
    const lineIds = linked
      .map((l) => l.invoiceLineId)
      .filter((x): x is string => x !== null);
    const stayInvoiceIds =
      lineIds.length > 0
        ? [
            ...new Set(
              (
                await this.prisma.db.invoiceLine.findMany({
                  where: { id: { in: lineIds } },
                  select: { invoiceId: true },
                })
              ).map((l) => l.invoiceId),
            ),
          ]
        : [];

    const openStay =
      stayInvoiceIds.length > 0
        ? await this.prisma.db.invoice.findMany({
            where: { id: { in: stayInvoiceIds }, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
            select: { id: true, number: true, status: true, total: true, paidTotal: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];
    const stayDebt = openStay.reduce((acc, i) => acc.add(i.total.sub(i.paidTotal)), zero);

    // Everything else the patient owes. Shown so the desk knows, never enforced
    // — see discharge() for why it must not hold a bed.
    const allOpen = await this.prisma.db.invoice.aggregate({
      where: { patientId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      _sum: { total: true, paidTotal: true },
    });
    const totalDebt = (allOpen._sum.total ?? zero).sub(allOpen._sum.paidTotal ?? zero);
    const otherDebt = totalDebt.sub(stayDebt);

    const patient = await this.prisma.db.patient.findFirst({
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
  async dischargeCheck(id: string): Promise<Record<string, unknown>> {
    const a = await this.require(id);
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
    const a = await this.require(id);
    this.requireActive(a);

    const money = await this.stayMoney(id, a.patientId);

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

    // One transaction: a discharge that updated the admission but not the
    // patient left an AMBULATORY-less patient with no ACTIVE stay — the ward
    // showed them gone while the patient card refused a new admission.
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const adm = await tx.admission.update({
        where: { id },
        data: {
          status: 'DISCHARGED',
          dischargedAt: dto.dischargedAt ? new Date(dto.dischargedAt) : new Date(),
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
        include: { patient: { select: { id: true, mrn: true, fullName: true, dob: true, gender: true } } },
      }),
      this.prisma.db.admission.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...this.map(r), patient: r.patient })),
      { page: q.page, limit: q.limit, total },
    );
  }

  /** The full 003 history: title page, orders with their sheet, daily notes. */
  async getById(id: string): Promise<Record<string, unknown>> {
    const a = await this.prisma.db.admission.findFirst({
      where: { id },
      include: {
        patient: true,
        orders: {
          orderBy: { createdAt: 'asc' },
          include: {
            service: { select: { id: true, name: true, code: true } },
            administrations: { orderBy: { date: 'asc' } },
          },
        },
        dailyNotes: { orderBy: { date: 'asc' } },
      },
    });
    if (!a) throw new AppException(ErrorCode.NOT_FOUND, 'Kasallik tarixi topilmadi', 404);

    return {
      ...this.map(a),
      patient: a.patient,
      orders: a.orders.map((o) => ({
        id: o.id,
        serviceId: o.serviceId,
        service: o.service,
        schedule: o.schedule,
        startDate: o.startDate.toISOString().slice(0, 10),
        timesPlanned: o.timesPlanned,
        note: o.note,
        stoppedAt: o.stoppedAt ? o.stoppedAt.toISOString() : null,
        timesPerDay: o.timesPerDay,
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
          include: { service: { select: { name: true } }, administrations: { orderBy: { date: 'asc' } } },
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
        // Bed-days as the ward counts them: the day of admission counts.
        bedDays: Math.max(
          1,
          Math.ceil(
            ((a.dischargedAt ?? new Date()).getTime() - a.admittedAt.getTime()) / 86_400_000,
          ),
        ),
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

  async createOrder(admissionId: string, dto: CreateOrderInput, user: AuthUser): Promise<Record<string, unknown>> {
    const a = await this.require(admissionId);
    this.requireActive(a);
    const service = await this.prisma.db.service.findFirst({ where: { id: dto.serviceId, isActive: true } });
    if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Xizmat topilmadi', 404);

    const order = await this.prisma.db.treatmentOrder.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        admissionId,
        serviceId: dto.serviceId,
        doctorUserId: user.id,
        schedule: dto.schedule,
        startDate: new Date(dto.startDate),
        timesPlanned: dto.schedule === 'ONCE' ? 1 : dto.timesPlanned,
        timesPerDay: dto.schedule === 'ONCE' ? 1 : dto.timesPerDay,
        note: dto.note ?? null,
      },
    });
    return { id: order.id, days: plannedDates(order) };
  }

  async stopOrder(orderId: string): Promise<{ id: string }> {
    const order = await this.prisma.db.treatmentOrder.findFirst({ where: { id: orderId } });
    if (!order) throw new AppException(ErrorCode.NOT_FOUND, 'Tayinlov topilmadi', 404);
    await this.prisma.db.treatmentOrder.update({
      where: { id: orderId },
      data: { stoppedAt: new Date() },
    });
    return { id: orderId };
  }

  /**
   * Marks one planned day. GIVEN writes the charge; SKIPPED records that it
   * was not taken and bills nothing. Re-marking the same day flips it, and
   * flipping GIVEN→SKIPPED cancels the charge — provided it has not been
   * invoiced yet, because money already on a bill is not ours to erase.
   */
  async markAdministration(
    admissionId: string,
    dto: MarkAdministrationInput,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const a = await this.require(admissionId);
    this.requireActive(a);

    const order = await this.prisma.db.treatmentOrder.findFirst({
      where: { id: dto.orderId, admissionId },
      include: { service: true },
    });
    if (!order) throw new AppException(ErrorCode.NOT_FOUND, 'Tayinlov topilmadi', 404);
    if (order.stoppedAt) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Bu tayinlov to‘xtatilgan', 409);
    }
    if (!plannedDates(order).includes(dto.date)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Bu sana tayinlov jadvalida yo‘q',
        400,
      );
    }
    if (dto.slot > order.timesPerDay) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Bu tayinlov kunida ${order.timesPerDay} mahal — ${dto.slot}-mahal jadvalda yo‘q`,
        400,
      );
    }

    const clinicId = TenantContext.requireClinicId();
    // The clinic's real pricing rules — branch override first, future-dated
    // rows excluded. The old raw lookup ignored both, so a ward in a branch
    // with its own price billed the clinic-wide one, and a price scheduled for
    // next month was charged today.
    const priceStr = await this.pricing.getCurrentPrice(order.serviceId, a.branchId);

    return this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.treatmentAdministration.findFirst({
        where: { orderId: dto.orderId, date: new Date(dto.date), slot: dto.slot },
        include: { charge: true },
      });

      if (existing) {
        if (existing.charge && existing.charge.status === 'INVOICED') {
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Bu xizmat hisob-fakturaga kiritilgan — belgini o‘zgartirib bo‘lmaydi',
            409,
          );
        }
        await tx.treatmentAdministration.update({
          where: { id: existing.id },
          data: { status: dto.status, markedById: user.id },
        });
        if (existing.charge) {
          await tx.chargeItem.update({
            where: { id: existing.charge.id },
            data: { status: dto.status === 'GIVEN' ? 'PENDING' : 'CANCELLED' },
          });
        } else if (dto.status === 'GIVEN') {
          await tx.chargeItem.create({
            data: {
              clinicId,
              branchId: a.branchId,
              patientId: a.patientId,
              admissionId,
              administrationId: existing.id,
              serviceId: order.serviceId,
              title: order.service.name as Prisma.InputJsonValue,
              date: new Date(dto.date),
              quantity: 1,
              unitPrice: new Prisma.Decimal(priceStr ?? 0),
              createdById: user.id,
            },
          });
        }
        return { id: existing.id, status: dto.status };
      }

      const created = await tx.treatmentAdministration.create({
        data: {
          clinicId,
          orderId: dto.orderId,
          date: new Date(dto.date),
          slot: dto.slot,
          status: dto.status,
          markedById: user.id,
        },
      });
      if (dto.status === 'GIVEN') {
        await tx.chargeItem.create({
          data: {
            clinicId,
            branchId: a.branchId,
            patientId: a.patientId,
            admissionId,
            administrationId: created.id,
            serviceId: order.serviceId,
            title: order.service.name as Prisma.InputJsonValue,
            date: new Date(dto.date),
            quantity: 1,
            unitPrice: new Prisma.Decimal(priceStr ?? 0),
            createdById: user.id,
          },
        });
      }
      return { id: created.id, status: dto.status };
    });
  }

  // ------------------------------------------------------------ daily notes

  async addDailyNote(admissionId: string, dto: DailyNoteInput, user: AuthUser): Promise<Record<string, unknown>> {
    const a = await this.require(admissionId);
    this.requireActive(a);
    const note = await this.prisma.db.admissionDailyNote.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
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
    return { id: note.id, date: dto.date };
  }
}
