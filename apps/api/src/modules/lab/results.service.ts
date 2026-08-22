import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  CRITICAL_FLAGS,
  ErrorCode,
  LabOrderStatus,
  LabValueType,
  ResultFlag,
  ageInDays,
  flagValue,
  type AuthUser,
  type PatientContext,
} from '@avishifo/shared';
import { parseReferenceRanges } from './reference-ranges';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { LabService } from './lab.service';
import { EnterLabResultsDto } from './dto';

/** Result entry is blocked once the order left the active pipeline. */
const RESULTS_LOCKED: readonly LabOrderStatus[] = [
  LabOrderStatus.APPROVED,
  LabOrderStatus.DELIVERED,
  LabOrderStatus.CANCELLED,
];

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

    const ctx: PatientContext = {
      gender: order.patient.gender,
      // Age at COLLECTION, not at data entry: a newborn's interval moves within days, so
      // typing yesterday's specimen in this morning must not shift the band.
      ageDays: ageInDays(order.patient.dob, order.collectedAt ?? order.createdAt),
      state: order.physiologicalState,
    };
    const clinicId = TenantContext.requireClinicId();
    const critical: Array<{ name: string; value: string; flag: ResultFlag }> = [];

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
        const { flag } = flagValue(
          v.value,
          parseReferenceRanges(parameter.referenceRanges),
          ctx,
          (parameter.valueType as LabValueType | null) ?? LabValueType.NUMERIC,
        );
        if (CRITICAL_FLAGS.includes(flag)) {
          critical.push({ name: parameter.name, value: v.value, flag });
        }
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
        // Panic values are recorded in the audit trail as well as shown on screen, so
        // "nobody told me" can be answered from the record.
        criticalValues: critical.length > 0 ? critical : undefined,
      },
    });
    await this.lab.emitOrderUpdated(order.id);

    return this.lab.getOrder(order.id);
  }
}
