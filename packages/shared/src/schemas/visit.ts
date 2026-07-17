import { z } from 'zod';
import { ReferralType } from '../enums';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';

/** SOAP fields of an open (unlocked) visit. */
export const updateVisitSchema = z.object({
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessmentNote: z.string().optional(),
  plan: z.string().optional(),
  nextVisitAt: isoDateTimeSchema.optional(),
});
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;

export const upsertVitalsSchema = z.object({
  heightCm: z.number().min(30).max(250).optional(),
  weightKg: z.number().min(1).max(400).optional(),
  bpSystolic: z.number().int().min(40).max(300).optional(),
  bpDiastolic: z.number().int().min(20).max(200).optional(),
  pulseBpm: z.number().int().min(20).max(250).optional(),
  temperatureC: z.number().min(30).max(45).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  note: z.string().optional(),
});
export type UpsertVitalsInput = z.infer<typeof upsertVitalsSchema>;

export const addDiagnosisSchema = z.object({
  icd10Id: idSchema,
  isPrimary: z.boolean().default(false),
  note: z.string().optional(),
});
export type AddDiagnosisInput = z.infer<typeof addDiagnosisSchema>;

export const addPrescriptionSchema = z.object({
  drugName: z.string().min(2),
  drugId: idSchema.optional(),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  durationDays: z.number().int().min(1).optional(),
  instructions: z.string().optional(),
});
export type AddPrescriptionInput = z.infer<typeof addPrescriptionSchema>;

export const addReferralSchema = z.object({
  type: z.nativeEnum(ReferralType),
  targetSpecialty: z.string().min(1).optional(),
  targetDoctorUserId: idSchema.optional(),
  labTestIds: z.array(idSchema).optional(),
  note: z.string().optional(),
});
export type AddReferralInput = z.infer<typeof addReferralSchema>;

/** Audited edit of a locked visit — appends a VisitAmendment. */
export const amendVisitSchema = updateVisitSchema.extend({
  reason: z.string().min(3),
});
export type AmendVisitInput = z.infer<typeof amendVisitSchema>;

export const visitTemplateUpsertSchema = z.object({
  name: z.string().min(1),
  specialty: z.string().min(1).optional(),
  content: z.object({
    subjective: z.string().optional(),
    objective: z.string().optional(),
    plan: z.string().optional(),
  }),
});
export type VisitTemplateUpsertInput = z.infer<typeof visitTemplateUpsertSchema>;

export const icd10QuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1),
});
export type Icd10QueryInput = z.infer<typeof icd10QuerySchema>;

export const drugQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1),
});
export type DrugQueryInput = z.infer<typeof drugQuerySchema>;

export const visitQuerySchema = paginationQuerySchema.extend({
  patientId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type VisitQueryInput = z.infer<typeof visitQuerySchema>;
