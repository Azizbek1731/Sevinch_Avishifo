import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import {
  AssignPlanDto,
  ClinicListQueryDto,
  CreateClinicWithOwnerDto,
  FeatureFlagSetDto,
  PlanUpdateDto,
  PlanUpsertDto,
  UpdateClinicStatusDto,
  UpdateSubscriptionDto,
} from './dto/super-admin.dto';
import { SuperAdminService } from './super-admin.service';
import {
  type ClinicBaseResponse,
  type ClinicDetailResponse,
  type ClinicListItemResponse,
  type CreatedClinicResponse,
  type FeatureFlagResponse,
  type ImpersonationResponse,
  type PlanResponse,
  type PlatformAnalyticsResponse,
  type SubscriptionResponse,
} from './super-admin.service';

@ApiTags('super-admin')
@Controller('platform')
export class SuperAdminController {
  constructor(private readonly superAdmin: SuperAdminService) {}

  // ------------------------------------------------------------- clinics

  @Post('clinics')
  @RequirePermissions('platform.clinics.write')
  createClinic(@Body() dto: CreateClinicWithOwnerDto): Promise<CreatedClinicResponse> {
    return this.superAdmin.createClinicWithOwner(dto);
  }

  @Get('clinics')
  @RequirePermissions('platform.clinics.read')
  listClinics(@Query() query: ClinicListQueryDto): Promise<PaginatedResult<ClinicListItemResponse>> {
    return this.superAdmin.listClinics(query);
  }

  @Get('clinics/:id')
  @RequirePermissions('platform.clinics.read')
  getClinic(@Param('id') id: string): Promise<ClinicDetailResponse> {
    return this.superAdmin.getClinic(id);
  }

  @Patch('clinics/:id/status')
  @RequirePermissions('platform.clinics.write')
  updateClinicStatus(
    @Param('id') id: string,
    @Body() dto: UpdateClinicStatusDto,
  ): Promise<ClinicBaseResponse> {
    return this.superAdmin.updateClinicStatus(id, dto);
  }

  @Post('clinics/:id/plan')
  @RequirePermissions('platform.clinics.write')
  assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto): Promise<SubscriptionResponse> {
    return this.superAdmin.assignPlan(id, dto);
  }

  /** Extend/shorten the trial, pin an end date, or switch plan/status in place. */
  @Patch('clinics/:id/subscription')
  @RequirePermissions('platform.clinics.write')
  updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    return this.superAdmin.updateSubscription(id, dto);
  }

  @Put('clinics/:id/feature-flags')
  @RequirePermissions('platform.clinics.write')
  setFeatureFlag(
    @Param('id') id: string,
    @Body() dto: FeatureFlagSetDto,
  ): Promise<FeatureFlagResponse> {
    return this.superAdmin.setFeatureFlag(id, dto);
  }

  @Post('clinics/:id/impersonate')
  @RequirePermissions('platform.impersonate')
  impersonate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ImpersonationResponse> {
    return this.superAdmin.impersonate(id, user);
  }

  // ------------------------------------------------------------- plans

  @Get('plans')
  @RequirePermissions('platform.plans.write')
  listPlans(): Promise<PaginatedResult<PlanResponse>> {
    return this.superAdmin.listPlans();
  }

  @Post('plans')
  @RequirePermissions('platform.plans.write')
  upsertPlan(@Body() dto: PlanUpsertDto): Promise<PlanResponse> {
    return this.superAdmin.upsertPlan(dto);
  }

  @Patch('plans/:id')
  @RequirePermissions('platform.plans.write')
  updatePlan(@Param('id') id: string, @Body() dto: PlanUpdateDto): Promise<PlanResponse> {
    return this.superAdmin.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @RequirePermissions('platform.plans.write')
  deactivatePlan(@Param('id') id: string): Promise<PlanResponse> {
    return this.superAdmin.deactivatePlan(id);
  }

  // ------------------------------------------------------------- analytics

  @Get('analytics')
  @RequirePermissions('platform.analytics.read')
  analytics(): Promise<PlatformAnalyticsResponse> {
    return this.superAdmin.analytics();
  }
}
