import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  UserRole,
  type AuthUser,
  type ClinicalOrderKind,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { PricingService } from '../services/pricing.service';
import { AddClinicalServicesDto, ClinicalOrderQueryDto, CreateClinicalOrderDto } from './dto';

const INCLUDE = {
  patient: { select: { id: true, mrn: true, fullName: true, phone: true } },
  doctor: { select: { id: true, fullName: true } },
  initialInvoice: { include: { lines: true, refunds: true } },
  invoices: { include: { lines: true, refunds: true }, orderBy: { createdAt: 'asc' as const } },
  visit: { select: { status: true } },
} satisfies Prisma.ClinicalOrderInclude;
type Order = Prisma.ClinicalOrderGetPayload<{ include: typeof INCLUDE }>;
type Bill = Order['initialInvoice'];
type ServicePlan = { serviceId: string; title: Prisma.InputJsonValue; unitPrice: Prisma.Decimal };
const zero = () => new Prisma.Decimal(0);
const netPaid = (invoice: Pick<Bill, 'paidTotal' | 'refunds'>) =>
  invoice.paidTotal.sub(invoice.refunds.reduce((sum, refund) => sum.add(refund.amount), zero()));
const paid = (
  invoice: Pick<Bill, 'status' | 'paidTotal' | 'total'> & {
    refunds?: { amount: Prisma.Decimal }[];
  },
) =>
  invoice.status === 'PAID' &&
  invoice.paidTotal
    .sub((invoice.refunds ?? []).reduce((sum, refund) => sum.add(refund.amount), zero()))
    .gte(invoice.total);
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const managers: string[] = [UserRole.CLINIC_OWNER, UserRole.CLINIC_ADMIN];

@Injectable()
export class ClinicalOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  private assertRole(user: AuthUser, perform = false) {
    const roles: string[] = perform
      ? [...managers, UserRole.DOCTOR]
      : [...managers, UserRole.DOCTOR, UserRole.RECEPTIONIST];
    if (!roles.includes(user.role))
      throw new AppException(ErrorCode.FORBIDDEN, 'Clinical access required', 403);
  }

  private scope(user: AuthUser, branchId: string): Prisma.ClinicalOrderWhereInput {
    this.assertRole(user);
    if (user.branchIds.length && !user.branchIds.includes(branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'Branch access required', 403);
    return { branchId, ...(user.role === UserRole.DOCTOR ? { doctorUserId: user.id } : {}) };
  }

  private bill(invoice: Bill) {
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      total: invoice.total.toFixed(2),
      paidTotal: netPaid(invoice).toFixed(2),
      due: Prisma.Decimal.max(0, invoice.total.sub(netPaid(invoice))).toFixed(2),
    };
  }

  async doctors(user: AuthUser, branchId: string) {
    this.scope(user, branchId);
    // User is outside automatic tenant scoping. Return only booking information,
    // with the same clinic, status and branch criteria as order creation.
    const doctors = await this.prisma.unscoped.user.findMany({
      where: {
        clinicId: TenantContext.requireClinicId(),
        role: 'DOCTOR',
        status: 'ACTIVE',
        deletedAt: null,
        branches: { some: { branchId } },
      },
      select: { id: true, fullName: true, staffProfile: { select: { specialty: true } } },
      orderBy: { fullName: 'asc' },
    });
    return doctors.map((doctor) => ({
      id: doctor.id,
      fullName: doctor.fullName,
      specialty: doctor.staffProfile?.specialty ?? null,
    }));
  }

  private map(order: Order) {
    let status: 'WAITING_PAYMENT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' =
      'WAITING_PAYMENT';
    if (order.visit?.status === 'COMPLETED') status = 'COMPLETED';
    else if (
      order.visit?.status === 'CANCELLED' ||
      ['CANCELLED', 'REFUNDED'].includes(order.initialInvoice.status) ||
      order.invoices.some((invoice) => invoice.refunds.length > 0)
    )
      status = 'CANCELLED';
    else if (order.visitId) status = 'IN_PROGRESS';
    else if (paid(order.initialInvoice)) status = 'READY';
    const additionalDue = order.invoices
      .filter((i) => i.id !== order.initialInvoiceId && i.status !== 'CANCELLED')
      .reduce((sum, i) => sum.add(Prisma.Decimal.max(0, i.total.sub(netPaid(i)))), zero());
    return {
      id: order.id,
      kind: order.kind,
      patient: order.patient,
      doctor: order.doctor,
      status,
      visitId: order.visitId,
      invoice: this.bill(order.initialInvoice),
      additionalDue: additionalDue.toFixed(2),
      invoices: order.invoices.map((invoice) => this.bill(invoice)),
      services: order.invoices
        .filter((invoice) => invoice.status !== 'CANCELLED')
        .flatMap((i) =>
          i.lines.map((line) => ({
            id: line.serviceId ?? line.id,
            title: line.title,
            quantity: line.quantity,
          })),
        ),
      note: order.note,
      createdAt: order.createdAt.toISOString(),
    };
  }

  async list(query: ClinicalOrderQueryDto, user: AuthUser, branchId: string) {
    const where: Prisma.ClinicalOrderWhereInput = {
      ...this.scope(user, branchId),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.visitId ? { visitId: query.visitId } : {}),
      ...(query.mine ? { doctorUserId: user.id } : {}),
    };
    if (query.search)
      where.OR = [
        { patient: { phone: { contains: query.search } } },
        { patient: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { patient: { mrn: { contains: query.search, mode: 'insensitive' } } },
        { initialInvoice: { number: { contains: query.search, mode: 'insensitive' } } },
      ];
    if (query.status === 'READY')
      Object.assign(where, {
        visitId: null,
        initialInvoice: { status: 'PAID', refunds: { none: {} } },
      });
    if (query.status === 'WAITING_PAYMENT')
      Object.assign(where, {
        visitId: null,
        initialInvoice: {
          status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'] },
          refunds: { none: {} },
        },
      });
    if (query.status === 'IN_PROGRESS')
      Object.assign(where, {
        visit: { status: 'IN_PROGRESS' },
        initialInvoice: { status: { notIn: ['CANCELLED', 'REFUNDED'] } },
        invoices: { none: { refunds: { some: {} } } },
      });
    if (query.status === 'COMPLETED') where.visit = { status: 'COMPLETED' };
    if (query.status === 'CANCELLED')
      where.AND = [
        {
          OR: [
            { initialInvoice: { status: { in: ['CANCELLED', 'REFUNDED'] } } },
            { invoices: { some: { refunds: { some: {} } } } },
            { visit: { status: 'CANCELLED' } },
          ],
        },
        { OR: [{ visit: null }, { visit: { status: { not: 'COMPLETED' } } }] },
      ];
    const [rows, total] = await Promise.all([
      this.prisma.db.clinicalOrder.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.clinicalOrder.count({ where }),
    ]);
    return paginated(
      rows.map((o) => this.map(o)),
      { page: query.page, limit: query.limit, total },
    );
  }

  private async require(id: string, user: AuthUser, branchId: string) {
    const order = await this.prisma.db.clinicalOrder.findFirst({
      where: { id, ...this.scope(user, branchId) },
      include: INCLUDE,
    });
    if (!order) throw new AppException(ErrorCode.NOT_FOUND, 'Clinical order not found', 404);
    return order;
  }
  async get(id: string, user: AuthUser, branchId: string) {
    return this.map(await this.require(id, user, branchId));
  }

  private async plans(
    ids: string[],
    kind: ClinicalOrderKind,
    branchId: string,
  ): Promise<ServicePlan[]> {
    const services = await this.prisma.db.service.findMany({
      where: { id: { in: ids }, isActive: true, category: { kind } },
    });
    if (services.length !== ids.length)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Service type or active service does not match the request',
        400,
      );
    const prices = await this.pricing.getCurrentPrices(ids, branchId);
    return services.map((service) => {
      const price = prices.get(service.id);
      if (price === undefined)
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Service price is missing', 400);
      return {
        serviceId: service.id,
        title: service.name as Prisma.InputJsonValue,
        unitPrice: new Prisma.Decimal(price),
      };
    });
  }

  private async number() {
    // Clinic itself is not auto-scoped; settings lookup is explicitly limited to own clinic.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { settings: true },
    });
    const settings = clinic?.settings as Record<string, unknown> | null;
    const format =
      typeof settings?.invoiceNumberFormat === 'string'
        ? settings.invoiceNumberFormat
        : 'INV-{YYYY}-{NNNNNN}';
    const seq = await this.sequence.next('invoice');
    return format
      .replace('{YYYY}', String(new Date().getUTCFullYear()))
      .replace(/\{(N+)\}/, (_m, ns: string) => String(seq).padStart(ns.length, '0'));
  }

  private async invoice(
    tx: TenantTransactionClient,
    plans: ServicePlan[],
    context: {
      patientId: string;
      branchId: string;
      doctorUserId: string;
      requestKey: string;
      requestFingerprint: string;
      number: string;
      userId: string;
      clinicalOrderId?: string;
      visitId?: string | null;
    },
  ) {
    const clinicId = TenantContext.requireClinicId();
    const total = plans.reduce((sum, plan) => sum.add(plan.unitPrice), zero());
    return tx.invoice.create({
      data: {
        clinicId,
        patientId: context.patientId,
        branchId: context.branchId,
        number: context.number,
        requestKey: context.requestKey,
        requestFingerprint: context.requestFingerprint,
        status: total.eq(0) ? 'PAID' : 'ISSUED',
        issuedAt: new Date(),
        subtotal: total,
        total,
        paidTotal: zero(),
        discountTotal: zero(),
        createdById: context.userId,
        clinicalOrderId: context.clinicalOrderId,
        visitId: context.visitId,
        lines: {
          create: plans.map((plan) => ({
            clinicId,
            ...plan,
            quantity: 1,
            discount: zero(),
            lineTotal: plan.unitPrice,
            performerUserId: context.doctorUserId,
          })),
        },
      },
    });
  }

  async create(dto: CreateClinicalOrderDto, user: AuthUser, branchId: string) {
    this.scope(user, branchId);
    if (dto.branchId !== branchId)
      throw new AppException(ErrorCode.FORBIDDEN, 'Active branch does not match', 403);
    const patient = await this.prisma.db.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
    // User is a platform-scoped model; require own clinic, active doctor and exact branch membership.
    const doctor = await this.prisma.unscoped.user.findFirst({
      where: {
        id: dto.doctorUserId,
        clinicId: TenantContext.requireClinicId(),
        role: 'DOCTOR',
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    const membership = await this.prisma.db.userBranch.findFirst({
      where: { userId: dto.doctorUserId, branchId },
    });
    if (!doctor || !membership)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'An active doctor in this branch is required',
        400,
      );
    const plans = await this.plans(dto.serviceIds, dto.kind, branchId);
    const number = await this.number();
    const hash = fingerprint({
      patientId: dto.patientId,
      branchId,
      doctorUserId: dto.doctorUserId,
      kind: dto.kind,
      serviceIds: [...dto.serviceIds].sort(),
      note: dto.note ?? '',
    });
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':clinical:' + dto.idempotencyKey}, 0))`;
      const old = await tx.clinicalOrder.findFirst({ where: { requestKey: dto.idempotencyKey } });
      if (old) {
        if (old.requestFingerprint !== hash)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Request key belongs to another order',
            409,
          );
        return { id: old.id, created: false };
      }
      const invoice = await this.invoice(tx, plans, {
        ...dto,
        number,
        requestKey: dto.idempotencyKey,
        requestFingerprint: hash,
        userId: user.id,
      });
      const order = await tx.clinicalOrder.create({
        data: {
          clinicId,
          patientId: dto.patientId,
          branchId,
          doctorUserId: dto.doctorUserId,
          kind: dto.kind,
          initialInvoiceId: invoice.id,
          note: dto.note,
          requestKey: dto.idempotencyKey,
          requestFingerprint: hash,
        },
      });
      await tx.invoice.update({ where: { id: invoice.id }, data: { clinicalOrderId: order.id } });
      return { id: order.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'ClinicalOrder',
        entityId: result.id,
        after: { patientId: dto.patientId, kind: dto.kind, doctorUserId: dto.doctorUserId },
      });
    return this.get(result.id, user, branchId);
  }

  async start(id: string, user: AuthUser, branchId: string) {
    this.assertRole(user, true);
    await this.require(id, user, branchId);
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClinicalOrder" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const order = await tx.clinicalOrder.findFirstOrThrow({ where: { id } });
      if (order.visitId) return { visitId: order.visitId, created: false };
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${order.initialInvoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirstOrThrow({
        where: { id: order.initialInvoiceId },
        include: { refunds: true },
      });
      if (!paid(invoice))
        throw new AppException(
          ErrorCode.INVOICE_INVALID_STATE,
          'Full payment is required before care starts',
          409,
        );
      const visit = await tx.visit.create({
        data: {
          clinicId,
          patientId: order.patientId,
          branchId,
          doctorUserId: order.doctorUserId,
          kind: order.kind,
          subjective: order.note,
        },
      });
      await tx.clinicalOrder.update({ where: { id }, data: { visitId: visit.id } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { visitId: visit.id } });
      await tx.patient.update({
        where: { id: order.patientId },
        data: { visitCount: { increment: 1 } },
      });
      return { visitId: visit.id, created: true };
    });
    if (result.created)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'Visit',
        entityId: result.visitId,
        after: { clinicalOrderId: id },
      });
    return { visitId: result.visitId };
  }

  async addServices(id: string, dto: AddClinicalServicesDto, user: AuthUser, branchId: string) {
    this.assertRole(user, true);
    const order = await this.require(id, user, branchId);
    if (order.kind !== 'ULTRASOUND')
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Additional examinations are available for ultrasound only',
        403,
      );
    const plans = await this.plans(dto.serviceIds, 'ULTRASOUND', branchId);
    const number = await this.number();
    const hash = fingerprint({ clinicalOrderId: id, serviceIds: [...dto.serviceIds].sort() });
    const clinicId = TenantContext.requireClinicId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClinicalOrder" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const old = await tx.invoice.findFirst({ where: { requestKey: dto.idempotencyKey } });
      if (old) {
        if (old.clinicalOrderId !== id || old.requestFingerprint !== hash)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Request key belongs to another invoice',
            409,
          );
        return { invoice: old, created: false };
      }
      const fresh = await tx.clinicalOrder.findFirstOrThrow({
        where: { id },
        include: { visit: true },
      });
      if (!fresh.visit || fresh.visit.status !== 'IN_PROGRESS')
        throw new AppException(
          ErrorCode.INVALID_STATUS_TRANSITION,
          'Start the examination before adding services; finalized reports are read-only',
          409,
        );

      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "clinicalOrderId" = ${id} AND "clinicId" = ${clinicId} ORDER BY "id" FOR UPDATE`;
      const cancelled = await tx.invoice.count({
        where: {
          clinicalOrderId: id,
          OR: [
            { id: fresh.initialInvoiceId, status: { in: ['CANCELLED', 'REFUNDED'] } },
            { refunds: { some: {} } },
          ],
        },
      });
      if (cancelled)
        throw new AppException(
          ErrorCode.INVALID_STATUS_TRANSITION,
          'Cancelled examinations cannot receive more services',
          409,
        );
      const existing = await tx.invoiceLine.count({
        where: {
          invoice: { clinicalOrderId: id, status: { not: 'CANCELLED' } },
          serviceId: { in: dto.serviceIds },
        },
      });
      if (existing)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'An examination is already present on this order',
          409,
        );
      const invoice = await this.invoice(tx, plans, {
        patientId: order.patientId,
        branchId,
        doctorUserId: order.doctorUserId,
        clinicalOrderId: id,
        visitId: fresh.visitId,
        userId: user.id,
        number,
        requestKey: dto.idempotencyKey,
        requestFingerprint: hash,
      });
      return { invoice, created: true };
    });
    if (result.created)
      await this.audit.log({
        action: AuditAction.CREATE,
        entity: 'Invoice',
        entityId: result.invoice.id,
        after: { clinicalOrderId: id, total: result.invoice.total.toFixed(2) },
      });
    return {
      invoiceId: result.invoice.id,
      number: result.invoice.number,
      total: result.invoice.total.toFixed(2),
    };
  }
}
