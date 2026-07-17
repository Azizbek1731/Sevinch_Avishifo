import { z } from 'zod';
import { BloodGroup, DocumentCategory, Gender } from '../enums';
import {
  dateOnlySchema,
  idSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
  phoneSchema,
  sortQuerySchema,
} from './common';

/** Patient.allergies JSON row. */
export const allergySchema = z.object({
  name: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  note: z.string().optional(),
});
export type AllergyInput = z.infer<typeof allergySchema>;

export const createPatientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().min(1).optional(),
  dob: dateOnlySchema.optional(),
  gender: z.nativeEnum(Gender).optional(),
  phone: phoneSchema.optional(),
  phoneAlt: phoneSchema.optional(),
  address: z.string().min(1).optional(),
  passportId: z.string().min(1).optional(),
  bloodGroup: z.nativeEnum(BloodGroup).optional(),
  allergies: z.array(allergySchema).default([]),
  chronicConditions: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
  source: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = createPatientSchema.partial();
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const patientQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  sort: sortQuerySchema(['createdAt', 'fullName', 'mrn']),
});
export type PatientQueryInput = z.infer<typeof patientQuerySchema>;

export const mergePatientsSchema = z
  .object({
    primaryId: idSchema,
    duplicateId: idSchema,
  })
  .refine((v) => v.primaryId !== v.duplicateId, {
    message: 'Cannot merge a patient into itself',
    path: ['duplicateId'],
  });
export type MergePatientsInput = z.infer<typeof mergePatientsSchema>;

export const addConsentSchema = z.object({
  type: z.string().min(1).default('personal_data'),
  signedAt: isoDateTimeSchema,
  note: z.string().optional(),
});
export type AddConsentInput = z.infer<typeof addConsentSchema>;

/** Metadata accompanying a patient document upload. */
export const documentMetaSchema = z.object({
  category: z.nativeEnum(DocumentCategory),
  title: z.string().min(1),
});
export type DocumentMetaInput = z.infer<typeof documentMetaSchema>;
