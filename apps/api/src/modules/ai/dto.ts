import { createZodDto } from 'nestjs-zod';
import { aiAskSchema } from '@avishifo/shared';

export class AiAskDto extends createZodDto(aiAskSchema) {}
