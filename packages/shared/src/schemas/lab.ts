import { z } from 'zod';
import {
  Biomaterial,
  Gender,
  LabCategory,
  LabOrderStatus,
  LabValueType,
  PhysiologicalState,
} from '../enums';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { localizedNameSchema } from './service';

/**
 * One reference interval row of LabTestParameter.referenceRanges (and of the shared
 * catalogue, which uses the identical shape so an import is a verbatim copy).
 *
 * Every qualifier is optional and every absent qualifier means "applies to everyone":
 * a row with nothing but `low`/`high` is the plain adult interval. Age is in DAYS
 * because the catalogue's newborn intervals change within the first week of life, which
 * years cannot express. `low`/`high` are individually optional so that a one-sided norm
 * ("< 0.15 g/24h") stays one-sided instead of acquiring a fabricated opposite bound.
 */
export const referenceRangeSchema = z
  .object({
    gender: z.nativeEnum(Gender).optional(),
    /** Inclusive lower age bound, in days since birth. */
    ageMinDays: z.number().int().min(0).optional(),
    /** EXCLUSIVE upper age bound, in days since birth. */
    ageMaxDays: z.number().int().min(0).optional(),
    state: z.nativeEnum(PhysiologicalState).optional(),
    low: z.number().optional(),
    high: z.number().optional(),
    /** Panic threshold: below this the result must reach a clinician immediately. */
    criticalLow: z.number().optional(),
    criticalHigh: z.number().optional(),
    /** Normal wording for a qualitative parameter, e.g. "Отрицательно". */
    textNorm: z.string().optional(),
    /** Source label of the interval, e.g. "Взрослые мужчины (18-65 лет)". */
    label: z.string().optional(),
    note: z.string().optional(),
    /** Legacy years-based bounds, still read from rows written before the day switch. */
    ageMinY: z.number().min(0).optional(),
    ageMaxY: z.number().min(0).optional(),
  })
  .refine(
    (r) => r.low === undefined || r.high === undefined || r.low <= r.high,
    { message: 'low must not exceed high' },
  )
  .refine(
    (r) => r.ageMinDays === undefined || r.ageMaxDays === undefined || r.ageMinDays < r.ageMaxDays,
    { message: 'ageMinDays must be below ageMaxDays' },
  );
export type ReferenceRangeInput = z.infer<typeof referenceRangeSchema>;

export const labTestParameterSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(32).optional(),
  unit: z.string().min(1).optional(),
  valueType: z.nativeEnum(LabValueType).optional(),
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
  physiologicalState: z.nativeEnum(PhysiologicalState).optional(),
});
export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema>;

/**
 * Correcting the state the specimen was drawn under. Re-flags every result already
 * entered on the order, because the intervals those flags came from have changed.
 */
export const updateLabOrderContextSchema = z.object({
  physiologicalState: z.nativeEnum(PhysiologicalState).nullable(),
});
export type UpdateLabOrderContextInput = z.infer<typeof updateLabOrderContextSchema>;

// ------------------------------------------------------------ standard catalogue

export const labCatalogQuerySchema = paginationQuerySchema.extend({
  /**
   * Raised above the shared cap: the catalogue is a fixed dictionary of a few hundred
   * rows with no tenant data, and the picker is a browse-and-tick list rather than a
   * paged report — a page break in the middle of "blood" would just hide tests.
   */
  limit: z.coerce.number().int().min(1).max(500).default(50),
  biomaterial: z.nativeEnum(Biomaterial).optional(),
  category: z.nativeEnum(LabCategory).optional(),
  search: z.string().min(1).optional(),
  /** Hide catalogue entries this clinic has already imported. */
  onlyNew: z.coerce.boolean().optional(),
});
export type LabCatalogQueryInput = z.infer<typeof labCatalogQuerySchema>;

export const importLabCatalogSchema = z.object({
  /** Catalogue test codes, e.g. ["CBC", "LIPID_PANEL"]. */
  codes: z.array(z.string().min(1)).min(1).max(200),
  /** Re-copy parameters and intervals onto tests already imported earlier. */
  overwriteExisting: z.boolean().default(false),
});
export type ImportLabCatalogInput = z.infer<typeof importLabCatalogSchema>;

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
