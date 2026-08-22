import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { fromBuffer } from 'file-type';
import sharp from 'sharp';
import type { PatientDocument, Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  UPLOAD_LIMITS,
  type DocumentMetaInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { StorageService } from '../../core/storage/storage.service';
import { PatientsService } from './patients.service';

/** Raster images are re-encoded (EXIF-rotated, stripped) to JPEG for safety. */
const REENCODE_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export interface DocumentResponse {
  id: string;
  patientId: string;
  category: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DocumentDownload {
  stream: Readable;
  mimeType: string;
  fileName: string;
}

function mapDocument(d: PatientDocument): DocumentResponse {
  return {
    id: d.id,
    patientId: d.patientId,
    category: d.category,
    title: d.title,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    createdAt: d.createdAt.toISOString(),
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
  ) {}

  async upload(
    patientId: string,
    file: { buffer: Buffer; originalname: string },
    meta: DocumentMetaInput,
    uploadedById: string,
    /** Set when the file is a lab attachment, so the order lists its own files. */
    labOrderId?: string,
  ): Promise<DocumentResponse> {
    await this.patients.requirePatient(patientId);

    // Validate the REAL content type by magic bytes — never trust the client mimetype.
    const detected = await fromBuffer(file.buffer);
    if (!detected || !UPLOAD_LIMITS.ALLOWED_MIME.includes(detected.mime)) {
      throw new AppException(
        ErrorCode.FILE_TYPE_NOT_ALLOWED,
        `File type not allowed; allowed: ${UPLOAD_LIMITS.ALLOWED_MIME.join(', ')}`,
        415,
      );
    }

    let buffer = file.buffer;
    let mimeType: string = detected.mime;
    let ext = `.${detected.ext}`;
    if (REENCODE_IMAGE_MIME.has(detected.mime)) {
      buffer = await sharp(file.buffer).rotate().jpeg({ quality: 85 }).toBuffer();
      mimeType = 'image/jpeg';
      ext = '.jpg';
    }

    const clinicId = TenantContext.requireClinicId();
    const key = `${clinicId}/patients/${randomUUID()}${ext}`;
    await this.storage.put(key, buffer);

    const doc = await this.prisma.db.patientDocument.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId,
        patientId,
        category: meta.category,
        title: meta.title,
        fileKey: key,
        fileName: file.originalname,
        mimeType,
        sizeBytes: buffer.length,
        uploadedById,
        labOrderId: labOrderId ?? null,
      },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'PatientDocument',
      entityId: doc.id,
      after: {
        patientId,
        category: doc.category,
        title: doc.title,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
      },
    });

    return mapDocument(doc);
  }

  async list(
    patientId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult<DocumentResponse>> {
    await this.patients.requirePatient(patientId);
    const { skip, take } = skipTake(query);
    const where: Prisma.PatientDocumentWhereInput = { patientId };
    const [items, total] = await Promise.all([
      this.prisma.db.patientDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.db.patientDocument.count({ where }),
    ]);
    return paginated(items.map(mapDocument), { page: query.page, limit: query.limit, total });
  }

  async download(docId: string): Promise<DocumentDownload> {
    // prisma.db re-verifies tenant ownership before any bytes are streamed.
    const doc = await this.prisma.db.patientDocument.findFirst({ where: { id: docId } });
    if (!doc) throw new AppException(ErrorCode.NOT_FOUND, 'Document not found', 404);
    return {
      stream: this.storage.getStream(doc.fileKey),
      mimeType: doc.mimeType,
      fileName: doc.fileName,
    };
  }

  async remove(docId: string): Promise<{ id: string }> {
    const doc = await this.prisma.db.patientDocument.findFirst({ where: { id: docId } });
    if (!doc) throw new AppException(ErrorCode.NOT_FOUND, 'Document not found', 404);

    await this.prisma.db.patientDocument.delete({ where: { id: docId } });
    await this.storage.delete(doc.fileKey);

    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'PatientDocument',
      entityId: docId,
      before: { patientId: doc.patientId, title: doc.title, fileName: doc.fileName },
    });

    return { id: docId };
  }
}
