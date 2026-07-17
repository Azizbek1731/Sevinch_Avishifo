import { z } from 'zod';
import { Gender, LabOrderStatus } from '../enums';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { localizedNameSchema } from './service';

/** LabTestParameter.referenceRanges JSON row. */
export const referenceRangeSchema = z.object({
  gender: z.nativeEnum(Gender).optional(),
  ageMinY: z.number().min(0).optional(),
  ageMaxY: z.number().min(0).optional(),
  low: z.number(),
  high: z.number(),
});
export type ReferenceRangeInput = z.infer<typeof referenceRangeSchema>;

export const labTestParameterSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1).optional(),
  referenceRanges: z.array(referenceRangeSchema).default([]),
  sortOrder: z.number().int().min(0).optional(),
});
export type LabTestParameterInput = z.infer<typeof labTestParameterSchema>;

export const createLabTestSchema = z.object({
  code: z.string().min(1),
  name: localizedNameSchema,
  specimenType: z.string().min(1).optional(),
  serviceId: idSchema.optional(),
  parameters: z.array(labTestParameterSchema),
});
export type CreateLabTestInput = z.infer<typeof createLabTestSchema>;

export const updateLabTestSchema = createLabTestSchema.partial();
export type UpdateLabTestInput = z.infer<typeof updateLabTestSchema>;

export const createLabOrderSchema = z.object({
  patientId: idSchema,
  branchId: idSchema,
  visitId: idSchema.optional(),
  testIds: z.array(idSchema).min(1),
});
export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema>;

export const updateLabOrderStatusSchema = z.object({
  status: z.nativeEnum(LabOrderStatus),
});
export type UpdateLabOrderStatusInput = z.infer<typeof updateLabOrderStatusSchema>;

export const enterLabResultsSchema = z.object({
  values: z
    .array(
      z.object({
        parameterId: idSchema,
        value: z.string().min(1),
      }),
    )
    .min(1),
  note: z.string().optional(),
});
export type EnterLabResultsInput = z.infer<typeof enterLabResultsSchema>;

export const labOrderQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(LabOrderStatus).optional(),
  branchId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  search: z.string().min(1).optional(),
});
export type LabOrderQueryInput = z.infer<typeof labOrderQuerySchema>;
