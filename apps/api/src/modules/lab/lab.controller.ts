import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { LabService } from './lab.service';
import { LabCatalogService } from './catalog.service';
import { ResultsService } from './results.service';
import {
  CreateLabOrderDto,
  CreateLabTestDto,
  EnterLabResultsDto,
  ImportLabCatalogDto,
  LabCatalogQueryDto,
  LabOrderQueryDto,
  LabTestQueryDto,
  UpdateLabOrderContextDto,
  UpdateLabOrderStatusDto,
  UpdateLabTestDto,
} from './dto';

@ApiTags('lab')
@Controller('lab-catalog')
export class LabCatalogController {
  constructor(private readonly catalog: LabCatalogService) {}

  @Get()
  @RequirePermissions('services.read')
  list(@Query() query: LabCatalogQueryDto): Promise<PaginatedResult<unknown>> {
    return this.catalog.list(query);
  }

  @Get('summary')
  @RequirePermissions('services.read')
  summary(): Promise<Record<string, unknown>> {
    return this.catalog.summary();
  }

  @Get(':code')
  @RequirePermissions('services.read')
  getByCode(@Param('code') code: string): Promise<Record<string, unknown>> {
    return this.catalog.getByCode(code);
  }

  @Post('import')
  @RequirePermissions('lab.orders.write')
  import(@Body() dto: ImportLabCatalogDto): Promise<Record<string, unknown>> {
    return this.catalog.import(dto);
  }
}

@ApiTags('lab')
@Controller('lab-tests')
export class LabTestsController {
  constructor(private readonly lab: LabService) {}

  @Post()
  @RequirePermissions('lab.orders.write')
  createTest(@Body() dto: CreateLabTestDto): Promise<Record<string, unknown>> {
    return this.lab.createTest(dto);
  }

  @Get()
  @RequirePermissions('services.read')
  listTests(@Query() query: LabTestQueryDto): Promise<PaginatedResult<unknown>> {
    return this.lab.listTests(query);
  }

  @Patch(':id')
  @RequirePermissions('lab.orders.write')
  updateTest(
    @Param('id') id: string,
    @Body() dto: UpdateLabTestDto,
  ): Promise<Record<string, unknown>> {
    return this.lab.updateTest(id, dto);
  }
}

@ApiTags('lab')
@Controller('lab-orders')
export class LabOrdersController {
  constructor(
    private readonly lab: LabService,
    private readonly results: ResultsService,
  ) {}

  @Post()
  @RequirePermissions('lab.orders.write')
  createOrder(
    @Body() dto: CreateLabOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.lab.createOrder(dto, user.id);
  }

  @Get()
  @RequirePermissions('lab.orders.read')
  listOrders(@Query() query: LabOrderQueryDto): Promise<PaginatedResult<unknown>> {
    return this.lab.listOrders(query);
  }

  @Get(':id')
  @RequirePermissions('lab.orders.read')
  getOrder(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.lab.getOrder(id);
  }

  @Patch(':id/context')
  @RequirePermissions('lab.orders.write')
  updateContext(
    @Param('id') id: string,
    @Body() dto: UpdateLabOrderContextDto,
  ): Promise<Record<string, unknown>> {
    return this.lab.updateContext(id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('lab.orders.write')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLabOrderStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.lab.updateStatus(id, dto);
  }

  @Post('items/:itemId/results')
  @RequirePermissions('lab.results.write')
  enterResults(
    @Param('itemId') itemId: string,
    @Body() dto: EnterLabResultsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.results.enterResults(itemId, dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions('lab.results.approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.lab.approve(id, user.id);
  }

  @Post(':id/deliver')
  @RequirePermissions('lab.orders.write')
  deliver(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.lab.deliver(id);
  }

  @Get(':id/print')
  @RequirePermissions('lab.orders.read')
  print(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.lab.printPayload(id);
  }
}
