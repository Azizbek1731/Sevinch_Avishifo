import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  LabOrderStatus,
  LabValueType,
  NotificationEvent,
  ageInDays,
  flagValue,
  matchReferenceRange,
  type PatientContext,
  type AuthUser,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { EventsService } from '../../core/realtime/events.service';
import { AuditService } from '../../core/audit/audit.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { parseReferenceRanges } from './reference-ranges';
import { PricingService } from '../services/pricing.service';
import {
  FINAL_LAB_STATUSES,
  isLabInvoicePaid,
  labInvoiceNetPaid,
  isLabResultComplete,
  lockLabOrder,
} from './lab-workflow';
import {
  CreateLabOrderDto,
  CreateLabTestDto,
  LabOrderQueryDto,
  LabTestQueryDto,
  UpdateLabOrderContextDto,
  UpdateLabOrderStatusDto,
  UpdateLabTestDto,
} from './dto';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const dateOnly = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** DTO payloads are plain JSON-safe data — narrow them for Prisma Json columns. */
const toJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

type PhysiologicalStateValue = PatientContext['state'];

type LabTestRow = Prisma.LabTestGetPayload<{ include: { parameters: true } }>;

type LabOrderDetailRow = Prisma.LabOrderGetPayload<{
  include: {
    patient: true;
    invoice: { include: { refunds: { select: { amount: true } } } };
    items: {
      include: {
        labTest: { include: { parameters: true } };
        result: { include: { values: true; reportDocument: true } };
      };
    };
    attachments: {
      select: {
        id: true;
        title: true;
        fileName: true;
        mimeType: true;
        sizeBytes: true;
        createdAt: true;
      };
    };
  };
}>;

type LabOrderListRow = Prisma.LabOrderGetPayload<{
  include: {
    patient: true;
    invoice: { include: { refunds: { select: { amount: true } } } };
    _count: { select: { items: true } };
    items: { select: { labTest: { select: { id: true; code: true; name: true } } } };
  };
}>;

/** Guarded manual transitions (RESULTED/APPROVED/DELIVERED go through dedicated endpoints). */
const MANUAL_TRANSITIONS: Readonly<Partial<Record<LabOrderStatus, readonly LabOrderStatus[]>>> = {
  [LabOrderStatus.ORDERED]: [LabOrderStatus.SPECIMEN_COLLECTED, LabOrderStatus.CANCELLED],
  [LabOrderStatus.SPECIMEN_COLLECTED]: [LabOrderStatus.IN_PROGRESS, LabOrderStatus.CANCELLED],
};

@Injectable()
export class LabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly pricing: PricingService,
  ) {}

  // ------------------------------------------------------------ mapping

  private toParameter(
    p: LabTestRow['parameters'][number],
    ctx?: PatientContext,
  ): Record<string, unknown> {
    const ranges = parseReferenceRanges(p.referenceRanges);
    // The interval that applies to THIS patient, resolved once on the server so the entry
    // form, the printed report and the stored flag can never disagree about it.
    const matched = ctx ? matchReferenceRange(ranges, ctx) : undefined;
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      unit: p.unit,
      valueType: p.valueType,
      referenceRanges: p.referenceRanges,
      sortOrder: p.sortOrder,
      ...(ctx
        ? {
            matchedRange: matched,
            // Distinguishes "this analyte has no norms at all" from "the catalogue has
            // norms but none covers a patient of this age", which the tech must see.
            referenceMissing: matched === null && ranges.length > 0,
            // Hormones are reported per cycle phase or trimester. With no state on the
            // order, none of those intervals can match — so say what is missing rather
            // than printing a blank where the norm should be.
            requiresState:
              matched === null && !ctx.state && ranges.some((r) => r.state !== undefined),
          }
        : {}),
    };
  }

  private toTest(t: LabTestRow): Record<string, unknown> {
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      specimenType: t.specimenType,
      biomaterial: t.biomaterial,
      category: t.category,
      catalogCode: t.catalogCode,
      serviceId: t.serviceId,
      isActive: t.isActive,
      parameters: [...t.parameters]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => this.toParameter(p)),
    };
  }

  private toOrderListItem(o: LabOrderListRow): Record<string, unknown> {
    return {
      id: o.id,
      branchId: o.branchId,
      orderNumber: o.orderNumber,
      patientId: o.patientId,
      visitId: o.visitId,
      referringDoctor: o.referringDoctorUserId
        ? { id: o.referringDoctorUserId, fullName: o.referringDoctorName }
        : null,
      status: o.status,
      canWork: isLabInvoicePaid(o.invoice),
      billing: o.invoice
        ? {
            invoiceId: o.invoice.id,
            number: o.invoice.number,
            status: o.invoice.status,
            total: o.invoice.total.toFixed(2),
            paidTotal: o.invoice.paidTotal.toFixed(2),
            due: Prisma.Decimal.max(o.invoice.total.sub(labInvoiceNetPaid(o.invoice)), 0).toFixed(
              2,
            ),
          }
        : null,
      itemCount: o._count.items,
      tests: o.items.map((item) => item.labTest),
      collectedAt: iso(o.collectedAt),
      deliveredAt: iso(o.deliveredAt),
      createdAt: iso(o.createdAt),
      patient: { id: o.patient.id, fullName: o.patient.fullName, mrn: o.patient.mrn },
    };
  }

  private toOrderDetail(o: LabOrderDetailRow): Record<string, unknown> {
    const ctx: PatientContext = {
      gender: o.patient.gender,
      ageDays: ageInDays(o.patient.dob, o.collectedAt ?? o.createdAt),
      state: o.physiologicalState,
    };
    return {
      id: o.id,
      branchId: o.branchId,
      orderNumber: o.orderNumber,
      patientId: o.patientId,
      visitId: o.visitId,
      referringDoctor: o.referringDoctorUserId
        ? { id: o.referringDoctorUserId, fullName: o.referringDoctorName }
        : null,
      status: o.status,
      canWork: isLabInvoicePaid(o.invoice),
      billing: o.invoice
        ? {
            invoiceId: o.invoice.id,
            number: o.invoice.number,
            status: o.invoice.status,
            total: o.invoice.total.toFixed(2),
            paidTotal: o.invoice.paidTotal.toFixed(2),
            due: Prisma.Decimal.max(o.invoice.total.sub(labInvoiceNetPaid(o.invoice)), 0).toFixed(
              2,
            ),
          }
        : null,
      physiologicalState: o.physiologicalState,
      orderedById: o.orderedById,
      collectedAt: iso(o.collectedAt),
      deliveredAt: iso(o.deliveredAt),
      createdAt: iso(o.createdAt),
      updatedAt: iso(o.updatedAt),
      patient: {
        id: o.patient.id,
        mrn: o.patient.mrn,
        fullName: o.patient.fullName,
        dob: dateOnly(o.patient.dob),
        gender: o.patient.gender,
        phone: o.patient.phone,
      },
      items: o.items.map((it) => ({
        id: it.id,
        labTestId: it.labTestId,
        complete: isLabResultComplete(it),
        labTest: {
          id: it.labTest.id,
          code: it.labTest.code,
          name: it.labTest.name,
          specimenType: it.labTest.specimenType,
          biomaterial: it.labTest.biomaterial,
          category: it.labTest.category,
          parameters: [...it.labTest.parameters]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => this.toParameter(p, ctx)),
        },
        result: it.result
          ? {
              id: it.result.id,
              enteredById: it.result.enteredById,
              approvedById: it.result.approvedById,
              approvedAt: iso(it.result.approvedAt),
              note: it.result.note,
              reportDocumentId: it.result.reportDocumentId,
              reportDocument: it.result.reportDocument
                ? {
                    id: it.result.reportDocument.id,
                    title: it.result.reportDocument.title,
                    fileName: it.result.reportDocument.fileName,
                  }
                : null,
              updatedAt: iso(it.result.updatedAt),
              values: it.result.values.map((v) => ({
                id: v.id,
                parameterId: v.parameterId,
                value: v.value,
                flag: v.flag,
              })),
            }
          : null,
      })),
      attachments: o.attachments.map((a) => ({
        id: a.id,
        title: a.title,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: iso(a.createdAt),
      })),
    };
  }

  // ------------------------------------------------------------ worklist events

  /** Emits `lab.order.updated` to the branch lab worklist room (used after every mutation). */
  async emitOrderUpdated(orderId: string): Promise<void> {
    const order = await this.prisma.db.labOrder.findUnique({
      where: { id: orderId },
      include: {
        patient: { select: { fullName: true } },
        _count: { select: { items: true } },
      },
    });
    if (!order) return;
    this.events.toLabWorklist(order.branchId, 'lab.order.updated', {
      order: {
        id: order.id,
        branchId: order.branchId,
        orderNumber: order.orderNumber,
        patientId: order.patientId,
        patientName: order.patient.fullName,
        status: order.status,
        itemCount: order._count.items,
        orderedAt: order.createdAt.toISOString(),
      },
    });
  }

  // ------------------------------------------------------------ lab test catalog

  async createTest(dto: CreateLabTestDto): Promise<Record<string, unknown>> {
    if (dto.serviceId) {
      const service = await this.prisma.db.service.findUnique({ where: { id: dto.serviceId } });
      if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    }
    const clinicId = TenantContext.requireClinicId();
    try {
      const created = await this.prisma.db.labTest.create({
        data: {
          clinicId,
          code: dto.code,
          name: toJson(dto.name),
          specimenType: dto.specimenType,
          serviceId: dto.serviceId,
          parameters: {
            // Nested creates are not auto-stamped by the tenant extension.
            create: dto.parameters.map((p, idx) => ({
              clinicId,
              name: p.name,
              code: p.code,
              unit: p.unit,
              valueType: p.valueType,
              referenceRanges: toJson(p.referenceRanges),
              sortOrder: p.sortOrder ?? idx,
            })),
          },
        },
        include: { parameters: true },
      });
      return this.toTest(created);
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Lab test code or linked service is already in use',
          409,
        );
      }
      throw err;
    }
  }

  async listTests(query: LabTestQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.LabTestWhereInput = {};
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { path: ['uz'], string_contains: query.search, mode: 'insensitive' } },
        { name: { path: ['ru'], string_contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.db.labTest.findMany({
        where,
        include: { parameters: true },
        orderBy: { code: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.db.labTest.count({ where }),
    ]);
    return paginated(
      rows.map((t) => this.toTest(t)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async updateTest(id: string, dto: UpdateLabTestDto): Promise<Record<string, unknown>> {
    const test = await this.prisma.db.labTest.findUnique({
      where: { id },
      include: { parameters: { include: { _count: { select: { values: true } } } } },
    });
    if (!test) throw new AppException(ErrorCode.NOT_FOUND, 'Lab test not found', 404);
    if (dto.serviceId) {
      const service = await this.prisma.db.service.findUnique({ where: { id: dto.serviceId } });
      if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    }

    const clinicId = TenantContext.requireClinicId();
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.labTest.update({
          where: { id },
          data: {
            ...(dto.code !== undefined ? { code: dto.code } : {}),
            ...(dto.name !== undefined ? { name: toJson(dto.name) } : {}),
            ...(dto.specimenType !== undefined ? { specimenType: dto.specimenType } : {}),
            ...(dto.serviceId !== undefined ? { serviceId: dto.serviceId } : {}),
          },
        });

        if (dto.parameters !== undefined) {
          // Replace semantics, matched by parameter name (shared schema carries no ids):
          // update matches, create new names, delete missing ones. Parameters that are
          // already referenced by LabResultValue rows cannot be deleted; the model has
          // no isActive column, so such rows are retained untouched (noted decision).
          const incomingByName = new Map(dto.parameters.map((p, idx) => [p.name, { ...p, idx }]));
          for (const existing of test.parameters) {
            const incoming = incomingByName.get(existing.name);
            if (incoming) {
              await tx.labTestParameter.update({
                where: { id: existing.id },
                data: {
                  unit: incoming.unit ?? null,
                  // The edit dialog does not show the analyte code; an omitted one keeps
                  // its imported value instead of wiping the catalogue provenance.
                  ...(incoming.code !== undefined ? { code: incoming.code } : {}),
                  ...(incoming.valueType !== undefined ? { valueType: incoming.valueType } : {}),
                  referenceRanges: toJson(incoming.referenceRanges),
                  sortOrder: incoming.sortOrder ?? incoming.idx,
                },
              });
              incomingByName.delete(existing.name);
            } else if (existing._count.values === 0) {
              await tx.labTestParameter.delete({ where: { id: existing.id } });
            }
            // else: has result values — keep as-is.
          }
          for (const p of incomingByName.values()) {
            await tx.labTestParameter.create({
              data: {
                clinicId,
                labTestId: id,
                name: p.name,
                code: p.code,
                unit: p.unit,
                valueType: p.valueType,
                referenceRanges: toJson(p.referenceRanges),
                sortOrder: p.sortOrder ?? p.idx,
              },
            });
          }
        }
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Lab test code or linked service is already in use',
          409,
        );
      }
      throw err;
    }

    const updated = await this.prisma.db.labTest.findUnique({
      where: { id },
      include: { parameters: true },
    });
    if (!updated) throw new AppException(ErrorCode.NOT_FOUND, 'Lab test not found', 404);
    return this.toTest(updated);
  }

  // ------------------------------------------------------------ orders

  /** Idempotent invoice-to-laboratory handoff, inside the cashier invoice transaction. */
  async prepareOrderForInvoice(
    tx: TenantTransactionClient,
    invoice: {
      id: string;
      patientId: string;
      branchId: string;
      visitId: string | null;
      createdById: string | null;
    },
    lines: { serviceId: string | null }[],
  ): Promise<{ id: string; orderNumber: string } | null> {
    const existing = await tx.labOrder.findUnique({
      where: { invoiceId: invoice.id },
      select: { id: true, orderNumber: true },
    });
    if (existing) return existing;
    const serviceIds = [
      ...new Set(lines.flatMap((line) => (line.serviceId ? [line.serviceId] : []))),
    ];
    const labServices = await tx.service.findMany({
      where: { id: { in: serviceIds }, category: { kind: 'LAB' } },
      select: { id: true, isActive: true },
    });
    if (labServices.length === 0) return null;
    const tests = await tx.labTest.findMany({
      where: { serviceId: { in: labServices.map((service) => service.id) }, isActive: true },
      select: { id: true, serviceId: true },
    });
    if (tests.length !== labServices.length || labServices.some((service) => !service.isActive)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Every active laboratory service must have an active test before it can be billed',
        400,
      );
    }
    const clinicId = TenantContext.requireClinicId();
    const orderNumber = await this.sequence.nextFormatted('lab', 'L');
    // The bill creator is server-controlled. Never trust a doctor ID from an order payload.
    const referringDoctor = invoice.createdById
      ? await tx.user.findFirst({
          where: { id: invoice.createdById, clinicId, role: 'DOCTOR', deletedAt: null },
          select: { id: true, fullName: true },
        })
      : null;
    return tx.labOrder.create({
      data: {
        clinicId,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        branchId: invoice.branchId,
        visitId: invoice.visitId,
        orderedById: invoice.createdById,
        referringDoctorUserId: referringDoctor?.id ?? null,
        referringDoctorName: referringDoctor?.fullName ?? null,
        orderNumber,
        items: { create: tests.map((test) => ({ clinicId, labTestId: test.id })) },
      },
      select: { id: true, orderNumber: true },
    });
  }

  /** Reception and doctor referrals create their cashier bill together with the order. */
  private async createOrderInternal(
    input: {
      patientId: string;
      branchId: string;
      visitId?: string;
      testIds: string[];
      physiologicalState?: PhysiologicalStateValue;
      orderedById?: string | null;
    },
    outerTx?: TenantTransactionClient,
  ): Promise<{ id: string; orderNumber: string }> {
    const clinicId = TenantContext.requireClinicId();
    const [patient, branch, tests] = await Promise.all([
      this.prisma.db.patient.findFirst({
        where: { id: input.patientId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.db.branch.findFirst({ where: { id: input.branchId }, select: { id: true } }),
      this.prisma.db.labTest.findMany({
        where: { id: { in: [...new Set(input.testIds)] }, isActive: true },
        include: { service: { include: { category: true } } },
      }),
    ]);
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
    if (!branch) throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    if (tests.length !== new Set(input.testIds).size || tests.length === 0)
      throw new AppException(ErrorCode.NOT_FOUND, 'Lab test not found', 404);
    if (
      tests.some(
        (test) => !test.service || !test.service.isActive || test.service.category.kind !== 'LAB',
      )
    ) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Each test needs an active priced laboratory service',
        400,
      );
    }
    if (input.visitId) {
      const visit = await this.prisma.db.visit.findFirst({
        where: { id: input.visitId, patientId: input.patientId, branchId: input.branchId },
      });
      if (!visit) throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
    }
    const serviceIds = tests.map((test) => test.serviceId!);
    const prices = await this.pricing.getCurrentPrices(serviceIds, input.branchId);
    if (serviceIds.some((serviceId) => !prices.has(serviceId)))
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Laboratory service has no current price',
        400,
      );
    // This is the same clinic-controlled invoice number format as cashier invoices.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: { settings: true },
    });
    const settings = (clinic?.settings ?? {}) as Record<string, unknown>;
    const format =
      typeof settings.invoiceNumberFormat === 'string' && settings.invoiceNumberFormat
        ? settings.invoiceNumberFormat
        : 'INV-{YYYY}-{NNNNNN}';
    const sequence = await this.sequence.next('invoice');
    const number = format
      .replace('{YYYY}', String(new Date().getUTCFullYear()))
      .replace(/\{(N+)\}/, (_match, digits: string) =>
        String(sequence).padStart(digits.length, '0'),
      );
    const lines = tests.map((test) => ({
      clinicId,
      serviceId: test.serviceId!,
      title: test.service!.name as Prisma.InputJsonValue,
      quantity: 1,
      unitPrice: new Prisma.Decimal(prices.get(test.serviceId!)!),
      discount: new Prisma.Decimal(0),
      lineTotal: new Prisma.Decimal(prices.get(test.serviceId!)!),
    }));
    const total = lines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
    const create = async (tx: TenantTransactionClient) => {
      const invoice = await tx.invoice.create({
        data: {
          clinicId,
          branchId: input.branchId,
          patientId: input.patientId,
          visitId: input.visitId,
          createdById: input.orderedById,
          number,
          status: total.isZero() ? 'PAID' : 'ISSUED',
          issuedAt: new Date(),
          subtotal: total,
          total,
          lines: { create: lines },
        },
      });
      const order = await this.prepareOrderForInvoice(tx, invoice, lines);
      if (!order)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'No laboratory test could be ordered',
          400,
        );
      if (input.physiologicalState)
        await tx.labOrder.update({
          where: { id: order.id },
          data: { physiologicalState: input.physiologicalState },
        });
      return { order, invoiceId: invoice.id };
    };
    const created = outerTx ? await create(outerTx) : await this.prisma.db.$transaction(create);
    if (outerTx) return created.order;
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Invoice',
      entityId: created.invoiceId,
      after: { number, patientId: input.patientId, total: total.toFixed(2), source: 'LAB_ORDER' },
    });
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'LabOrder',
      entityId: created.order.id,
      after: { invoiceId: created.invoiceId, patientId: input.patientId, testIds: input.testIds },
    });
    await this.emitOrderUpdated(created.order.id);
    return created.order;
  }

  async createOrder(dto: CreateLabOrderDto, user: AuthUser): Promise<Record<string, unknown>> {
    if (user.branchIds.length > 0 && !user.branchIds.includes(dto.branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    const { id } = await this.createOrderInternal({ ...dto, orderedById: user.id });
    return this.getOrder(id);
  }

  async createOrderFromReferral(
    input: {
      patientId: string;
      branchId: string;
      visitId?: string;
      testIds: string[];
      orderedById?: string;
    },
    tx?: TenantTransactionClient,
  ): Promise<{ id: string; orderNumber: string }> {
    return this.createOrderInternal(input, tx);
  }

  /** Call after an external referral transaction commits, never while its rows are uncommitted. */
  async announceReferralOrder(id: string): Promise<void> {
    const order = await this.requireOrder(id);
    if (order.invoice) {
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'Invoice',
        entityId: order.invoice.id,
        after: {
          number: order.invoice.number,
          patientId: order.patientId,
          total: order.invoice.total.toFixed(2),
          source: 'LAB_REFERRAL',
        },
      });
    }
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'LabOrder',
      entityId: id,
      after: {
        invoiceId: order.invoiceId,
        patientId: order.patientId,
        testIds: order.items.map((item) => item.labTestId),
      },
    });
    await this.emitOrderUpdated(id);
  }

  async listOrders(
    query: LabOrderQueryDto,
    user?: AuthUser,
    activeBranchId?: string,
  ): Promise<PaginatedResult<unknown>> {
    const branchId = query.branchId ?? activeBranchId;
    if (user && branchId && user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    const where: Prisma.LabOrderWhereInput = {};
    if (query.referringDoctorUserId) where.referringDoctorUserId = query.referringDoctorUserId;
    if (query.visitId) where.visitId = query.visitId;
    if (!query.includeUnpaid && !query.patientId) {
      // Cashier payments cannot exceed the total: any refund reopens the clinical gate.
      where.AND = [
        {
          OR: [
            { invoiceId: null },
            { invoice: { status: 'PAID', refunds: { none: { amount: { gt: 0 } } } } },
          ],
        },
      ];
    }
    if (query.status) where.status = query.status;
    if (branchId) where.branchId = branchId;
    if (query.patientId) where.patientId = query.patientId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { patient: { fullName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.db.labOrder.findMany({
        where,
        include: {
          patient: true,
          invoice: { include: { refunds: { select: { amount: true } } } },
          _count: { select: { items: true } },
          items: { select: { labTest: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.labOrder.count({ where }),
    ]);
    return paginated(
      rows.map((o) => this.toOrderListItem(o)),
      { page: query.page, limit: query.limit, total },
    );
  }

  private async requireOrder(
    id: string,
    db: TenantTransactionClient = this.prisma.db,
  ): Promise<LabOrderDetailRow> {
    const order = await db.labOrder.findUnique({
      where: { id },
      include: {
        patient: true,
        invoice: { include: { refunds: { select: { amount: true } } } },
        items: {
          include: {
            labTest: { include: { parameters: true } },
            result: { include: { values: true, reportDocument: true } },
          },
        },
        attachments: {
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!order) throw new AppException(ErrorCode.LAB_ORDER_NOT_FOUND, 'Lab order not found', 404);
    return order;
  }

  async getOrder(id: string): Promise<Record<string, unknown>> {
    return this.toOrderDetail(await this.requireOrder(id));
  }

  async updateStatus(id: string, dto: UpdateLabOrderStatusDto): Promise<Record<string, unknown>> {
    const before = await this.prisma.db.$transaction(async (tx) => {
      const order = await lockLabOrder(tx, id, dto.status !== LabOrderStatus.CANCELLED);
      if (dto.status === LabOrderStatus.CANCELLED && order.invoiceId) {
        throw new AppException(
          ErrorCode.LAB_INVALID_TRANSITION,
          'Cancel or refund the linked invoice through the cashier before closing the order',
          409,
        );
      }
      const allowed = MANUAL_TRANSITIONS[order.status] ?? [];
      if (!allowed.includes(dto.status))
        throw new AppException(
          ErrorCode.LAB_INVALID_TRANSITION,
          'Invalid laboratory status transition',
          409,
        );
      await tx.labOrder.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === LabOrderStatus.SPECIMEN_COLLECTED ? { collectedAt: new Date() } : {}),
        },
      });
      return order.status;
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabOrder',
      entityId: id,
      before: { status: before },
      after: { status: dto.status },
    });
    await this.emitOrderUpdated(id);
    return this.getOrder(id);
  }

  async approve(id: string, actorUserId: string): Promise<Record<string, unknown>> {
    const approvedAt = new Date();
    const order = await this.prisma.db.$transaction(async (tx) => {
      await lockLabOrder(tx, id);
      const current = await this.requireOrder(id, tx);
      if (
        current.status !== LabOrderStatus.RESULTED ||
        current.items.length === 0 ||
        !current.items.every(isLabResultComplete)
      ) {
        throw new AppException(
          ErrorCode.LAB_INVALID_TRANSITION,
          'Complete every test or select its uploaded report before signing',
          409,
        );
      }
      await tx.labResult.updateMany({
        where: { orderItem: { orderId: id } },
        data: { approvedById: actorUserId, approvedAt },
      });
      await tx.labOrder.update({ where: { id }, data: { status: LabOrderStatus.APPROVED } });
      return current;
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabOrder',
      entityId: id,
      before: { status: order.status },
      after: {
        status: LabOrderStatus.APPROVED,
        approvedById: actorUserId,
        approvedAt: approvedAt.toISOString(),
      },
    });
    await this.emitOrderUpdated(id);
    await this.notifications.enqueueEvent({
      event: NotificationEvent.LAB_RESULT_READY,
      clinicId: TenantContext.requireClinicId(),
      patientId: order.patientId,
      vars: { patient_name: order.patient.fullName, order_number: order.orderNumber },
    });
    return this.getOrder(id);
  }

  async deliver(id: string): Promise<Record<string, unknown>> {
    await this.prisma.db.$transaction(async (tx) => {
      const order = await lockLabOrder(tx, id, false);
      if (order.status !== LabOrderStatus.APPROVED)
        throw new AppException(
          ErrorCode.LAB_INVALID_TRANSITION,
          'Only signed results can be delivered',
          409,
        );
      await tx.labOrder.update({
        where: { id },
        data: { status: LabOrderStatus.DELIVERED, deliveredAt: new Date() },
      });
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabOrder',
      entityId: id,
      before: { status: LabOrderStatus.APPROVED },
      after: { status: LabOrderStatus.DELIVERED },
    });
    await this.emitOrderUpdated(id);
    return this.getOrder(id);
  }

  /** Proves attachment ownership before the controller delegates streaming to storage. */
  async requireAttachment(orderId: string, documentId: string): Promise<void> {
    await this.requireOrder(orderId);
    const document = await this.prisma.db.patientDocument.findFirst({
      where: { id: documentId, labOrderId: orderId },
      select: { id: true },
    });
    if (!document)
      throw new AppException(ErrorCode.NOT_FOUND, 'Laboratory attachment not found', 404);
  }

  /**
   * Correct the physiological state the specimen was drawn under.
   *
   * Every flag already stored on this order was decided by an interval that the state
   * selects, so changing it re-flags each entered value in the same transaction —
   * leaving a trimester-aware TSH marked "high" against the non-pregnant band would be
   * a wrong flag sitting next to a right number.
   *
   * Refused once the order is approved or delivered: that report has been signed and
   * handed to the patient, and quietly restating it is not a correction anyone can see.
   */
  async updateContext(id: string, dto: UpdateLabOrderContextDto): Promise<Record<string, unknown>> {
    const order = await this.requireOrder(id);
    if (
      order.status === LabOrderStatus.APPROVED ||
      order.status === LabOrderStatus.DELIVERED ||
      order.status === LabOrderStatus.CANCELLED
    ) {
      throw new AppException(
        ErrorCode.LAB_INVALID_TRANSITION,
        `The physiological state cannot be changed on a ${order.status} order`,
        409,
      );
    }
    const before = order.physiologicalState;
    const state = dto.physiologicalState;
    if (before === state) return this.toOrderDetail(order);

    let reflagged = 0;
    await this.prisma.db.$transaction(async (tx) => {
      const locked = await lockLabOrder(tx, id, false);
      if (FINAL_LAB_STATUSES.includes(locked.status))
        throw new AppException(
          ErrorCode.LAB_INVALID_TRANSITION,
          'Signed laboratory context is locked',
          409,
        );
      const current = await this.requireOrder(id, tx);
      const ctx: PatientContext = {
        gender: current.patient.gender,
        ageDays: ageInDays(current.patient.dob, current.collectedAt ?? current.createdAt),
        state,
      };
      await tx.labOrder.update({ where: { id }, data: { physiologicalState: state } });
      for (const item of current.items) {
        if (!item.result) continue;
        const paramById = new Map(item.labTest.parameters.map((p) => [p.id, p]));
        for (const v of item.result.values) {
          const parameter = paramById.get(v.parameterId);
          if (!parameter) continue;
          const { flag } = flagValue(
            v.value,
            parseReferenceRanges(parameter.referenceRanges),
            ctx,
            (parameter.valueType as LabValueType | null) ?? LabValueType.NUMERIC,
          );
          if (flag === v.flag) continue;
          await tx.labResultValue.update({ where: { id: v.id }, data: { flag } });
          reflagged += 1;
        }
      }
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabOrder',
      entityId: id,
      before: { physiologicalState: before },
      after: { physiologicalState: state, reflaggedValues: reflagged },
    });
    await this.emitOrderUpdated(id);

    return this.getOrder(id);
  }

  // ------------------------------------------------------------ print (A4 result form)

  async printPayload(id: string): Promise<Record<string, unknown>> {
    const order = await this.requireOrder(id);

    // Clinic is not tenant-auto-scoped — justified letterhead read of OWN clinic row.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { name: true, legalName: true, logoUrl: true, address: true, phone: true },
    });

    const approvedById =
      order.items.map((it) => it.result?.approvedById).find((v): v is string => Boolean(v)) ?? null;
    let approvedBy: { id: string; fullName: string } | null = null;
    if (approvedById) {
      // User is not tenant-auto-scoped — justified lookup constrained to own clinic.
      const approver = await this.prisma.unscoped.user.findFirst({
        where: { id: approvedById, clinicId: TenantContext.requireClinicId() },
        select: { id: true, fullName: true },
      });
      if (approver) approvedBy = { id: approver.id, fullName: approver.fullName };
    }

    return {
      clinic: {
        name: clinic?.name ?? '',
        legalName: clinic?.legalName ?? null,
        logoUrl: clinic?.logoUrl ?? null,
        address: clinic?.address ?? null,
        phone: clinic?.phone ?? null,
      },
      order: this.toOrderDetail(order),
      approvedBy,
    };
  }
}
