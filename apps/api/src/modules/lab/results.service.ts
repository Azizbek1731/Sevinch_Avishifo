import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  ErrorCode,
  LabOrderStatus,
  LabValueType,
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
import { FINAL_LAB_STATUSES, isLabResultComplete, lockLabOrder } from './lab-workflow';

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lab: LabService,
  ) {}

  async enterResults(
    itemId: string,
    dto: EnterLabResultsDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const initial = await this.prisma.db.labOrderItem.findUnique({
      where: { id: itemId },
      select: { orderId: true },
    });
    if (!initial)
      throw new AppException(ErrorCode.LAB_ORDER_NOT_FOUND, 'Lab order item not found', 404);
    const clinicId = TenantContext.requireClinicId();
    const saved = await this.prisma.db.$transaction(async (tx) => {
      const order = await lockLabOrder(tx, initial.orderId);
      if (FINAL_LAB_STATUSES.includes(order.status) || order.status === LabOrderStatus.ORDERED) {
        throw new AppException(
          ErrorCode.LAB_INVALID_TRANSITION,
          'Collect the specimen before entering results; signed results are locked',
          409,
        );
      }
      const item = await tx.labOrderItem.findUnique({
        where: { id: itemId },
        include: {
          labTest: { include: { parameters: true } },
          result: { include: { values: true } },
        },
      });
      if (!item)
        throw new AppException(ErrorCode.LAB_ORDER_NOT_FOUND, 'Lab order item not found', 404);
      const patient = await tx.patient.findUnique({ where: { id: order.patientId } });
      if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
      const parameterById = new Map(
        item.labTest.parameters.map((parameter) => [parameter.id, parameter]),
      );
      for (const value of dto.values) {
        if (!parameterById.has(value.parameterId)) {
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'Parameter does not belong to this lab test',
            400,
          );
        }
      }
      if (dto.reportDocumentId) {
        const document = await tx.patientDocument.findFirst({
          where: { id: dto.reportDocumentId, labOrderId: order.id, patientId: order.patientId },
        });
        if (!document)
          throw new AppException(
            ErrorCode.NOT_FOUND,
            'Report file does not belong to this laboratory order',
            404,
          );
      }
      const ctx: PatientContext = {
        gender: patient.gender,
        ageDays: ageInDays(patient.dob, order.collectedAt ?? order.createdAt),
        state: order.physiologicalState,
      };
      const result = await tx.labResult.upsert({
        where: { orderItemId: itemId },
        create: {
          clinicId,
          orderItemId: itemId,
          enteredById: user.id,
          note: dto.note,
          reportDocumentId: dto.reportDocumentId ?? null,
        },
        update: {
          enteredById: user.id,
          reportDocumentId: dto.reportDocumentId ?? null,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
      if (dto.reportDocumentId) {
        // A file report is an explicit replacement of the editable parameter form.
        await tx.labResultValue.deleteMany({ where: { resultId: result.id } });
      } else {
        for (const value of dto.values) {
          const parameter = parameterById.get(value.parameterId)!;
          const { flag } = flagValue(
            value.value,
            parseReferenceRanges(parameter.referenceRanges),
            ctx,
            (parameter.valueType as LabValueType | null) ?? LabValueType.NUMERIC,
          );
          await tx.labResultValue.upsert({
            where: {
              resultId_parameterId: { resultId: result.id, parameterId: value.parameterId },
            },
            create: {
              clinicId,
              resultId: result.id,
              parameterId: value.parameterId,
              value: value.value,
              flag,
            },
            update: { value: value.value, flag },
          });
        }
      }
      const items = await tx.labOrderItem.findMany({
        where: { orderId: order.id },
        include: {
          labTest: { include: { parameters: true } },
          result: { include: { values: true } },
        },
      });
      const complete = items.length > 0 && items.every(isLabResultComplete);
      await tx.labOrder.update({
        where: { id: order.id },
        data: { status: complete ? LabOrderStatus.RESULTED : LabOrderStatus.IN_PROGRESS },
      });
      return { resultId: result.id, orderId: order.id, complete };
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'LabResult',
      entityId: saved.resultId,
      after: {
        orderId: saved.orderId,
        orderItemId: itemId,
        enteredById: user.id,
        parameterIds: dto.values.map((value) => value.parameterId),
        reportDocumentId: dto.reportDocumentId ?? null,
        resulted: saved.complete,
      },
    });
    await this.lab.emitOrderUpdated(saved.orderId);
    return this.lab.getOrder(saved.orderId);
  }
}
