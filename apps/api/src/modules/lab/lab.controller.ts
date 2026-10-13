import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { UPLOAD_LIMITS, type AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { LabService } from './lab.service';
import { LabCatalogService } from './catalog.service';
import { ResultPdfService, type PdfLocale, type ResultPdfData } from './result-pdf.service';
import { DocumentsService } from '../patients/documents.service';
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
  @RequirePermissions('services.write')
  import(@Body() dto: ImportLabCatalogDto): Promise<Record<string, unknown>> {
    return this.catalog.import(dto);
  }
}

@ApiTags('lab')
@Controller('lab-tests')
export class LabTestsController {
  constructor(private readonly lab: LabService) {}

  @Post()
  @RequirePermissions('services.write')
  createTest(@Body() dto: CreateLabTestDto): Promise<Record<string, unknown>> {
    return this.lab.createTest(dto);
  }

  @Get()
  @RequirePermissions('services.read')
  listTests(@Query() query: LabTestQueryDto): Promise<PaginatedResult<unknown>> {
    return this.lab.listTests(query);
  }

  @Patch(':id')
  @RequirePermissions('services.write')
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
    private readonly pdf_: ResultPdfService,
    private readonly documents: DocumentsService,
  ) {}

  @Post()
  @RequirePermissions('lab.orders.write')
  createOrder(
    @Body() dto: CreateLabOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.lab.createOrder(dto, user);
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
  @RequirePermissions('lab.results.write')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLabOrderStatusDto,
  ): Promise<Record<string, unknown>> {
    return this.lab.updateStatus(id, dto);
  }

  /**
   * A file straight off the bench — an analyser printout, a scanned form. Stored
   * as a patient document (it IS the patient's), linked to this order so the
   * order can show it, and visible in the patient's Hujjatlar like any other.
   */
  @Post(':id/attachments')
  @RequirePermissions('lab.results.write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024 },
    }),
  )
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('title') title: string | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    if (!file) throw new BadRequestException('file is required');
    const order = await this.lab.getOrder(id);
    const cleanTitle = (title ?? '').trim() || file.originalname;
    return this.documents.upload(
      order['patientId'] as string,
      { buffer: file.buffer, originalname: file.originalname },
      { category: 'ANALYSIS', title: cleanTitle.slice(0, 200) },
      user.id,
      id,
    );
  }

  @Get(':id/attachments/:documentId/download')
  @RequirePermissions('lab.orders.read')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await this.lab.requireAttachment(id, documentId);
    const file = await this.documents.download(documentId);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
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

  /** The result as a file — the same PDF the patient gets in the portal and the bot. */
  @Get(':id/pdf')
  @RequirePermissions('lab.orders.read')
  async pdf(
    @Param('id') id: string,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const payload = (await this.lab.printPayload(id)) as unknown as ResultPdfData & {
      order: { orderNumber: string };
    };
    const loc: PdfLocale = locale === 'ru' || locale === 'en' ? locale : 'uz';
    const buffer = await this.pdf_.render(payload, loc);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="natija-${payload.order.orderNumber}.pdf"`,
    });
  }
}
