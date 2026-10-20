import { z } from 'zod';
import { DiscountType, ServiceKind } from '../enums';
import { idSchema, isoDateTimeSchema, moneySchema, paginationQuerySchema } from './common';

/** Multilingual name { uz, ru?, en? } — uz-Latn is mandatory. */
export const localizedNameSchema = z.object({
  uz: z.string().min(1),
  ru: z.string().min(1).optional(),
  en: z.string().min(1).optional(),
});
export type LocalizedNameInput = z.infer<typeof localizedNameSchema>;

/**
 * Query-string boolean. `z.coerce.boolean()` would turn the string "false"
 * into `true`, so accept explicit true/false/1/0 tokens instead.
 */
const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const createServiceCategorySchema = z.object({
  name: z.string().min(1),
  kind: z.nativeEnum(ServiceKind),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateServiceCategoryInput = z.infer<typeof createServiceCategorySchema>;

export const createServiceSchema = z.object({
  categoryId: idSchema,
  code: z.string().min(1),
  name: localizedNameSchema,
  unit: z.string().trim().min(1).max(30).default('dona'),
  durationMin: z.number().int().min(1).default(15),
  vatIncluded: z.boolean().default(true),
  /** Initial price (creates the first ServicePrice row). */
  price: moneySchema,
  /** Branch override for the initial price; omit for clinic default. */
  branchId: idSchema.optional(),
  /**
   * Standard-catalogue code this lab service is made from (e.g. "CBC"). Only
   * meaningful in a LAB-kind category: the server copies the catalogue test —
   * analytes and reference intervals included — and links it to the service, so
   * selling the service is what puts it on the lab worklist.
   */
  labCatalogCode: z.string().min(1).max(64).optional(),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = createServiceSchema.partial();
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

/** Effective-dated price change; branchId null = clinic default. */
export const setServicePriceSchema = z.object({
  serviceId: idSchema,
  price: moneySchema,
  branchId: idSchema.optional(),
  effectiveFrom: isoDateTimeSchema,
});
export type SetServicePriceInput = z.infer<typeof setServicePriceSchema>;

export const createPackageSchema = z.object({
  code: z.string().min(1),
  name: localizedNameSchema,
  price: moneySchema,
  items: z
    .array(
      z.object({
        serviceId: idSchema,
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
});
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const discountRuleUpsertSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(DiscountType),
  /** PERCENT: 0-100; FIXED: amount. */
  value: moneySchema,
  patientTag: z.string().min(1).optional(),
  promoCode: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
export type DiscountRuleUpsertInput = z.infer<typeof discountRuleUpsertSchema>;

export const serviceQuerySchema = paginationQuerySchema.extend({
  kind: z.nativeEnum(ServiceKind).optional(),
  categoryId: idSchema.optional(),
  search: z.string().min(1).optional(),
  isActive: queryBooleanSchema.optional(),
});
export type ServiceQueryInput = z.infer<typeof serviceQuerySchema>;

export const priceListUpsertSchema = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean().optional(),
});
export type PriceListUpsertInput = z.infer<typeof priceListUpsertSchema>;

export const priceListQuerySchema = paginationQuerySchema.extend({
  isActive: queryBooleanSchema.optional(),
});
export type PriceListQueryInput = z.infer<typeof priceListQuerySchema>;

/** DECIMAL(14,2) holds at most 12 whole digits. */
const priceListPriceSchema = moneySchema.refine(
  (value) => value.split('.')[0]!.replace(/^0+/, '').length <= 12,
  { message: 'Price is too large' },
);

/** Sets the listed services' prices; `price: null` takes a service out of the list. */
export const setPriceListItemsSchema = z.object({
  items: z
    .array(z.object({ serviceId: idSchema, price: priceListPriceSchema.nullable() }))
    .min(1)
    .max(2000)
    .refine((items) => new Set(items.map((item) => item.serviceId)).size === items.length, {
      message: 'Each service may appear only once',
    }),
});
export type SetPriceListItemsInput = z.infer<typeof setPriceListItemsSchema>;
