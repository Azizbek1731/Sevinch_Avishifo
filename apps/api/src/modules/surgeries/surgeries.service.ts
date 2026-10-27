import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  AuditAction,
  ErrorCode,
  TIMEZONE,
  type AddSurgeryEntriesInput,
  type AddSurgeryStaffFeesInput,
  type AuthUser,
  type CreateSurgeryInput,
  type SurgeryQueryInput,
  type SurgerySelectorQueryInput,
  type SurgeryStaffRole,
} from "@avishifo/shared";
import { AppException } from "../../common/app.exception";
import { paginated, skipTake } from "../../common/pagination";
import { AuditService } from "../../core/audit/audit.service";
import { PrismaService } from "../../core/prisma/prisma.service";
import { TenantContext } from "../../core/prisma/tenant-context";
import type { TenantTransactionClient } from "../../core/prisma/tenant-extension";
const INCLUDE = {
  patient: { select: { id: true, mrn: true, fullName: true } },
  admission: {
    select: {
      id: true,
      historyNumber: true,
      ward: true,
      bed: true,
      status: true,
    },
  },
  service: { select: { id: true, name: true } },
  surgeon: { select: { id: true, fullName: true } },
  serviceCharge: true,
  entries: {
    include: { chargeItem: true },
    orderBy: [{ createdAt: "asc" as const }, { lineIndex: "asc" as const }],
  },
  staffFees: {
    include: { chargeItem: true },
    orderBy: [{ createdAt: "asc" as const }, { lineIndex: "asc" as const }],
  },
  payouts: {
    include: { doctor: { select: { id: true, fullName: true } } },
    orderBy: { paidAt: "desc" as const },
  },
} satisfies Prisma.SurgeryCaseInclude;
type Surgery = Prisma.SurgeryCaseGetPayload<{ include: typeof INCLUDE }>;
const zero = () => new Prisma.Decimal(0);
const fingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const maxMoney = new Prisma.Decimal("999999999999.99");
const STAFF_FEE_TITLES: Record<SurgeryStaffRole, Record<string, string>> = {
  SURGEON: {
    uz: "Jarroh xizmati",
    "uz-Cyrl": "Жарроҳ хизмати",
    ru: "Услуги хирурга",
    en: "Surgeon service",
  },
  ANESTHESIOLOGIST: {
    uz: "Anesteziolog xizmati",
    "uz-Cyrl": "Анестезиолог хизмати",
    ru: "Услуги анестезиолога",
    en: "Anesthesiologist service",
  },
  NURSE: {
    uz: "Hamshira xizmati",
    "uz-Cyrl": "Ҳамшира хизмати",
    ru: "Услуги медсестры",
    en: "Nurse service",
  },
};

/** Surgical fees and consumable use join the existing inpatient charge ledger. */
@Injectable()
export class SurgeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(user: AuthUser, branchId: string) {
    if (user.branchIds.length && !user.branchIds.includes(branchId)) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        "Bu filialga kirish huquqi yo‘q",
        403,
      );
    }
    return { branchId };
  }

  private map(surgery: Surgery, user: AuthUser) {
    const canViewPayouts =
      user.permissions.includes("surgery.payout") ||
      user.permissions.includes("payroll.read");
    const feeAmount = surgery.serviceCharge.unitPrice.mul(
      surgery.serviceCharge.quantity,
    );
    const liveEntries = surgery.entries.filter(
      (entry) => entry.chargeItem.status !== "CANCELLED",
    );
    const materialTotal = liveEntries
      .filter((entry) => entry.kind === "MATERIAL")
      .reduce((sum, entry) => sum.add(entry.chargeItem.unitPrice), zero());
    const anesthesiaTotal = liveEntries
      .filter((entry) => entry.kind === "ANESTHESIA")
      .reduce((sum, entry) => sum.add(entry.chargeItem.unitPrice), zero());
    const staffFeeTotal = surgery.staffFees
      .filter((fee) => fee.chargeItem.status !== "CANCELLED")
      .reduce((sum, fee) => sum.add(fee.amount), zero());
    return {
      id: surgery.id,
      admissionId: surgery.admissionId,
      patientId: surgery.patientId,
      patient: surgery.patient,
      admission: surgery.admission,
      service: surgery.service,
      surgeon: surgery.surgeon,
      scheduledDate: surgery.scheduledDate.toISOString().slice(0, 10),
      status: surgery.status,
      note: surgery.note,
      completedAt: surgery.completedAt?.toISOString() ?? null,
      feeAmount: feeAmount.toFixed(2),
      materialTotal: materialTotal.toFixed(2),
      anesthesiaTotal: anesthesiaTotal.toFixed(2),
      staffFeeTotal: staffFeeTotal.toFixed(2),
      totalAmount: (surgery.serviceCharge.status === "CANCELLED"
        ? zero()
        : feeAmount
      )
        .add(materialTotal)
        .add(anesthesiaTotal)
        .add(staffFeeTotal)
        .toFixed(2),
      serviceCharge: {
        id: surgery.serviceCharge.id,
        status: surgery.serviceCharge.status,
      },
      entries: surgery.entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        serviceId: entry.serviceId,
        title: entry.title,
        quantity: entry.quantity.toFixed(3),
        unit: entry.unit,
        unitPrice: entry.unitPrice.toFixed(2),
        lineTotal: entry.chargeItem.unitPrice.toFixed(2),
        note: entry.note,
        chargeItemId: entry.chargeItemId,
        status: entry.chargeItem.status,
        createdAt: entry.createdAt.toISOString(),
      })),
      staffFees: surgery.staffFees.map((fee) => ({
        id: fee.id,
        role: fee.role,
        amount: fee.amount.toFixed(2),
        note: fee.note,
        chargeItemId: fee.chargeItemId,
        status: fee.chargeItem.status,
        createdAt: fee.createdAt.toISOString(),
      })),
      payouts: (canViewPayouts
        ? surgery.payouts.filter(
            (payout) =>
              user.role !== "DOCTOR" || payout.doctorUserId === user.id,
          )
        : []
      ).map((payout) => ({
        id: payout.id,
        surgeryId: payout.surgeryId,
        doctorUserId: payout.doctorUserId,
        doctor: payout.doctor,
        doctorName: payout.doctor.fullName,
        patientId: payout.patientId,
        type: payout.type,
        value: payout.value.toFixed(2),
        basisAmount: payout.basisAmount.toFixed(2),
        amount: payout.amount.toFixed(2),
        method: payout.method,
        expenseId: payout.expenseId,
        note: payout.note,
        paidAt: payout.paidAt.toISOString(),
        voidedAt: payout.voidedAt?.toISOString() ?? null,
        voidReason: payout.voidReason,
      })),
      createdAt: surgery.createdAt.toISOString(),
      updatedAt: surgery.updatedAt.toISOString(),
    };
  }

  /** Live (non-cancelled) charges tied to a surgery case. */
  private liveCharges(surgery: {
    serviceCharge: { status: string; invoiceLineId: string | null };
    entries: Array<{ chargeItem: { status: string; invoiceLineId: string | null } }>;
    staffFees: Array<{ chargeItem: { status: string; invoiceLineId: string | null } }>;
  }) {
    return [
      surgery.serviceCharge,
      ...surgery.entries.map((entry) => entry.chargeItem),
      ...surgery.staffFees.map((fee) => fee.chargeItem),
    ].filter((charge) => charge.status !== "CANCELLED");
  }

  /** True when every live charge sits on a PAID invoice. */
  private async settlementBySurgeryId(
    rows: Array<{
      id: string;
      serviceCharge: { status: string; invoiceLineId: string | null };
      entries: Array<{ chargeItem: { status: string; invoiceLineId: string | null } }>;
      staffFees: Array<{ chargeItem: { status: string; invoiceLineId: string | null } }>;
    }>,
  ): Promise<Map<string, boolean>> {
    const lineIds = [
      ...new Set(
        rows.flatMap((row) =>
          this.liveCharges(row)
            .map((charge) => charge.invoiceLineId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const lines = lineIds.length
      ? await this.prisma.db.invoiceLine.findMany({
          where: { id: { in: lineIds } },
          select: { id: true, invoice: { select: { status: true } } },
        })
      : [];
    const paidLines = new Set(
      lines.filter((line) => line.invoice.status === "PAID").map((line) => line.id),
    );
    const result = new Map<string, boolean>();
    for (const row of rows) {
      const charges = this.liveCharges(row);
      result.set(
        row.id,
        charges.length > 0 &&
          charges.every(
            (charge) =>
              charge.status === "INVOICED" &&
              Boolean(charge.invoiceLineId) &&
              paidLines.has(charge.invoiceLineId!),
          ),
      );
    }
    return result;
  }

  private listWhere(query: SurgeryQueryInput, user: AuthUser, branchId: string) {
    return {
      ...this.scope(user, branchId),
      ...(user.role === "DOCTOR" ? { surgeonUserId: user.id } : {}),
      ...(query.admissionId ? { admissionId: query.admissionId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            scheduledDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                patient: {
                  fullName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                patient: {
                  mrn: { contains: query.search, mode: "insensitive" as const },
                },
              },
              {
                admission: {
                  historyNumber: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                surgeon: {
                  fullName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.SurgeryCaseWhereInput;
  }

  async list(query: SurgeryQueryInput, user: AuthUser, branchId: string) {
    const where = this.listWhere(query, user, branchId);
    const { skip, take } = skipTake(query);

    if (!query.bucket) {
      const [rows, total] = await Promise.all([
        this.prisma.db.surgeryCase.findMany({
          where,
          include: INCLUDE,
          skip,
          take,
          orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
        }),
        this.prisma.db.surgeryCase.count({ where }),
      ]);
      const settled = await this.settlementBySurgeryId(rows);
      return paginated(
        rows.map((row) => ({
          ...this.map(row, user),
          billingSettled: settled.get(row.id) ?? false,
        })),
        { page: query.page, limit: query.limit, total },
      );
    }

    // Bucket filter needs payment state — load lite rows, settle, then page.
    const candidates = await this.prisma.db.surgeryCase.findMany({
      where,
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        createdAt: true,
        serviceCharge: { select: { status: true, invoiceLineId: true } },
        entries: {
          select: { chargeItem: { select: { status: true, invoiceLineId: true } } },
        },
        staffFees: {
          select: { chargeItem: { select: { status: true, invoiceLineId: true } } },
        },
      },
      orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
    });
    const settled = await this.settlementBySurgeryId(candidates);
    const filtered = candidates.filter((row) => {
      const paid = settled.get(row.id) ?? false;
      if (query.bucket === "archive") {
        return row.status === "CANCELLED" || (row.status === "COMPLETED" && paid);
      }
      // active: jarayonda — bekor emas; yakunlangan bo‘lsa hali to‘liq to‘lanmagan
      return row.status !== "CANCELLED" && !(row.status === "COMPLETED" && paid);
    });
    const total = filtered.length;
    const pageIds = filtered.slice(skip, skip + take).map((row) => row.id);
    const rows = pageIds.length
      ? await this.prisma.db.surgeryCase.findMany({
          where: { id: { in: pageIds } },
          include: INCLUDE,
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return paginated(
      pageIds
        .map((id) => byId.get(id))
        .filter((row): row is Surgery => Boolean(row))
        .map((row) => ({
          ...this.map(row, user),
          billingSettled: settled.get(row.id) ?? false,
        })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async get(id: string, user: AuthUser, branchId: string) {
    const surgery = await this.prisma.db.surgeryCase.findFirst({
      where: {
        id,
        ...this.scope(user, branchId),
        ...(user.role === "DOCTOR" ? { surgeonUserId: user.id } : {}),
      },
      include: INCLUDE,
    });
    if (!surgery)
      throw new AppException(ErrorCode.NOT_FOUND, "Operatsiya topilmadi", 404);
    const settled = await this.settlementBySurgeryId([surgery]);
    return {
      ...this.map(surgery, user),
      billingSettled: settled.get(surgery.id) ?? false,
    };
  }

  async doctors(
    query: SurgerySelectorQueryInput,
    user: AuthUser,
    branchId: string,
  ) {
    this.scope(user, branchId);
    // User is not tenant-extended, so this minimal selector scopes it explicitly.
    const rows = await this.prisma.unscoped.user.findMany({
      where: {
        clinicId: TenantContext.requireClinicId(),
        role: "DOCTOR",
        status: "ACTIVE",
        deletedAt: null,
        ...(user.role === "DOCTOR" ? { id: user.id } : {}),
        branches: { some: { branchId } },
        ...(query.search
          ? { fullName: { contains: query.search, mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        staffProfile: { select: { specialty: true } },
      },
      orderBy: { fullName: "asc" },
      take: query.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      specialty: row.staffProfile?.specialty ?? null,
    }));
  }

  async admissions(
    query: SurgerySelectorQueryInput,
    user: AuthUser,
    branchId: string,
  ) {
    const rows = await this.prisma.db.admission.findMany({
      where: {
        ...this.scope(user, branchId),
        status: "ACTIVE",
        patient: { deletedAt: null },
        ...(user.role === "DOCTOR"
          ? { surgeries: { some: { surgeonUserId: user.id } } }
          : {}),
        ...(query.search
          ? {
              OR: [
                {
                  historyNumber: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  patient: {
                    fullName: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  patient: {
                    mrn: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        historyNumber: true,
        ward: true,
        bed: true,
        status: true,
        patientId: true,
        patient: { select: { id: true, mrn: true, fullName: true } },
      },
      orderBy: { admittedAt: "desc" },
      take: query.limit,
    });
    return rows;
  }

  private async lockAdmission(
    tx: TenantTransactionClient,
    admissionId: string,
    branchId: string,
  ) {
    const clinicId = TenantContext.requireClinicId();
    await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${admissionId} AND "clinicId" = ${clinicId} AND "branchId" = ${branchId} FOR UPDATE`;
    const admission = await tx.admission.findFirst({
      where: { id: admissionId, branchId },
    });
    if (!admission)
      throw new AppException(
        ErrorCode.NOT_FOUND,
        "Statsionar yozuvi topilmadi",
        404,
      );
    return admission;
  }

  private assertActive(
    admission: { status: string },
    surgery?: { status: string },
  ) {
    if (admission.status !== "ACTIVE")
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        "Bemor statsionardan chiqarilgan",
        409,
      );
    if (surgery?.status === "CANCELLED")
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        "Operatsiya bekor qilingan",
        409,
      );
  }

  private async lockSurgery(
    tx: TenantTransactionClient,
    id: string,
    branchId: string,
    user: AuthUser,
  ) {
    const clinicId = TenantContext.requireClinicId();
    const where = {
      id,
      branchId,
      ...(user.role === "DOCTOR" ? { surgeonUserId: user.id } : {}),
    };
    const existing = await tx.surgeryCase.findFirst({
      where,
      select: { admissionId: true },
    });
    if (!existing)
      throw new AppException(ErrorCode.NOT_FOUND, "Operatsiya topilmadi", 404);
    const admission = await this.lockAdmission(
      tx,
      existing.admissionId,
      branchId,
    );
    await tx.$queryRaw`SELECT "id" FROM "SurgeryCase" WHERE "id" = ${id} AND "clinicId" = ${clinicId} AND "branchId" = ${branchId} FOR UPDATE`;
    const surgery = await tx.surgeryCase.findFirstOrThrow({ where });
    return { admission, surgery };
  }

  private async currentPrice(
    tx: TenantTransactionClient,
    serviceId: string,
    branchId: string,
  ) {
    const now = new Date();
    const rows = await tx.servicePrice.findMany({
      where: {
        serviceId,
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          { OR: [{ branchId }, { branchId: null }] },
        ],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    const price =
      rows.find((row) => row.branchId === branchId)?.price ??
      rows.find((row) => row.branchId === null)?.price;
    if (price === undefined)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        "Katalogdagi narx belgilanmagan",
        400,
      );
    return price;
  }

  private assertReplay(actual: string, expected: string) {
    if (actual !== expected)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        "Bu so‘rov kaliti boshqa ma’lumot uchun ishlatilgan",
        409,
      );
  }

  async create(dto: CreateSurgeryInput, user: AuthUser, branchId: string) {
    this.scope(user, branchId);
    if (user.role === "DOCTOR" && dto.surgeonUserId !== user.id)
      throw new AppException(
        ErrorCode.FORBIDDEN,
        "Faqat o‘z operatsiyangizni rejalashtira olasiz",
        403,
      );
    const clinicId = TenantContext.requireClinicId();
    const requestFingerprint = fingerprint({
      admissionId: dto.admissionId,
      serviceId: dto.serviceId,
      surgeonUserId: dto.surgeonUserId,
      scheduledDate: dto.scheduledDate,
      note: dto.note ?? null,
      branchId,
    });
    const result = await this.prisma.db.$transaction(async (tx) => {
      const admission = await this.lockAdmission(tx, dto.admissionId, branchId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ":surgery:" + dto.idempotencyKey}, 0))`;
      const replay = await tx.surgeryCase.findFirst({
        where: { requestKey: dto.idempotencyKey },
      });
      if (replay) {
        this.assertReplay(replay.requestFingerprint, requestFingerprint);
        return { id: replay.id, created: false };
      }
      this.assertActive(admission);
      const patient = await tx.patient.findFirst({
        where: { id: admission.patientId, deletedAt: null },
        select: { id: true },
      });
      if (!patient)
        throw new AppException(
          ErrorCode.PATIENT_NOT_FOUND,
          "Bemor topilmadi",
          404,
        );
      // Explicit clinic scope: User is intentionally not tenant-extended.
      const surgeon = await tx.user.findFirst({
        where: {
          id: dto.surgeonUserId,
          clinicId,
          role: "DOCTOR",
          status: "ACTIVE",
          deletedAt: null,
          branches: { some: { branchId } },
        },
        select: { id: true },
      });
      if (!surgeon)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Jarroh ushbu filialda faol emas",
          400,
        );
      const service = await tx.service.findFirst({
        where: {
          id: dto.serviceId,
          isActive: true,
          category: { kind: "SURGERY", isActive: true },
        },
      });
      if (!service)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Faol operatsiya xizmatini tanlang",
          400,
        );
      const unitPrice = await this.currentPrice(tx, service.id, branchId);
      const fee = await tx.chargeItem.create({
        data: {
          clinicId,
          branchId,
          admissionId: admission.id,
          patientId: admission.patientId,
          serviceId: service.id,
          title: service.name as Prisma.InputJsonValue,
          date: new Date(dto.scheduledDate),
          quantity: 1,
          unitPrice,
          createdById: user.id,
        },
      });
      const surgery = await tx.surgeryCase.create({
        data: {
          clinicId,
          branchId,
          admissionId: admission.id,
          patientId: admission.patientId,
          serviceId: service.id,
          surgeonUserId: surgeon.id,
          serviceChargeId: fee.id,
          scheduledDate: new Date(dto.scheduledDate),
          note: dto.note ?? null,
          createdById: user.id,
          requestKey: dto.idempotencyKey,
          requestFingerprint,
        },
      });
      await tx.chargeItem.update({
        where: { id: fee.id },
        data: { surgeryId: surgery.id },
      });
      // Surgery fee stays on the inpatient account until discharge.
      return { id: surgery.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: "SurgeryCase",
        entityId: result.id,
        after: {
          admissionId: dto.admissionId,
          serviceId: dto.serviceId,
          surgeonUserId: dto.surgeonUserId,
          scheduledDate: dto.scheduledDate,
          branchId,
        },
      });
    return this.get(result.id, user, branchId);
  }

  private chargeTitle(
    title: Prisma.JsonValue,
    quantity: Prisma.Decimal,
    unit: string,
  ): Prisma.InputJsonValue {
    const suffix = `${quantity.toFixed(3).replace(/\.?0+$/, "")} ${unit}`;
    if (typeof title === "string") return { uz: `${title} (${suffix})` };
    if (title && typeof title === "object" && !Array.isArray(title)) {
      const snapshot: Record<string, string> = {};
      for (const [locale, name] of Object.entries(title))
        if (typeof name === "string") snapshot[locale] = `${name} (${suffix})`;
      if (Object.keys(snapshot).length) return snapshot;
    }
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      "Material nomi belgilanmagan",
      400,
    );
  }

  async addEntries(
    id: string,
    dto: AddSurgeryEntriesInput,
    user: AuthUser,
    branchId: string,
  ) {
    this.scope(user, branchId);
    const clinicId = TenantContext.requireClinicId();
    const requestFingerprint = fingerprint(
      dto.items.map((item) => ({
        kind: item.kind,
        serviceId: item.serviceId ?? null,
        title: item.title ?? null,
        quantity: new Prisma.Decimal(item.quantity).toFixed(3),
        unit: item.unit ?? null,
        unitPrice:
          item.unitPrice === undefined
            ? null
            : new Prisma.Decimal(item.unitPrice).toFixed(2),
        note: item.note ?? null,
      })),
    );
    const result = await this.prisma.db.$transaction(async (tx) => {
      const { admission, surgery } = await this.lockSurgery(
        tx,
        id,
        branchId,
        user,
      );
      const replay = await tx.surgeryEntry.findMany({
        where: { surgeryId: id, requestKey: dto.idempotencyKey },
        orderBy: { lineIndex: "asc" },
      });
      if (replay.length) {
        if (replay.length !== dto.items.length)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "So‘rov tarkibi mos emas",
            409,
          );
        for (const entry of replay)
          this.assertReplay(entry.requestFingerprint, requestFingerprint);
        return { created: false, ids: replay.map((entry) => entry.id) };
      }
      this.assertActive(admission, surgery);
      const ids: string[] = [];
      for (const [lineIndex, item] of dto.items.entries()) {
        const quantity = new Prisma.Decimal(item.quantity);
        if (quantity.lte(0) || quantity.gt("999999999.999"))
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "Miqdor noto‘g‘ri",
            400,
          );
        let title: Prisma.JsonValue = { uz: item.title ?? "" };
        let unit = item.unit;
        let unitPrice =
          item.unitPrice === undefined
            ? null
            : new Prisma.Decimal(item.unitPrice);
        if (item.serviceId) {
          const allowed =
            item.kind === "ANESTHESIA"
              ? ["MEDICINE" as const]
              : ["MATERIAL" as const, "MEDICINE" as const];
          const service = await tx.service.findFirst({
            where: {
              id: item.serviceId,
              isActive: true,
              category: { kind: { in: allowed }, isActive: true },
            },
          });
          if (!service)
            throw new AppException(
              ErrorCode.VALIDATION_ERROR,
              "Ushbu turga mos faol katalog elementi topilmadi",
              400,
            );
          title = service.name;
          unit = service.unit;
          unitPrice = await this.currentPrice(tx, service.id, branchId);
        } else if (!item.title || !unit || unitPrice === null) {
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "Nom, birlik va narxni kiriting",
            400,
          );
        }
        if (!unit || unitPrice === null || unitPrice.lt(0))
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "Birlik yoki narx noto‘g‘ri",
            400,
          );
        const lineTotal = quantity
          .mul(unitPrice)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        if (lineTotal.gt(maxMoney))
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "Material summasi juda katta",
            400,
          );
        // Existing charge/invoice quantities are integers. Preserve actual usage
        // in SurgeryEntry and snapshot it in the charge title; bill its exact rounded total once.
        const charge = await tx.chargeItem.create({
          data: {
            clinicId,
            branchId,
            admissionId: admission.id,
            patientId: surgery.patientId,
            surgeryId: id,
            serviceId: item.serviceId ?? null,
            title: this.chargeTitle(title, quantity, unit),
            date: surgery.scheduledDate,
            quantity: 1,
            unitPrice: lineTotal,
            createdById: user.id,
          },
        });
        const entry = await tx.surgeryEntry.create({
          data: {
            clinicId,
            surgeryId: id,
            kind: item.kind,
            serviceId: item.serviceId ?? null,
            title: title as Prisma.InputJsonValue,
            quantity,
            unit,
            unitPrice,
            chargeItemId: charge.id,
            note: item.note ?? null,
            requestKey: dto.idempotencyKey,
            requestFingerprint,
            lineIndex,
            createdById: user.id,
          },
        });
        ids.push(entry.id);
      }
      // Entry costs stay PENDING on the stay until discharge settlement.
      return { created: true, ids };
    });
    if (result.created)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: "SurgeryEntry",
        entityId: id,
        after: { surgeryId: id, entryIds: result.ids, branchId },
      });
    return this.get(id, user, branchId);
  }

  async addStaffFees(
    id: string,
    dto: AddSurgeryStaffFeesInput,
    user: AuthUser,
    branchId: string,
  ) {
    this.scope(user, branchId);
    const clinicId = TenantContext.requireClinicId();
    const requestFingerprint = fingerprint(
      dto.items.map((item) => ({
        role: item.role,
        amount: new Prisma.Decimal(item.amount).toFixed(2),
        note: item.note?.trim() || null,
      })),
    );
    await this.prisma.db.$transaction(async (tx) => {
      const { admission, surgery } = await this.lockSurgery(
        tx,
        id,
        branchId,
        user,
      );
      const replay = await tx.surgeryStaffFee.findMany({
        where: { surgeryId: id, requestKey: dto.idempotencyKey },
        orderBy: { lineIndex: "asc" },
      });
      if (replay.length) {
        if (replay.length !== dto.items.length)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "So‘rov tarkibi mos emas",
            409,
          );
        for (const fee of replay)
          this.assertReplay(fee.requestFingerprint, requestFingerprint);
        return { created: false, ids: replay.map((fee) => fee.id) };
      }
      this.assertActive(admission, surgery);
      const roles = dto.items.map((item) => item.role);
      if (
        new Set(roles).size !== roles.length ||
        roles.length < 1 ||
        roles.length > 3
      )
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Xodim turi takrorlanmasligi kerak",
          400,
        );
      // The surgery row lock serializes role checks and inserts, including retries
      // from different browser tabs. An already billed role cannot be charged twice.
      const duplicate = await tx.surgeryStaffFee.findFirst({
        where: {
          surgeryId: id,
          role: { in: roles },
          chargeItem: { status: { not: "CANCELLED" } },
        },
        select: { id: true },
      });
      if (duplicate)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Ushbu xodim xizmati allaqachon hisobga kiritilgan",
          409,
        );
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const ids: string[] = [];
      for (const [lineIndex, item] of dto.items.entries()) {
        const amount = new Prisma.Decimal(item.amount);
        if (!amount.isFinite() || amount.lte(0) || amount.gt(maxMoney))
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            "Xodim xizmati summasi noto‘g‘ri",
            400,
          );
        const charge = await tx.chargeItem.create({
          data: {
            clinicId,
            branchId,
            admissionId: admission.id,
            patientId: surgery.patientId,
            surgeryId: id,
            title: STAFF_FEE_TITLES[item.role],
            date: new Date(date),
            quantity: 1,
            unitPrice: amount,
            createdById: user.id,
            // No catalogue service or performer: this extra patient liability
            // must not create a second doctor commission or an employee payout.
          },
        });
        const fee = await tx.surgeryStaffFee.create({
          data: {
            clinicId,
            surgeryId: id,
            role: item.role,
            amount,
            chargeItemId: charge.id,
            note: item.note?.trim() || null,
            requestKey: dto.idempotencyKey,
            requestFingerprint,
            lineIndex,
            createdById: user.id,
          },
        });
        ids.push(fee.id);
      }
      // Staff fees stay PENDING on the stay until discharge settlement.
      await tx.auditLog.create({
        data: {
          clinicId,
          userId: user.id,
          action: AuditAction.CREATE,
          entity: "SurgeryStaffFee",
          entityId: id,
          diff: {
            surgeryId: { before: null, after: id },
            feeIds: { before: null, after: ids },
            branchId: { before: null, after: branchId },
            roles: { before: null, after: roles },
          },
          ip: TenantContext.get()?.ip ?? null,
        },
      });
      return { created: true, ids };
    });
    return this.get(id, user, branchId);
  }

  async cancelStaffFee(
    id: string,
    feeId: string,
    user: AuthUser,
    branchId: string,
  ) {
    this.scope(user, branchId);
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const { admission, surgery } = await this.lockSurgery(
        tx,
        id,
        branchId,
        user,
      );
      const fee = await tx.surgeryStaffFee.findFirst({
        where: { id: feeId, surgeryId: id },
        include: { chargeItem: true },
      });
      if (!fee)
        throw new AppException(
          ErrorCode.NOT_FOUND,
          "Xodim xizmati topilmadi",
          404,
        );
      if (fee.chargeItem.status === "CANCELLED") return false;
      this.assertActive(admission, surgery);
      const changed = await tx.chargeItem.updateMany({
        where: { id: fee.chargeItemId, status: "PENDING", invoiceLineId: null },
        data: { status: "CANCELLED" },
      });
      if (changed.count !== 1)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Xodim xizmati hisobga kiritilgan — avval hisobni bekor qiling",
          409,
        );
      return true;
    });
    if (changed)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: "SurgeryStaffFee",
        entityId: feeId,
        before: { status: "PENDING" },
        after: { status: "CANCELLED", surgeryId: id },
      });
    return this.get(id, user, branchId);
  }

  async cancelEntry(
    id: string,
    entryId: string,
    user: AuthUser,
    branchId: string,
  ) {
    this.scope(user, branchId);
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const { admission, surgery } = await this.lockSurgery(
        tx,
        id,
        branchId,
        user,
      );
      const entry = await tx.surgeryEntry.findFirst({
        where: { id: entryId, surgeryId: id },
        include: { chargeItem: true },
      });
      if (!entry)
        throw new AppException(
          ErrorCode.NOT_FOUND,
          "Material yozuvi topilmadi",
          404,
        );
      const clinicId = TenantContext.requireClinicId();
      await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "id" = ${entry.chargeItemId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      if (entry.chargeItem.status === "CANCELLED") return false;
      this.assertActive(admission, surgery);
      const result = await tx.chargeItem.updateMany({
        where: {
          id: entry.chargeItemId,
          status: "PENDING",
          invoiceLineId: null,
        },
        data: { status: "CANCELLED" },
      });
      if (result.count !== 1)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Material hisobga kiritilgan — avval hisobni bekor qiling",
          409,
        );
      return true;
    });
    if (changed)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: "SurgeryEntry",
        entityId: entryId,
        before: { status: "PENDING" },
        after: { status: "CANCELLED", surgeryId: id },
      });
    return this.get(id, user, branchId);
  }

  async complete(id: string, user: AuthUser, branchId: string) {
    this.scope(user, branchId);
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const { admission, surgery } = await this.lockSurgery(
        tx,
        id,
        branchId,
        user,
      );
      if (surgery.status === "COMPLETED") return false;
      this.assertActive(admission, surgery);
      await tx.surgeryCase.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      return true;
    });
    if (changed)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: "SurgeryCase",
        entityId: id,
        before: { status: "PLANNED" },
        after: { status: "COMPLETED" },
      });
    return this.get(id, user, branchId);
  }

  async cancel(id: string, user: AuthUser, branchId: string) {
    this.scope(user, branchId);
    const changed = await this.prisma.db.$transaction(async (tx) => {
      const { admission, surgery } = await this.lockSurgery(
        tx,
        id,
        branchId,
        user,
      );
      if (surgery.status === "CANCELLED") return false;
      this.assertActive(admission, surgery);
      const clinicId = TenantContext.requireClinicId();
      await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "id" = ${surgery.serviceChargeId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const [entries, payouts, staffFees] = await Promise.all([
        tx.surgeryEntry.count({
          where: {
            surgeryId: id,
            chargeItem: { status: { not: "CANCELLED" } },
          },
        }),
        tx.surgeryPayout.count({ where: { surgeryId: id, voidedAt: null } }),
        tx.surgeryStaffFee.count({
          where: {
            surgeryId: id,
            chargeItem: { status: { not: "CANCELLED" } },
          },
        }),
      ]);
      if (entries > 0 || payouts > 0 || staffFees > 0)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Avval materiallar, xodim xizmatlari yoki jarroh to‘lovini bekor qiling",
          409,
        );
      const fee = await tx.chargeItem.updateMany({
        where: {
          id: surgery.serviceChargeId,
          status: "PENDING",
          invoiceLineId: null,
        },
        data: { status: "CANCELLED" },
      });
      if (fee.count !== 1)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          "Operatsiya hisobga kiritilgan — avval hisobni bekor qiling",
          409,
        );
      await tx.surgeryCase.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      return true;
    });
    if (changed)
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: "SurgeryCase",
        entityId: id,
        after: { status: "CANCELLED" },
      });
    return this.get(id, user, branchId);
  }
}
