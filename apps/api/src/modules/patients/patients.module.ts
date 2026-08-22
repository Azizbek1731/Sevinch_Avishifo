import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { DocumentsService } from './documents.service';
import { TimelineService } from './timeline.service';

/**
 * M3 — Patient Management: registry + trigram search, fast registration with
 * duplicate detection & merge, documents, consents, medical-history timeline.
 * Core providers (Prisma, Audit, Sequence, Storage) are global modules.
 */
@Module({
  controllers: [PatientsController],
  providers: [PatientsService, DocumentsService, TimelineService],
  exports: [PatientsService, DocumentsService],
})
export class PatientsModule {}
