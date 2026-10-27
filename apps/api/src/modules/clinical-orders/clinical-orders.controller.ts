import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { UPLOAD_LIMITS, type AuthUser } from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import { DocumentsService } from '../patients/documents.service';
import { ClinicalOrdersService } from './clinical-orders.service';
import { AddClinicalServicesDto, ClinicalOrderQueryDto, CreateClinicalOrderDto } from './dto';

@ApiTags('clinical-orders')
@Controller('clinical-orders')
export class ClinicalOrdersController {
  constructor(
    private readonly orders: ClinicalOrdersService,
    private readonly documents: DocumentsService,
  ) {}

  @Get()
  @RequirePermissions('patients.read')
  list(
    @Query() query: ClinicalOrderQueryDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.list(query, user, branchId);
  }

  @Get('status-counts')
  @RequirePermissions('patients.read')
  statusCounts(
    @Query('kind') kind: 'CONSULTATION' | 'ULTRASOUND' | undefined,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.statusCounts(user, branchId, kind ?? 'ULTRASOUND');
  }

  @Post()
  @RequirePermissions('invoices.write')
  create(
    @Body() dto: CreateClinicalOrderDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.create(dto, user, branchId);
  }

  @Get('doctors')
  @RequirePermissions('services.read')
  doctors(@CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.orders.doctors(user, branchId);
  }

  @Get(':id')
  @RequirePermissions('patients.read')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.orders.get(id, user, branchId);
  }

  @Post(':id/start')
  @RequirePermissions('visits.write')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser, @ActiveBranch() branchId: string) {
    return this.orders.start(id, user, branchId);
  }

  @Post(':id/services')
  @RequirePermissions('visits.write')
  addServices(
    @Param('id') id: string,
    @Body() dto: AddClinicalServicesDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.orders.addServices(id, dto, user, branchId);
  }

  /** UZI snimok / PDF — bemor hujjatlariga yoziladi va buyurtmaga bog‘lanadi. */
  @Post(':id/attachments')
  @RequirePermissions('visits.write')
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
    @ActiveBranch() branchId: string,
  ): Promise<unknown> {
    if (!file) throw new BadRequestException('file is required');
    const order = await this.orders.get(id, user, branchId);
    const patientId = (order as { patient: { id: string } }).patient.id;
    const cleanTitle = (title ?? '').trim() || file.originalname;
    return this.documents.upload(
      patientId,
      { buffer: file.buffer, originalname: file.originalname },
      { category: 'IMAGING', title: cleanTitle.slice(0, 200) },
      user.id,
      undefined,
      id,
    );
  }

  @Get(':id/attachments/:documentId/download')
  @RequirePermissions('patients.read')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await this.orders.requireAttachment(id, documentId, user, branchId);
    const file = await this.documents.download(documentId);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}
