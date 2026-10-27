import { z } from 'zod';
import { ReferralType } from '../enums';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';

/** SOAP fields of an open (unlocked) visit. */
export const updateVisitSchema = z.object({
  reportTitle: z.string().trim().max(200).optional(),
  reportBody: z.string().max(50000).optional(),
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

const prescriptionText = (limit: number) => z.string().trim().max(limit).optional();

export const addPrescriptionSchema = z
  .object({
    drugName: z.string().trim().min(2),
    drugId: idSchema.optional(),
    strength: prescriptionText(100),
    form: prescriptionText(100),
    quantity: prescriptionText(100),
    dosage: z.string().optional(),
    route: prescriptionText(100),
    dripRate: prescriptionText(100),
    frequency: z.string().optional(),
    durationDays: z.number().int().min(1).optional(),
    durationText: prescriptionText(200),
    instructions: z.string().optional(),
    combineWithPrevious: z.boolean().default(false),
  })
  .superRefine((item, ctx) => {
    if (!item.combineWithPrevious) return;
    // A mixture has one shared form, quantity and administration instruction on its base.
    for (const field of [
      'form',
      'quantity',
      'dosage',
      'route',
      'dripRate',
      'frequency',
      'durationDays',
      'durationText',
      'instructions',
    ] as const) {
      if (item[field] !== undefined && String(item[field]).trim() !== '')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'Combined ingredients use the base prescription directions',
        });
    }
  });
export type AddPrescriptionInput = z.infer<typeof addPrescriptionSchema>;

export const replacePrescriptionsSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(2147483646),
    items: z.array(addPrescriptionSchema),
    physiotherapy: z.string().trim().max(10000).optional(),
  })
  .superRefine((draft, ctx) => {
    if (draft.items[0]?.combineWithPrevious)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', 0, 'combineWithPrevious'],
        message: 'The first prescription cannot be a combined ingredient',
      });
  });
export type ReplacePrescriptionsInput = z.infer<typeof replacePrescriptionsSchema>;

export const addReferralSchema = z
  .object({
    type: z.nativeEnum(ReferralType),
    targetSpecialty: z.string().min(1).optional(),
    targetDoctorUserId: idSchema.optional(),
    labTestIds: z.array(idSchema).min(1).optional(),
    serviceIds: z.array(idSchema).min(1).optional(),
    note: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === ReferralType.LAB && !value.labTestIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['labTestIds'],
        message: 'labTestIds are required for a LAB referral',
      });
    }
    if (value.type === ReferralType.ULTRASOUND) {
      if (!value.serviceIds?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceIds'],
          message: 'serviceIds are required for an ULTRASOUND referral',
        });
      }
      if (!value.targetDoctorUserId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targetDoctorUserId'],
          message: 'targetDoctorUserId is required for an ULTRASOUND referral',
        });
      }
    }
    if (value.type === ReferralType.SPECIALIST) {
      if (!value.serviceIds?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceIds'],
          message: 'serviceIds are required for a SPECIALIST referral',
        });
      }
      if (!value.targetDoctorUserId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targetDoctorUserId'],
          message: 'targetDoctorUserId is required for a SPECIALIST referral',
        });
      }
    }
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
