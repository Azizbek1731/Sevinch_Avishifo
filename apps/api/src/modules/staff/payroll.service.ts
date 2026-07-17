import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  CompensationType,
  InvoiceStatus,
  Prisma,
  UserRole,
  type CompensationRule,
  type PayrollAccrual,
} from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type AuthUser,
  type CompensationRuleUpsertInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { StaffService } from './staff.service';
import {
  calcAccrual,
  periodRange,
  type AccrualLine,
  type AccrualRule,
} from './payroll.calc';
import type {
  AccrualAdjustInput,
  CompensationRuleListQuery,
  CompensationRulePatch,
  PayrollAccrualsQuery,
} from './dto';

// ---------------------------------------------------------------- responses

export interface CompensationRuleResponse {
  id: string;
  doctorUserId: string;
  doctorName: string;
  type: string;
  value: string;
  serviceId: string | null;
  serviceCategoryId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface PayrollAccrualResponse {
  id: string;
  doctorUserId: string;
  doctorName: string;
  period: string;
  baseAmount: string;
  bonusAmount: string;
  adjustment: string;
  total: string;
  breakdown: unknown;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateAccrualsSummary {
  period: string;
  doctorsProcessed: number;
  totalAccrued: string;
  accruals: PayrollAccrualResponse[];
}

type RuleWithDoctor = CompensationRule & { doctor: { fullName: string } };
type AccrualWithDoctor = PayrollAccrual & { doctor: { fullName: string } };

function mapRule(rule: RuleWithDoctor): CompensationRuleResponse {
  return {
    id: rule.id,
    doctorUserId: rule.doctorUserId,
    doctorName: rule.doctor.fullName,
    type: rule.type,
    value: rule.value.toFixed(2),
    serviceId: rule.serviceId,
    serviceCategoryId: rule.serviceCategoryId,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
    createdAt: rule.createdAt.toISOString(),
  };
}

function mapAccrual(a: AccrualWithDoctor): PayrollAccrualResponse {
  return {
    id: a.id,
    doctorUserId: a.doctorUserId,
    doctorName: a.doctor.fullName,
    period: a.period,
    baseAmount: a.baseAmount.toFixed(2),
    bonusAmount: a.bonusAmount.toFixed(2),
    adjustment: a.adjustment.toFixed(2),
    total: a.total.toFixed(2),
    breakdown: a.breakdown,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly staff: StaffService,
  ) {}

  // ------------------------------------------------------- compensation rules

  async listRules(
    query: CompensationRuleListQuery,
  ): Promise<PaginatedResult<CompensationRuleResponse>> {
    const { skip, take } = skipTake(query);
    const where: Prisma.CompensationRuleWhereInput = query.doctorUserId
      ? { doctorUserId: query.doctorUserId }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.db.compensationRule.findMany({
        where,
        include: { doctor: { select: { fullName: true } } },
        orderBy: [{ doctorUserId: 'asc' }, { effectiveFrom: 'desc' }],
        skip,
        take,
      }),
      this.prisma.db.compensationRule.count({ where }),
    ]);
    return paginated(items.map(mapRule), { page: query.page, limit: query.limit, total });
  }

  async createRule(input: CompensationRuleUpsertInput): Promise<CompensationRuleResponse> {
    await this.staff.requireStaffUser(input.doctorUserId);
    this.validateRuleValue(input.type, input.value);

    if (input.serviceId) {
      const service = await this.prisma.db.service.findFirst({ where: { id: input.serviceId } });
      if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    }
    if (input.serviceCategoryId) {
      const category = await this.prisma.db.serviceCategory.findFirst({
        where: { id: input.serviceCategoryId },
      });
      if (!category) throw new AppException(ErrorCode.NOT_FOUND, 'Service category not found', 404);
    }

    const effectiveFrom = new Date(input.effectiveFrom);

    // Effective-dating: close the currently open rule of the same type+scope.
    await this.prisma.db.compensationRule.updateMany({
      where: {
        doctorUserId: input.doctorUserId,
        type: input.type,
        serviceId: input.serviceId ?? null,
        serviceCategoryId: input.serviceCategoryId ?? null,
        effectiveTo: null,
        effectiveFrom: { lt: effectiveFrom },
      },
      data: { effectiveTo: effectiveFrom },
    });

    const rule = await this.prisma.db.compensationRule.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        doctorUserId: input.doctorUserId,
        type: input.type,
        value: new Prisma.Decimal(input.value),
        serviceId: input.serviceId ?? null,
        serviceCategoryId: input.serviceCategoryId ?? null,
        effectiveFrom,
      },
      include: { doctor: { select: { fullName: true } } },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'CompensationRule',
      entityId: rule.id,
      after: mapRule(rule),
    });

    return mapRule(rule);
  }

  async updateRule(id: string, input: CompensationRulePatch): Promise<CompensationRuleResponse> {
    const before = await this.prisma.db.compensationRule.findFirst({
      where: { id },
      include: { doctor: { select: { fullName: true } } },
    });
    if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Compensation rule not found', 404);

    const type = input.type ?? before.type;
    if (input.value !== undefined || input.type !== undefined) {
      this.validateRuleValue(type, input.value ?? before.value.toFixed(2));
    }

    const data: Prisma.CompensationRuleUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.value !== undefined) data.value = new Prisma.Decimal(input.value);
    if (input.serviceId !== undefined) {
      data.service = input.serviceId ? { connect: { id: input.serviceId } } : { disconnect: true };
    }
    if (input.serviceCategoryId !== undefined) data.serviceCategoryId = input.serviceCategoryId;
    if (input.effectiveFrom !== undefined) data.effectiveFrom = new Date(input.effectiveFrom);
    if (input.effectiveTo !== undefined) {
      data.effectiveTo = input.effectiveTo === null ? null : new Date(input.effectiveTo);
    }

    const updated = await this.prisma.db.compensationRule.update({
      where: { id },
      data,
      include: { doctor: { select: { fullName: true } } },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'CompensationRule',
      entityId: id,
      before: mapRule(before),
      after: mapRule(updated),
    });

    return mapRule(updated);
  }

  async deleteRule(id: string): Promise<{ id: string }> {
    const rule = await this.prisma.db.compensationRule.findFirst({
      where: { id },
      include: { doctor: { select: { fullName: true } } },
    });
    if (!rule) throw new AppException(ErrorCode.NOT_FOUND, 'Compensation rule not found', 404);

    await this.prisma.db.compensationRule.delete({ where: { id } });
    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'CompensationRule',
      entityId: id,
      before: mapRule(rule),
    });

    return { id };
  }

  // ------------------------------------------------------------- accruals

  /** Recomputes and upserts PayrollAccrual rows for every doctor with active rules. */
  async generateAccruals(period: string): Promise<GenerateAccrualsSummary> {
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = periodRange(period);

    const rules = await this.prisma.db.compensationRule.findMany({
      where: {
        effectiveFrom: { lt: end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
      },
    });
    const doctorIds = [...new Set(rules.map((r) => r.doctorUserId))];
    if (doctorIds.length === 0) {
      return { period, doctorsProcessed: 0, totalAccrued: '0.00', accruals: [] };
    }

    // Revenue basis: lines performed by the doctor on PAID / PARTIALLY_PAID
    // invoices issued inside the period.
    const lines = await this.prisma.db.invoiceLine.findMany({
      where: {
        performerUserId: { in: doctorIds },
        invoice: {
          status: { in: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID] },
          issuedAt: { gte: start, lt: end },
        },
      },
      select: {
        performerUserId: true,
        serviceId: true,
        quantity: true,
        lineTotal: true,
        service: { select: { categoryId: true } },
      },
    });

    const linesByDoctor = new Map<string, AccrualLine[]>();
    for (const line of lines) {
      if (!line.performerUserId) continue;
      const list = linesByDoctor.get(line.performerUserId) ?? [];
      list.push({
        serviceId: line.serviceId,
        serviceCategoryId: line.service?.categoryId ?? null,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      });
      linesByDoctor.set(line.performerUserId, list);
    }

    const accruals: PayrollAccrualResponse[] = [];
    let totalAccrued = new Prisma.Decimal(0);

    for (const doctorUserId of doctorIds) {
      const doctorRules: AccrualRule[] = rules
        .filter((r) => r.doctorUserId === doctorUserId)
        .map((r) => ({
          type: r.type,
          value: r.value,
          serviceId: r.serviceId,
          serviceCategoryId: r.serviceCategoryId,
        }));
      const { base, bonus, breakdown } = calcAccrual(
        doctorRules,
        linesByDoctor.get(doctorUserId) ?? [],
      );

      // Preserve a manual adjustment already applied to this period.
      const existing = await this.prisma.db.payrollAccrual.findFirst({
        where: { doctorUserId, period },
      });
      const adjustment = existing?.adjustment ?? new Prisma.Decimal(0);
      const total = base.add(bonus).add(adjustment);

      const accrual = await this.prisma.db.payrollAccrual.upsert({
        where: { clinicId_doctorUserId_period: { clinicId, doctorUserId, period } },
        create: {
          clinicId,
          doctorUserId,
          period,
          baseAmount: base,
          bonusAmount: bonus,
          adjustment,
          total,
          breakdown: breakdown as unknown as Prisma.InputJsonValue,
        },
        update: {
          baseAmount: base,
          bonusAmount: bonus,
          total,
          breakdown: breakdown as unknown as Prisma.InputJsonValue,
        },
        include: { doctor: { select: { fullName: true } } },
      });

      totalAccrued = totalAccrued.add(total);
      accruals.push(mapAccrual(accrual));
    }

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'PayrollAccrual',
      entityId: period,
      after: { period, doctorsProcessed: doctorIds.length, totalAccrued: totalAccrued.toFixed(2) },
    });

    return {
      period,
      doctorsProcessed: doctorIds.length,
      totalAccrued: totalAccrued.toFixed(2),
      accruals,
    };
  }

  async listAccruals(
    query: PayrollAccrualsQuery,
    actor: AuthUser,
  ): Promise<PaginatedResult<PayrollAccrualResponse>> {
    const items = await this.fetchAccruals(query, actor);
    return paginated(items.map(mapAccrual), {
      page: 1,
      limit: Math.max(items.length, 1),
      total: items.length,
    });
  }

  async adjustAccrual(id: string, input: AccrualAdjustInput): Promise<PayrollAccrualResponse> {
    const before = await this.prisma.db.payrollAccrual.findFirst({
      where: { id },
      include: { doctor: { select: { fullName: true } } },
    });
    if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Payroll accrual not found', 404);

    const adjustment = new Prisma.Decimal(input.adjustment);
    const total = before.baseAmount.add(before.bonusAmount).add(adjustment);

    const updated = await this.prisma.db.payrollAccrual.update({
      where: { id },
      data: { adjustment, total, ...(input.note !== undefined ? { note: input.note } : {}) },
      include: { doctor: { select: { fullName: true } } },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'PayrollAccrual',
      entityId: id,
      before: { adjustment: before.adjustment.toFixed(2), total: before.total.toFixed(2), note: before.note },
      after: { adjustment: updated.adjustment.toFixed(2), total: updated.total.toFixed(2), note: updated.note },
    });

    return mapAccrual(updated);
  }

  // ------------------------------------------------------------- xlsx export

  async exportAccrualsXlsx(query: PayrollAccrualsQuery, actor: AuthUser): Promise<Buffer> {
    const items = await this.fetchAccruals(query, actor);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Payroll ${query.period}`);
    sheet.columns = [
      { header: 'Doctor', key: 'doctor', width: 32 },
      { header: 'Period', key: 'period', width: 10 },
      { header: 'Base', key: 'base', width: 16 },
      { header: 'Bonus', key: 'bonus', width: 16 },
      { header: 'Adjustment', key: 'adjustment', width: 16 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Note', key: 'note', width: 32 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const a of items) {
      sheet.addRow({
        doctor: a.doctor.fullName,
        period: a.period,
        base: Number(a.baseAmount.toFixed(2)),
        bonus: Number(a.bonusAmount.toFixed(2)),
        adjustment: Number(a.adjustment.toFixed(2)),
        total: Number(a.total.toFixed(2)),
        note: a.note ?? '',
      });
    }
    for (const key of ['base', 'bonus', 'adjustment', 'total']) {
      sheet.getColumn(key).numFmt = '#,##0.00';
    }

    await this.audit.log({
      action: AuditAction.EXPORT,
      entity: 'PayrollAccrual',
      entityId: query.period,
      after: { period: query.period, rows: items.length },
    });

    const raw: unknown = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
  }

  // ------------------------------------------------------------- helpers

  private async fetchAccruals(
    query: PayrollAccrualsQuery,
    actor: AuthUser,
  ): Promise<AccrualWithDoctor[]> {
    let doctorUserId = query.doctorUserId;
    // Doctors may only see their own accruals (object-level check on payroll.read).
    if (actor.role === UserRole.DOCTOR) {
      if (doctorUserId && doctorUserId !== actor.id) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Doctors may only view their own accruals', 403);
      }
      doctorUserId = actor.id;
    }
    return this.prisma.db.payrollAccrual.findMany({
      where: { period: query.period, ...(doctorUserId ? { doctorUserId } : {}) },
      include: { doctor: { select: { fullName: true } } },
      orderBy: { doctorUserId: 'asc' },
    });
  }

  private validateRuleValue(type: CompensationType, value: string): void {
    const v = new Prisma.Decimal(value);
    if (type === CompensationType.REVENUE_PERCENT && v.greaterThan(100)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'REVENUE_PERCENT value must be between 0 and 100',
        400,
      );
    }
  }
}
