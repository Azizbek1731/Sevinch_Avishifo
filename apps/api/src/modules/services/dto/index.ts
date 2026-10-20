import { createZodDto } from 'nestjs-zod';
import {
  createPackageSchema,
  createServiceCategorySchema,
  createServiceSchema,
  discountRuleUpsertSchema,
  paginationQuerySchema,
  priceListQuerySchema,
  priceListUpsertSchema,
  serviceQuerySchema,
  setPriceListItemsSchema,
  setServicePriceSchema,
  updateServiceSchema,
} from '@avishifo/shared';

/** Generic pagination query (categories, packages, discount rules, price history). */
export class ListQueryDto extends createZodDto(paginationQuerySchema) {}

// ---- Service categories
export class CreateServiceCategoryDto extends createZodDto(createServiceCategorySchema) {}
export class UpdateServiceCategoryDto extends createZodDto(createServiceCategorySchema.partial()) {}

// ---- Services
export class CreateServiceDto extends createZodDto(createServiceSchema) {}
export class UpdateServiceDto extends createZodDto(updateServiceSchema) {}
export class ServiceQueryDto extends createZodDto(serviceQuerySchema) {}
export class SetServicePriceDto extends createZodDto(setServicePriceSchema) {}

// ---- Packages
export class CreatePackageDto extends createZodDto(createPackageSchema) {}
export class UpdatePackageDto extends createZodDto(createPackageSchema.partial()) {}

// ---- Discount rules
export class DiscountRuleUpsertDto extends createZodDto(discountRuleUpsertSchema) {}

// ---- Price lists
export class PriceListQueryDto extends createZodDto(priceListQuerySchema) {}
export class CreatePriceListDto extends createZodDto(priceListUpsertSchema) {}
export class UpdatePriceListDto extends createZodDto(priceListUpsertSchema.partial()) {}
export class SetPriceListItemsDto extends createZodDto(setPriceListItemsSchema) {}
