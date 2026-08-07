import { createZodDto } from 'nestjs-zod';
import {
  decideRecordAccessSchema,
  recordAccessListQuerySchema,
  requestRecordAccessSchema,
} from '@avishifo/shared';

export class RecordAccessListQueryDto extends createZodDto(recordAccessListQuerySchema) {}
export class DecideRecordAccessDto extends createZodDto(decideRecordAccessSchema) {}
export class RequestRecordAccessDto extends createZodDto(requestRecordAccessSchema) {}
