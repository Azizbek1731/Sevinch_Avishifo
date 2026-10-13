import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  addDiagnosisSchema,
  addPrescriptionSchema,
  addReferralSchema,
  amendVisitSchema,
  drugQuerySchema,
  icd10QuerySchema,
  idSchema,
  paginationQuerySchema,
  replacePrescriptionsSchema,
  updateVisitSchema,
  upsertVitalsSchema,
  visitQuerySchema,
  visitTemplateUpsertSchema,
} from '@avishifo/shared';

/**
 * No shared create-visit schema exists (schemas/visit.ts starts at update) —
 * a visit opens from a queue ticket, an appointment or a bare patient.
 * Defined locally; exactly one source id is required.
 */
export const createVisitSchema = z
  .object({
    ticketId: idSchema.optional(),
    appointmentId: idSchema.optional(),
    patientId: idSchema.optional(),
    /** Required when the caller is not a DOCTOR (service-level check). */
    doctorUserId: idSchema.optional(),
  })
  .refine((v) => Boolean(v.ticketId ?? v.appointmentId ?? v.patientId), {
    message: 'One of ticketId, appointmentId or patientId is required',
  });

/** Clinic-added drug directory row (no shared schema for drug creation). */
export const addDrugSchema = z.object({
  name: z.string().min(2),
  form: z.string().optional(),
  strength: z.string().optional(),
});

export class CreateVisitDto extends createZodDto(createVisitSchema) {}
export class UpdateVisitDto extends createZodDto(updateVisitSchema) {}
export class AmendVisitDto extends createZodDto(amendVisitSchema) {}
export class UpsertVitalsDto extends createZodDto(upsertVitalsSchema) {}
export class AddDiagnosisDto extends createZodDto(addDiagnosisSchema) {}
export class AddPrescriptionDto extends createZodDto(addPrescriptionSchema) {}
export class ReplacePrescriptionsDto extends createZodDto(replacePrescriptionsSchema) {}
export class AddReferralDto extends createZodDto(addReferralSchema) {}
export class VisitQueryDto extends createZodDto(visitQuerySchema) {}
export class VisitTemplateUpsertDto extends createZodDto(visitTemplateUpsertSchema) {}
export class VisitTemplatePatchDto extends createZodDto(visitTemplateUpsertSchema.partial()) {}
export class Icd10QueryDto extends createZodDto(icd10QuerySchema) {}
export class DrugQueryDto extends createZodDto(drugQuerySchema) {}
export class AddDrugDto extends createZodDto(addDrugSchema) {}
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}
