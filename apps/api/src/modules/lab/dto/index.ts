import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  createLabOrderSchema,
  createLabTestSchema,
  enterLabResultsSchema,
  labOrderQuerySchema,
  paginationQuerySchema,
  updateLabOrderStatusSchema,
  updateLabTestSchema,
} from '@avishifo/shared';

/** No shared list-query schema exists for the test catalog — defined locally. */
export const labTestQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1).optional(),
});

export class CreateLabTestDto extends createZodDto(createLabTestSchema) {}
export class UpdateLabTestDto extends createZodDto(updateLabTestSchema) {}
export class LabTestQueryDto extends createZodDto(labTestQuerySchema) {}
export class CreateLabOrderDto extends createZodDto(createLabOrderSchema) {}
export class UpdateLabOrderStatusDto extends createZodDto(updateLabOrderStatusSchema) {}
export class EnterLabResultsDto extends createZodDto(enterLabResultsSchema) {}
export class LabOrderQueryDto extends createZodDto(labOrderQuerySchema) {}
