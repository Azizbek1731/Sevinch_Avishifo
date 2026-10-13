import { createZodDto } from 'nestjs-zod';
import {
  addClinicalServicesSchema,
  clinicalOrderQuerySchema,
  createClinicalOrderSchema,
} from '@avishifo/shared';
export class CreateClinicalOrderDto extends createZodDto(createClinicalOrderSchema) {}
export class AddClinicalServicesDto extends createZodDto(addClinicalServicesSchema) {}
export class ClinicalOrderQueryDto extends createZodDto(clinicalOrderQuerySchema) {}
