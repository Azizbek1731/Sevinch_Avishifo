import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  addConsentSchema,
  createPatientSchema,
  dateOnlySchema,
  documentMetaSchema,
  idSchema,
  mergePatientsSchema,
  paginationQuerySchema,
  patientQuerySchema,
  updatePatientSchema,
} from '@avishifo/shared';

export class CreatePatientDto extends createZodDto(createPatientSchema) {}
export class UpdatePatientDto extends createZodDto(updatePatientSchema) {}
export class PatientQueryDto extends createZodDto(patientQuerySchema) {}
export class MergePatientsDto extends createZodDto(mergePatientsSchema) {}
export class AddConsentDto extends createZodDto(addConsentSchema) {}
export class DocumentMetaDto extends createZodDto(documentMetaSchema) {}
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}

/** `?force=true` bypasses duplicate detection on fast registration. */
const createPatientQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional(),
});
export class CreatePatientQueryDto extends createZodDto(createPatientQuerySchema) {}

export const TIMELINE_TYPES = [
  'visit',
  'diagnosis',
  'prescription',
  'lab',
  'document',
  'payment',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

const patientTimelineQuerySchema = paginationQuerySchema.extend({
  type: z.enum(TIMELINE_TYPES).optional(),
  doctorUserId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export class PatientTimelineQueryDto extends createZodDto(patientTimelineQuerySchema) {}
