import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import { DocumentsService } from '../patients/documents.service';
import { VisitsService } from './visits.service';
import {
  AddDiagnosisDto,
  AddPrescriptionDto,
  AddReferralDto,
  AmendVisitDto,
  CompleteVisitDto,
  CreateVisitDto,
  PaginationQueryDto,
  ReplacePrescriptionsDto,
  UpdateVisitDto,
  UpsertVitalsDto,
  VisitQueryDto,
  VisitTemplatePatchDto,
  VisitTemplateUpsertDto,
} from './dto';

@ApiTags('visits')
@Controller('visits')
export class VisitsController {
  constructor(
    private readonly visits: VisitsService,
    private readonly documents: DocumentsService,
  ) {}

  @Post()
  @RequirePermissions('visits.write')
  create(
    @Body() dto: CreateVisitDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ): Promise<Record<string, unknown>> {
    return this.visits.create(dto, user, branchId);
  }

  @Get()
  @RequirePermissions('visits.read')
  list(
    @Query() query: VisitQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<unknown>> {
    return this.visits.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('visits.read')
  getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.getById(id, user);
  }

  @Get(':id/history')
  @RequirePermissions('visits.read')
  history(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.visits.history(id, user);
  }

  @Get(':id/pdf')
  @RequirePermissions('visits.read')
  async pdf(
    @Param('id') id: string,
    @Query('mode') mode: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const reportMode = mode === 'prescription' ? 'prescription' : 'summary';
    const { buffer, disposition } = await this.visits.pdf(id, user, reportMode);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  @Patch(':id')
  @RequirePermissions('visits.write')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.update(id, dto, user);
  }

  @Post(':id/complete')
  @RequirePermissions('visits.write')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteVisitDto = {},
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.complete(id, user, dto ?? {});
  }

  /** External conclusion / empty-visit substitute — stored on the patient folder. */
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
  ): Promise<unknown> {
    if (!file) throw new BadRequestException('file is required');
    const visit = await this.visits.getById(id, user);
    const patientId = (visit as { patient: { id: string } }).patient.id;
    const cleanTitle = (title ?? '').trim() || file.originalname;
    return this.documents.upload(
      patientId,
      { buffer: file.buffer, originalname: file.originalname },
      { category: 'OTHER', title: cleanTitle.slice(0, 200) },
      user.id,
      undefined,
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await this.visits.requireVisitAttachment(id, documentId, user);
    const file = await this.documents.download(documentId);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }

  @Post(':id/amendments')
  @RequirePermissions('visits.amend')
  amend(
    @Param('id') id: string,
    @Body() dto: AmendVisitDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.amend(id, dto, user);
  }

  @Get(':id/amendments')
  @RequirePermissions('visits.read')
  listAmendments(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<unknown>> {
    return this.visits.listAmendments(id, query, user);
  }

  @Put(':id/vitals')
  @RequirePermissions('visits.write')
  upsertVitals(
    @Param('id') id: string,
    @Body() dto: UpsertVitalsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown> | null> {
    return this.visits.upsertVitals(id, dto, user);
  }

  @Post(':id/diagnoses')
  @RequirePermissions('visits.write')
  addDiagnosis(
    @Param('id') id: string,
    @Body() dto: AddDiagnosisDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.addDiagnosis(id, dto, user);
  }

  @Delete(':id/diagnoses/:dxId')
  @RequirePermissions('visits.write')
  removeDiagnosis(
    @Param('id') id: string,
    @Param('dxId') dxId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.visits.removeDiagnosis(id, dxId, user);
  }

  @Post(':id/prescriptions')
  @RequirePermissions('visits.write')
  addPrescription(
    @Param('id') id: string,
    @Body() dto: AddPrescriptionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.addPrescription(id, dto, user);
  }

  @Put(':id/prescriptions')
  @RequirePermissions('visits.write')
  replacePrescriptions(
    @Param('id') id: string,
    @Body() dto: ReplacePrescriptionsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.visits.replacePrescriptions(id, dto, user);
  }

  @Delete(':id/prescriptions/:rxId')
  @RequirePermissions('visits.write')
  removePrescription(
    @Param('id') id: string,
    @Param('rxId') rxId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.visits.removePrescription(id, rxId, user);
  }

  @Post(':id/referrals')
  @RequirePermissions('visits.write')
  addReferral(
    @Param('id') id: string,
    @Body() dto: AddReferralDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.visits.addReferral(id, dto, user);
  }

  @Get(':id/print')
  @RequirePermissions('visits.read')
  print(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.visits.printPayload(id, user);
  }
}

@ApiTags('visits')
@Controller('visit-templates')
export class VisitTemplatesController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  @RequirePermissions('visits.read')
  list(@Query() query: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    return this.visits.listTemplates(query);
  }

  @Post()
  @RequirePermissions('visits.write')
  create(@Body() dto: VisitTemplateUpsertDto): Promise<Record<string, unknown>> {
    return this.visits.createTemplate(dto);
  }

  @Patch(':id')
  @RequirePermissions('visits.write')
  update(
    @Param('id') id: string,
    @Body() dto: VisitTemplatePatchDto,
  ): Promise<Record<string, unknown>> {
    return this.visits.updateTemplate(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('visits.write')
  remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.visits.deleteTemplate(id);
  }
}
