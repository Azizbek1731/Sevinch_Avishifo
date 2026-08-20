import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ErrorCode, UPLOAD_LIMITS } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '@avishifo/shared';
import { PatientsService } from './patients.service';
import { DocumentsService } from './documents.service';
import { TimelineService } from './timeline.service';
import { AddConsentDto, CreatePatientDto, CreatePatientQueryDto, DocumentMetaDto, MergePatientsDto, PaginationQueryDto, PatientQueryDto, PatientTimelineQueryDto, UpdatePatientDto } from './dto';

/** RFC-safe ASCII filename for Content-Disposition. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly documents: DocumentsService,
    private readonly timeline: TimelineService,
  ) {}

  @Get()
  @RequirePermissions('patients.read')
  list(@Query() query: PatientQueryDto, @CurrentUser() user: AuthUser) {
    return this.patients.list(query, user);
  }

  @Post()
  @RequirePermissions('patients.write')
  create(@Body() body: CreatePatientDto, @Query() query: CreatePatientQueryDto) {
    return this.patients.create(body, query.force === 'true');
  }

  @Post('merge')
  @RequirePermissions('patients.merge')
  merge(@Body() body: MergePatientsDto) {
    return this.patients.merge(body);
  }

  // ------------------------------------------------------------- documents

  @Get('documents/:docId/download')
  @RequirePermissions('patients.read')
  async downloadDocument(@Param('docId') docId: string): Promise<StreamableFile> {
    const { stream, mimeType, fileName } = await this.documents.download(docId);
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `attachment; filename="${safeFileName(fileName)}"`,
    });
  }

  @Delete('documents/:docId')
  @RequirePermissions('patients.documents.write')
  removeDocument(@Param('docId') docId: string) {
    return this.documents.remove(docId);
  }

  @Post(':id/documents')
  @RequirePermissions('patients.documents.write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024 },
    }),
  )
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() meta: DocumentMetaDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Multipart "file" field is required', 400);
    }
    return this.documents.upload(id, file, meta, user.id);
  }

  @Get(':id/documents')
  @RequirePermissions('patients.read')
  listDocuments(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.documents.list(id, query);
  }

  // ------------------------------------------------------------- consents

  @Post(':id/consents')
  @RequirePermissions('patients.write')
  addConsent(@Param('id') id: string, @Body() body: AddConsentDto) {
    return this.patients.addConsent(id, body);
  }

  @Get(':id/consents')
  @RequirePermissions('patients.read')
  listConsents(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.patients.listConsents(id, query);
  }

  // ------------------------------------------------------------- timeline

  @Get(':id/timeline')
  @RequirePermissions('patients.read')
  getTimeline(@Param('id') id: string, @Query() query: PatientTimelineQueryDto) {
    return this.timeline.getTimeline(id, query);
  }

  // ------------------------------------------------------------- card CRUD

  @Get(':id')
  @RequirePermissions('patients.read')
  getById(@Param('id') id: string) {
    return this.patients.getById(id);
  }

  @Patch(':id')
  @RequirePermissions('patients.write')
  update(@Param('id') id: string, @Body() body: UpdatePatientDto) {
    return this.patients.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('patients.delete')
  softDelete(@Param('id') id: string) {
    return this.patients.softDelete(id);
  }
}
