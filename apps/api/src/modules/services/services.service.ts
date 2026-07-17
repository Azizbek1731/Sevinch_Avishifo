import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  DiscountRule,
  PackageItem,
  Service,
  ServiceCategory,
  ServicePackage,
  ServicePrice,
} from '@prisma/client';
import { AuditAction, DiscountType, ErrorCode } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { PricingService } from './pricing.service';
import { CreatePackageDto, CreateServiceCategoryDto, CreateServiceDto, DiscountRuleUpsertDto, ListQueryDto, ServiceQueryDto, SetServicePriceDto, UpdatePackageDto, UpdateServiceCategoryDto, UpdateServiceDto } from './dto';

// ---------------------------------------------------------------- responses

export interface CategoryResponse {
  id: string;
  name: string;
  kind: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ServicePriceResponse {
  id: string;
  serviceId: string;
  branchId: string | null;
  price: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface ServiceResponse {
  id: string;
  categoryId: string;
  code: string;
  name: Prisma.JsonValue;
  durationMin: number;
  vatIncluded: boolean;
  isActive: boolean;
  currentPrice: string | null;
  category?: CategoryResponse;
  prices?: ServicePriceResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface PackageResponse {
  id: string;
  code: string;
  name: Prisma.JsonValue;
  price: string;
  isActive: boolean;
  items: Array<{
    id: string;
    serviceId: string;
    quantity: number;
    service: ServiceResponse;
  }>;
  createdAt: string;
}

export interface DiscountRuleResponse {
  id: string;
  name: string;
  type: string;
  value: string;
  patientTag: string | null;
  promoCode: string | null;
  maxForRole: Prisma.JsonValue;
  isActive: boolean;
  createdAt: string;
}

function mapCategory(c: ServiceCategory): CategoryResponse {
  return { id: c.id, name: c.name, kind: c.kind, sortOrder: c.sortOrder, isActive: c.isActive };
}

function mapPrice(p: ServicePrice): ServicePriceResponse {
  return {
    id: p.id,
    serviceId: p.serviceId,
    branchId: p.branchId,
    price: p.price.toFixed(2),
    effectiveFrom: p.effectiveFrom.toISOString(),
    effectiveTo: p.effectiveTo ? p.effectiveTo.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

function mapService(
  s: Service & { category?: ServiceCategory; prices?: ServicePrice[] },
  currentPrice: string | null,
): ServiceResponse {
  return {
    id: s.id,
    categoryId: s.categoryId,
    code: s.code,
    name: s.name,
    durationMin: s.durationMin,
    vatIncluded: s.vatIncluded,
    isActive: s.isActive,
    currentPrice,
    ...(s.category ? { category: mapCategory(s.category) } : {}),
    ...(s.prices ? { prices: s.prices.map(mapPrice) } : {}),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function mapDiscountRule(r: DiscountRule): DiscountRuleResponse {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    value: r.value.toFixed(2),
    patientTag: r.patientTag,
    promoCode: r.promoCode,
    maxForRole: r.maxForRole,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

type PackageWithItems = ServicePackage & { items: Array<PackageItem & { service: Service }> };

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ categories

  async listCategories(query: ListQueryDto): Promise<PaginatedResult<CategoryResponse>> {
    const [items, total] = await Promise.all([
      this.prisma.db.serviceCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.db.serviceCategory.count(),
    ]);
    return paginated(items.map(mapCategory), { page: query.page, limit: query.limit, total });
  }

  async createCategory(dto: CreateServiceCategoryDto): Promise<CategoryResponse> {
    const category = await this.prisma.db.serviceCategory.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        name: dto.name,
        kind: dto.kind,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return mapCategory(category);
  }

  async updateCategory(id: string, dto: UpdateServiceCategoryDto): Promise<CategoryResponse> {
    await this.requireCategory(id);
    const category = await this.prisma.db.serviceCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    return mapCategory(category);
  }

  /** Soft delete: categories are referenced by services, so we only deactivate. */
  async deleteCategory(id: string): Promise<CategoryResponse> {
    await this.requireCategory(id);
    const category = await this.prisma.db.serviceCategory.update({
      where: { id },
      data: { isActive: false },
    });
    return mapCategory(category);
  }

  // ------------------------------------------------------------ services

  async listServices(
    query: ServiceQueryDto,
    branchId?: string,
  ): Promise<PaginatedResult<ServiceResponse>> {
    const search = query.search;
    const where: Prisma.ServiceWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              // Multilingual name is Json { uz, ru, en } — filter compiles to name ->> locale.
              { name: { path: ['uz'], string_contains: search } },
              { name: { path: ['ru'], string_contains: search } },
              { name: { path: ['en'], string_contains: search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.service.findMany({
        where,
        include: { category: true },
        orderBy: [{ code: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.db.service.count({ where }),
    ]);

    // One query for all current prices on this page (no N+1).
    const priceMap = await this.pricing.getCurrentPrices(
      rows.map((r) => r.id),
      branchId,
    );
    const items = rows.map((r) => mapService(r, priceMap.get(r.id) ?? null));
    return paginated(items, { page: query.page, limit: query.limit, total });
  }

  async createService(dto: CreateServiceDto): Promise<ServiceResponse> {
    await this.requireCategory(dto.categoryId);
    const effectiveFrom = new Date();
    let service: Service & { category: ServiceCategory; prices: ServicePrice[] };
    try {
      service = await this.prisma.db.service.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: TenantContext.requireClinicId(),
          categoryId: dto.categoryId,
          code: dto.code,
          name: dto.name,
          durationMin: dto.durationMin,
          vatIncluded: dto.vatIncluded,
          prices: {
            create: {
              // Nested creates are NOT auto-stamped by the tenant extension.
              clinicId: TenantContext.requireClinicId(),
              branchId: dto.branchId ?? null,
              price: new Prisma.Decimal(dto.price),
              effectiveFrom,
            },
          },
        },
        include: { category: true, prices: true },
      });
    } catch (err) {
      throw this.mapUniqueError(err, 'Service code already exists in this clinic');
    }
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Service',
      entityId: service.id,
      after: { code: service.code, name: service.name, categoryId: service.categoryId, price: dto.price },
    });
    return mapService(service, dto.price);
  }

  async getService(id: string, branchId?: string): Promise<ServiceResponse> {
    const service = await this.prisma.db.service.findFirst({
      where: { id },
      include: { category: true, prices: { orderBy: { effectiveFrom: 'desc' } } },
    });
    if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    const currentPrice = await this.pricing.getCurrentPrice(id, branchId);
    return mapService(service, currentPrice);
  }

  async updateService(id: string, dto: UpdateServiceDto, branchId?: string): Promise<ServiceResponse> {
    const before = await this.prisma.db.service.findFirst({ where: { id } });
    if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    if (dto.categoryId !== undefined) await this.requireCategory(dto.categoryId);

    // Note: `price`/`branchId` in the update payload are ignored here —
    // price changes go through POST /services/:id/prices (effective-dated history).
    let service: Service & { category: ServiceCategory };
    try {
      service = await this.prisma.db.service.update({
        where: { id },
        data: {
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin } : {}),
          ...(dto.vatIncluded !== undefined ? { vatIncluded: dto.vatIncluded } : {}),
        },
        include: { category: true },
      });
    } catch (err) {
      throw this.mapUniqueError(err, 'Service code already exists in this clinic');
    }
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Service',
      entityId: id,
      before: { code: before.code, name: before.name, categoryId: before.categoryId, durationMin: before.durationMin, vatIncluded: before.vatIncluded },
      after: { code: service.code, name: service.name, categoryId: service.categoryId, durationMin: service.durationMin, vatIncluded: service.vatIncluded },
    });
    const currentPrice = await this.pricing.getCurrentPrice(id, branchId);
    return mapService(service, currentPrice);
  }

  /** Soft delete: services are referenced by invoices/appointments — deactivate only. */
  async deleteService(id: string): Promise<ServiceResponse> {
    const before = await this.prisma.db.service.findFirst({ where: { id } });
    if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    const service = await this.prisma.db.service.update({
      where: { id },
      data: { isActive: false },
      include: { category: true },
    });
    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Service',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: false },
    });
    return mapService(service, null);
  }

  // ------------------------------------------------------------ prices

  async setPrice(serviceId: string, dto: SetServicePriceDto): Promise<ServicePriceResponse> {
    if (dto.serviceId !== serviceId) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Body serviceId does not match the URL parameter',
        400,
      );
    }
    const service = await this.prisma.db.service.findFirst({ where: { id: serviceId } });
    if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);

    const effectiveFrom = new Date(dto.effectiveFrom);
    const branchId = dto.branchId ?? null;

    const created = await this.prisma.db.$transaction(async (tx) => {
      // Close the open price row of the same branch scope (clinic default vs override).
      const open = await tx.servicePrice.findFirst({
        where: { serviceId, branchId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (open && open.effectiveFrom.getTime() >= effectiveFrom.getTime()) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'effectiveFrom must be later than the start of the current open price period',
          409,
        );
      }
      if (open) {
        await tx.servicePrice.update({
          where: { id: open.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      return tx.servicePrice.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: TenantContext.requireClinicId(),
          serviceId,
          branchId,
          price: new Prisma.Decimal(dto.price),
          effectiveFrom,
        },
      });
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'ServicePrice',
      entityId: created.id,
      after: { ...mapPrice(created) },
    });
    return mapPrice(created);
  }

  async listPriceHistory(
    serviceId: string,
    query: ListQueryDto,
  ): Promise<PaginatedResult<ServicePriceResponse>> {
    const service = await this.prisma.db.service.findFirst({ where: { id: serviceId } });
    if (!service) throw new AppException(ErrorCode.NOT_FOUND, 'Service not found', 404);
    const [rows, total] = await Promise.all([
      this.prisma.db.servicePrice.findMany({
        where: { serviceId },
        orderBy: { effectiveFrom: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.servicePrice.count({ where: { serviceId } }),
    ]);
    return paginated(rows.map(mapPrice), { page: query.page, limit: query.limit, total });
  }

  // ------------------------------------------------------------ packages

  async listPackages(
    query: ListQueryDto,
    branchId?: string,
  ): Promise<PaginatedResult<PackageResponse>> {
    const [rows, total] = await Promise.all([
      this.prisma.db.servicePackage.findMany({
        include: { items: { include: { service: true } } },
        orderBy: { code: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.db.servicePackage.count(),
    ]);
    const serviceIds = [...new Set(rows.flatMap((p) => p.items.map((i) => i.serviceId)))];
    const priceMap = await this.pricing.getCurrentPrices(serviceIds, branchId);
    const items = rows.map((p) => this.mapPackage(p, priceMap));
    return paginated(items, { page: query.page, limit: query.limit, total });
  }

  async createPackage(dto: CreatePackageDto, branchId?: string): Promise<PackageResponse> {
    await this.requireServicesExist(dto.items.map((i) => i.serviceId));
    let pkg: PackageWithItems;
    try {
      pkg = await this.prisma.db.servicePackage.create({
        // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
        data: {
          clinicId: TenantContext.requireClinicId(),
          code: dto.code,
          name: dto.name,
          price: new Prisma.Decimal(dto.price),
          items: {
            create: dto.items.map((item) => ({
              // Nested creates are NOT auto-stamped by the tenant extension.
              clinicId: TenantContext.requireClinicId(),
              serviceId: item.serviceId,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: { include: { service: true } } },
      });
    } catch (err) {
      throw this.mapUniqueError(err, 'Package code already exists in this clinic');
    }
    const priceMap = await this.pricing.getCurrentPrices(
      pkg.items.map((i) => i.serviceId),
      branchId,
    );
    return this.mapPackage(pkg, priceMap);
  }

  async getPackage(id: string, branchId?: string): Promise<PackageResponse> {
    const pkg = await this.prisma.db.servicePackage.findFirst({
      where: { id },
      include: { items: { include: { service: true } } },
    });
    if (!pkg) throw new AppException(ErrorCode.NOT_FOUND, 'Package not found', 404);
    const priceMap = await this.pricing.getCurrentPrices(
      pkg.items.map((i) => i.serviceId),
      branchId,
    );
    return this.mapPackage(pkg, priceMap);
  }

  async updatePackage(id: string, dto: UpdatePackageDto, branchId?: string): Promise<PackageResponse> {
    const existing = await this.prisma.db.servicePackage.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Package not found', 404);
    if (dto.items !== undefined) {
      await this.requireServicesExist(dto.items.map((i) => i.serviceId));
    }
    let pkg: PackageWithItems;
    try {
      pkg = await this.prisma.db.servicePackage.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
          ...(dto.items !== undefined
            ? {
                items: {
                  deleteMany: {},
                  create: dto.items.map((item) => ({
                    // Nested creates are NOT auto-stamped by the tenant extension.
                    clinicId: TenantContext.requireClinicId(),
                    serviceId: item.serviceId,
                    quantity: item.quantity,
                  })),
                },
              }
            : {}),
        },
        include: { items: { include: { service: true } } },
      });
    } catch (err) {
      throw this.mapUniqueError(err, 'Package code already exists in this clinic');
    }
    const priceMap = await this.pricing.getCurrentPrices(
      pkg.items.map((i) => i.serviceId),
      branchId,
    );
    return this.mapPackage(pkg, priceMap);
  }

  async deletePackage(id: string): Promise<PackageResponse> {
    const existing = await this.prisma.db.servicePackage.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Package not found', 404);
    const pkg = await this.prisma.db.servicePackage.update({
      where: { id },
      data: { isActive: false },
      include: { items: { include: { service: true } } },
    });
    return this.mapPackage(pkg, new Map());
  }

  // ------------------------------------------------------------ discount rules

  async listDiscountRules(query: ListQueryDto): Promise<PaginatedResult<DiscountRuleResponse>> {
    const [rows, total] = await Promise.all([
      this.prisma.db.discountRule.findMany({
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.discountRule.count(),
    ]);
    return paginated(rows.map(mapDiscountRule), { page: query.page, limit: query.limit, total });
  }

  async createDiscountRule(dto: DiscountRuleUpsertDto): Promise<DiscountRuleResponse> {
    this.assertDiscountValue(dto.type, dto.value);
    const rule = await this.prisma.db.discountRule.create({
      // clinicId is stamped by the tenant extension at runtime; set explicitly for typing.
      data: {
        clinicId: TenantContext.requireClinicId(),
        name: dto.name,
        type: dto.type,
        value: new Prisma.Decimal(dto.value),
        patientTag: dto.patientTag ?? null,
        promoCode: dto.promoCode ?? null,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return mapDiscountRule(rule);
  }

  async updateDiscountRule(id: string, dto: DiscountRuleUpsertDto): Promise<DiscountRuleResponse> {
    this.assertDiscountValue(dto.type, dto.value);
    const existing = await this.prisma.db.discountRule.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Discount rule not found', 404);
    const rule = await this.prisma.db.discountRule.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        value: new Prisma.Decimal(dto.value),
        patientTag: dto.patientTag ?? null,
        promoCode: dto.promoCode ?? null,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return mapDiscountRule(rule);
  }

  async deleteDiscountRule(id: string): Promise<DiscountRuleResponse> {
    const existing = await this.prisma.db.discountRule.findFirst({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Discount rule not found', 404);
    const rule = await this.prisma.db.discountRule.update({
      where: { id },
      data: { isActive: false },
    });
    return mapDiscountRule(rule);
  }

  // ------------------------------------------------------------ helpers

  private mapPackage(pkg: PackageWithItems, priceMap: Map<string, string>): PackageResponse {
    return {
      id: pkg.id,
      code: pkg.code,
      name: pkg.name,
      price: pkg.price.toFixed(2),
      isActive: pkg.isActive,
      items: pkg.items.map((item) => ({
        id: item.id,
        serviceId: item.serviceId,
        quantity: item.quantity,
        service: mapService(item.service, priceMap.get(item.serviceId) ?? null),
      })),
      createdAt: pkg.createdAt.toISOString(),
    };
  }

  private async requireCategory(id: string): Promise<void> {
    const category = await this.prisma.db.serviceCategory.findFirst({ where: { id } });
    if (!category) throw new AppException(ErrorCode.NOT_FOUND, 'Service category not found', 404);
  }

  private async requireServicesExist(serviceIds: string[]): Promise<void> {
    const ids = [...new Set(serviceIds)];
    const count = await this.prisma.db.service.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'One or more services not found', 404);
    }
  }

  private assertDiscountValue(type: DiscountType, value: string): void {
    if (type === DiscountType.PERCENT && Number(value) > 100) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Percent discount cannot exceed 100', 400);
    }
  }

  private mapUniqueError(err: unknown, message: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new AppException(ErrorCode.CONFLICT, message, 409);
    }
    return err;
  }
}
