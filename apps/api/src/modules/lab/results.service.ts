import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  Gender,
  LabOrderStatus,
  ResultFlag,
  type AuthUser,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { LabService } from './lab.service';
import { EnterLabResultsDto } from './dto';

/** Parsed LabTestParameter.referenceRanges row. */
interface ReferenceRange {
  gender?: Gender;
  ageMinY?: number;
  ageMaxY?: number;
  low: number;
  high: number;
}

/** Result entry is blocked once the order left the active pipeline. */
const RESULTS_LOCKED: readonly LabOrderStatus[] = [
  LabOrderStatus.APPROVED,
  LabOrderStatus.DELIVERED,
  LabOrderStatus.CANCELLED,
];

function ageYears(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

function parseRanges(raw: Prisma.JsonValue): ReferenceRange[] {
  if (!Array.isArray(raw)) return [];
  const out: ReferenceRange[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    if (typeof o['low'] !== 'number' || typeof o['high'] !== 'number') continue;
    const gender =
      o['gender'] === Gender.MALE || o['gender'] === Gender.FEMALE
        ? (o['gender'] as Gender)
        : undefined;
    out.push({
      gender,
      ageMinY: typeof o['ageMinY'] === 'number' ? o['ageMinY'] : undefined,
      ageMaxY: typeof o['ageMaxY'] === 'number' ? o['ageMaxY'] : undefined,
      low: o['low'],
      high: o['high'],
    });
  }
  return out;
}

function matchRange(
  ranges: ReferenceRange[],
  gender: Gender | null,
  age: number | null,
): ReferenceRange | null {
  const candidates = ranges.filter((r) => {
    if (r.gender !== undefined && r.gender !== gender) return false;
    if (r.ageMinY !== undefined && (age === null || age < r.ageMinY)) return false;
    if (r.ageMaxY !== undefined && (age === null || age > r.ageMaxY)) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  // Prefer the most specific match (more defined constraints first).
  const specificity = (r: ReferenceRange): number =>
    (r.gender !== undefined ? 1 : 0) +
    (r.ageMinY !== undefined ? 1 : 0) +
    (r.ageMaxY !== undefined ? 1 : 0);
  return [...candidates].sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}

/** AUTO-FLAG: numeric values compared to the matched reference range; non-numeric → NORMAL. */
function computeFlag(
  referenceRanges: Prisma.JsonValue,
  value: string,
  gender: Gender | null,
  age: number | null,
): ResultFlag {
  const num = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(num) || value.trim() === '') return ResultFlag.NORMAL;
  const range = matchRange(parseRanges(referenceRanges), gender, age);
  if (!range) return ResultFlag.NORMAL;
  if (num < range.low) return ResultFlag.LOW;
  if (num > range.high) return ResultFlag.HIGH;
  return ResultFlag.NORMAL;
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lab: LabService,
  ) {}

  /** Create-or-update the item's LabResult + upsert value rows with auto-flagging. */
  async enterResults(
    itemId: string,
    dto: EnterLabResultsDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const item = await this.prisma.db.labOrderItem.findUnique({
      where: { id: itemId },
      include: {
        order: { include: { patient: true } },
        labTest: { include: { parameters: true } },
        result: true,
      },
    });
    if (!item) {
      throw new AppException(ErrorCode.LAB_ORDER_NOT_FOUND, 'Lab order item not found', 404);
    }
    const order = item.order;
    if (RESULTS_LOCKED.includes(order.status)) {
      throw new AppException(
        ErrorCode.LAB_INVALID_TRANSITION,
        `Results cannot be entered for a ${order.status} order`,
        409,
      );
    }

    const paramById = new Map(item.labTest.parameters.map((p) => [p.id, p]));
    for (const v of dto.values) {
      if (!paramById.has(v.parameterId)) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Parameter does not belong to this lab test',
          400,
        );
      }
    }

    const gender = order.patient.gender;
    const age = ageYears(order.patient.dob);
    const clinicId = TenantContext.requireClinicId();

    const { resultId, resulted } = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.labResult.upsert({
        where: { orderItemId: itemId },
        create: {
          clinicId,
          orderItemId: itemId,
          enteredById: user.id,
          note: dto.note,
        },
        update: {
          enteredById: user.id,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });

      for (const v of dto.values) {
        const parameter = paramById.get(v.parameterId);
        if (!parameter) continue; // validated above
        const flag = computeFlag(parameter.referenceRanges, v.value, gender, age);
        await tx.labResultValue.upsert({
          where: {
            resultId_parameterId: { resultId: result.id, parameterId: v.parameterId },
          },
          create: {
            clinicId,
            resultId: result.id,
            parameterId: v.parameterId,
            value: v.value,
            flag,
          },
          update: { value: v.value, flag },
        });
      }

      // When ALL items of the order have results → order becomes RESULTED.
      const [itemCount, resultCount] = await Promise.all([
        tx.labOrderItem.count({ where: { orderId: order.id } }),
        tx.labResult.count({ where: { orderItem: { orderId: order.id } } }),
      ]);
      const allResulted = itemCount > 0 && itemCount === resultCount;
      if (allResulted && order.status !== LabOrderStatus.RESULTED) {
        await tx.labOrder.update({
          where: { id: order.id },
          data: { status: LabOrderStatus.RESULTED },
        });
      }
      return { resultId: result.id, resulted: allResulted };
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabResult',
      entityId: resultId,
      after: {
        orderId: order.id,
        orderItemId: itemId,
        enteredById: user.id,
        parameterIds: dto.values.map((v) => v.parameterId),
        resulted,
      },
    });
    await this.lab.emitOrderUpdated(order.id);

    return this.lab.getOrder(order.id);
  }
}
