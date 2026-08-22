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
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { EventsService } from '../../core/realtime/events.service';
import { AuditService } from '../../core/audit/audit.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { parseReferenceRanges } from './reference-ranges';
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
    items: {
      include: {
        labTest: { include: { parameters: true } };
        result: { include: { values: true } };
      };
    };
  };
}>;

type LabOrderListRow = Prisma.LabOrderGetPayload<{
  include: { patient: true; _count: { select: { items: true } } };
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
      status: o.status,
      itemCount: o._count.items,
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
      status: o.status,
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
              values: it.result.values.map((v) => ({
                id: v.id,
                parameterId: v.parameterId,
                value: v.value,
                flag: v.flag,
              })),
            }
          : null,
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
        { name: { path: ['uz'], string_contains: query.search } },
        { name: { path: ['ru'], string_contains: query.search } },
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

  /**
   * Shared internal create used by both POST /lab-orders and cross-module referrals.
   */
  private async createOrderInternal(input: {
    patientId: string;
    branchId: string;
    visitId?: string;
    testIds: string[];
    physiologicalState?: PhysiologicalStateValue;
    orderedById?: string | null;
  }): Promise<{ id: string; orderNumber: string }> {
    const patient = await this.prisma.db.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);

    if (input.visitId) {
      const visit = await this.prisma.db.visit.findUnique({
        where: { id: input.visitId },
        select: { id: true },
      });
      if (!visit) throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
    }

    const testIds = [...new Set(input.testIds)];
    const tests = await this.prisma.db.labTest.findMany({
      where: { id: { in: testIds }, isActive: true },
      select: { id: true },
    });
    if (tests.length !== testIds.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'One or more lab tests were not found', 404);
    }

    const clinicId = TenantContext.requireClinicId();
    const orderNumber = await this.sequence.nextFormatted('lab', 'L');
    const order = await this.prisma.db.labOrder.create({
      data: {
        clinicId,
        branchId: input.branchId,
        orderNumber,
        patientId: input.patientId,
        visitId: input.visitId,
        physiologicalState: input.physiologicalState,
        orderedById: input.orderedById ?? undefined,
        items: {
          // Nested creates are not auto-stamped by the tenant extension.
          create: testIds.map((labTestId) => ({ clinicId, labTestId })),
        },
      },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'LabOrder',
      entityId: order.id,
      after: {
        orderNumber,
        patientId: input.patientId,
        branchId: input.branchId,
        visitId: input.visitId ?? null,
        testIds,
        physiologicalState: input.physiologicalState ?? null,
      },
    });
    await this.emitOrderUpdated(order.id);

    return { id: order.id, orderNumber };
  }

  async createOrder(dto: CreateLabOrderDto, orderedById: string): Promise<Record<string, unknown>> {
    const { id } = await this.createOrderInternal({ ...dto, orderedById });
    return this.getOrder(id);
  }

  /** Cross-module contract (visits referrals). Caller must have TenantContext set. */
  async createOrderFromReferral(i: {
    patientId: string;
    branchId: string;
    visitId?: string;
    testIds: string[];
  }): Promise<{ id: string; orderNumber: string }> {
    return this.createOrderInternal(i);
  }

  async listOrders(query: LabOrderQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.LabOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.branchId) where.branchId = query.branchId;
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
        include: { patient: true, _count: { select: { items: true } } },
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

  private async requireOrder(id: string): Promise<LabOrderDetailRow> {
    const order = await this.prisma.db.labOrder.findUnique({
      where: { id },
      include: {
        patient: true,
        items: {
          include: {
            labTest: { include: { parameters: true } },
            result: { include: { values: true } },
          },
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
    const order = await this.requireOrder(id);
    const allowed = MANUAL_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new AppException(
        ErrorCode.LAB_INVALID_TRANSITION,
        `Cannot transition lab order from ${order.status} to ${dto.status}`,
        409,
      );
    }

    await this.prisma.db.labOrder.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === LabOrderStatus.SPECIMEN_COLLECTED ? { collectedAt: new Date() } : {}),
      },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabOrder',
      entityId: id,
      before: { status: order.status },
      after: { status: dto.status },
    });
    await this.emitOrderUpdated(id);

    return this.getOrder(id);
  }

  async approve(id: string, actorUserId: string): Promise<Record<string, unknown>> {
    const order = await this.requireOrder(id);
    if (order.status !== LabOrderStatus.RESULTED) {
      throw new AppException(
        ErrorCode.LAB_INVALID_TRANSITION,
        `Only a RESULTED order can be approved (current: ${order.status})`,
        409,
      );
    }
    if (order.items.some((it) => !it.result)) {
      throw new AppException(
        ErrorCode.LAB_INVALID_TRANSITION,
        'All items must have results before approval',
        409,
      );
    }

    const approvedAt = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.labResult.updateMany({
        where: { orderItem: { orderId: id } },
        data: { approvedById: actorUserId, approvedAt },
      });
      await tx.labOrder.update({
        where: { id },
        data: { status: LabOrderStatus.APPROVED },
      });
    });

    await this.notifications.enqueueEvent({
      event: NotificationEvent.LAB_RESULT_READY,
      clinicId: TenantContext.requireClinicId(),
      patientId: order.patientId,
      vars: {
        patient_name: order.patient.fullName,
        order_number: order.orderNumber,
      },
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

    return this.getOrder(id);
  }

  async deliver(id: string): Promise<Record<string, unknown>> {
    const order = await this.requireOrder(id);
    if (order.status !== LabOrderStatus.APPROVED) {
      throw new AppException(
        ErrorCode.LAB_INVALID_TRANSITION,
        `Only an APPROVED order can be delivered (current: ${order.status})`,
        409,
      );
    }

    await this.prisma.db.labOrder.update({
      where: { id },
      data: { status: LabOrderStatus.DELIVERED, deliveredAt: new Date() },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabOrder',
      entityId: id,
      before: { status: order.status },
      after: { status: LabOrderStatus.DELIVERED },
    });
    await this.emitOrderUpdated(id);

    return this.getOrder(id);
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
  async updateContext(
    id: string,
    dto: UpdateLabOrderContextDto,
  ): Promise<Record<string, unknown>> {
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

    const ctx: PatientContext = {
      gender: order.patient.gender,
      ageDays: ageInDays(order.patient.dob, order.collectedAt ?? order.createdAt),
      state,
    };

    let reflagged = 0;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.labOrder.update({ where: { id }, data: { physiologicalState: state } });
      for (const item of order.items) {
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
