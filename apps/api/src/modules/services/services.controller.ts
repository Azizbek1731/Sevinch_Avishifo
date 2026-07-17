import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { ServicesService } from './services.service';
import {
  type CategoryResponse,
  type DiscountRuleResponse,
  type PackageResponse,
  type ServicePriceResponse,
  type ServiceResponse,
} from './services.service';
import { CreatePackageDto, CreateServiceCategoryDto, CreateServiceDto, DiscountRuleUpsertDto, ListQueryDto, ServiceQueryDto, SetServicePriceDto, UpdatePackageDto, UpdateServiceCategoryDto, UpdateServiceDto } from './dto';

/**
 * M7 — service catalog, effective-dated pricing, packages, discount rules.
 * The optional `x-branch-id` header scopes price resolution (branch override
 * wins over clinic default); without it the clinic default price is returned.
 */
@ApiTags('services')
@Controller()
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  // ------------------------------------------------------------ categories

  @Get('service-categories')
  @RequirePermissions('services.read')
  listCategories(@Query() query: ListQueryDto): Promise<PaginatedResult<CategoryResponse>> {
    return this.services.listCategories(query);
  }

  @Post('service-categories')
  @RequirePermissions('services.write')
  createCategory(@Body() dto: CreateServiceCategoryDto): Promise<CategoryResponse> {
    return this.services.createCategory(dto);
  }

  @Patch('service-categories/:id')
  @RequirePermissions('services.write')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateServiceCategoryDto,
  ): Promise<CategoryResponse> {
    return this.services.updateCategory(id, dto);
  }

  @Delete('service-categories/:id')
  @RequirePermissions('services.write')
  deleteCategory(@Param('id') id: string): Promise<CategoryResponse> {
    return this.services.deleteCategory(id);
  }

  // ------------------------------------------------------------ services

  @Get('services')
  @RequirePermissions('services.read')
  listServices(
    @Query() query: ServiceQueryDto,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<PaginatedResult<ServiceResponse>> {
    return this.services.listServices(query, branchId);
  }

  @Post('services')
  @RequirePermissions('services.write')
  createService(@Body() dto: CreateServiceDto): Promise<ServiceResponse> {
    return this.services.createService(dto);
  }

  @Get('services/:id')
  @RequirePermissions('services.read')
  getService(
    @Param('id') id: string,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<ServiceResponse> {
    return this.services.getService(id, branchId);
  }

  @Patch('services/:id')
  @RequirePermissions('services.write')
  updateService(
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<ServiceResponse> {
    return this.services.updateService(id, dto, branchId);
  }

  @Delete('services/:id')
  @RequirePermissions('services.write')
  deleteService(@Param('id') id: string): Promise<ServiceResponse> {
    return this.services.deleteService(id);
  }

  // ------------------------------------------------------------ prices

  @Post('services/:id/prices')
  @RequirePermissions('services.write')
  setPrice(@Param('id') id: string, @Body() dto: SetServicePriceDto): Promise<ServicePriceResponse> {
    return this.services.setPrice(id, dto);
  }

  @Get('services/:id/prices')
  @RequirePermissions('services.read')
  listPriceHistory(
    @Param('id') id: string,
    @Query() query: ListQueryDto,
  ): Promise<PaginatedResult<ServicePriceResponse>> {
    return this.services.listPriceHistory(id, query);
  }

  // ------------------------------------------------------------ packages

  @Get('service-packages')
  @RequirePermissions('services.read')
  listPackages(
    @Query() query: ListQueryDto,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<PaginatedResult<PackageResponse>> {
    return this.services.listPackages(query, branchId);
  }

  @Post('service-packages')
  @RequirePermissions('services.write')
  createPackage(
    @Body() dto: CreatePackageDto,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<PackageResponse> {
    return this.services.createPackage(dto, branchId);
  }

  @Get('service-packages/:id')
  @RequirePermissions('services.read')
  getPackage(
    @Param('id') id: string,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<PackageResponse> {
    return this.services.getPackage(id, branchId);
  }

  @Patch('service-packages/:id')
  @RequirePermissions('services.write')
  updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
    @Headers('x-branch-id') branchId?: string,
  ): Promise<PackageResponse> {
    return this.services.updatePackage(id, dto, branchId);
  }

  @Delete('service-packages/:id')
  @RequirePermissions('services.write')
  deletePackage(@Param('id') id: string): Promise<PackageResponse> {
    return this.services.deletePackage(id);
  }

  // ------------------------------------------------------------ discount rules

  @Get('discount-rules')
  @RequirePermissions('services.read')
  listDiscountRules(@Query() query: ListQueryDto): Promise<PaginatedResult<DiscountRuleResponse>> {
    return this.services.listDiscountRules(query);
  }

  @Post('discount-rules')
  @RequirePermissions('services.write')
  createDiscountRule(@Body() dto: DiscountRuleUpsertDto): Promise<DiscountRuleResponse> {
    return this.services.createDiscountRule(dto);
  }

  @Patch('discount-rules/:id')
  @RequirePermissions('services.write')
  updateDiscountRule(
    @Param('id') id: string,
    @Body() dto: DiscountRuleUpsertDto,
  ): Promise<DiscountRuleResponse> {
    return this.services.updateDiscountRule(id, dto);
  }

  @Delete('discount-rules/:id')
  @RequirePermissions('services.write')
  deleteDiscountRule(@Param('id') id: string): Promise<DiscountRuleResponse> {
    return this.services.deleteDiscountRule(id);
  }
}
