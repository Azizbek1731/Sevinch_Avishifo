import { createZodDto } from 'nestjs-zod';
import {
  ambulatoryCaseQuerySchema,
  ambulatoryCommissionQuerySchema,
  ambulatoryLabOrderSchema,
  ambulatoryRatesSchema,
  ambulatoryServiceOrderSchema,
  ambulatoryUziOrderSchema,
  openAmbulatoryCaseSchema,
  updateAmbulatoryCaseSchema,
} from '@avishifo/shared';

export class OpenAmbulatoryCaseDto extends createZodDto(openAmbulatoryCaseSchema) {}
export class UpdateAmbulatoryCaseDto extends createZodDto(updateAmbulatoryCaseSchema) {}
export class AmbulatoryCaseQueryDto extends createZodDto(ambulatoryCaseQuerySchema) {}
export class AmbulatoryLabOrderDto extends createZodDto(ambulatoryLabOrderSchema) {}
export class AmbulatoryUziOrderDto extends createZodDto(ambulatoryUziOrderSchema) {}
export class AmbulatoryServiceOrderDto extends createZodDto(ambulatoryServiceOrderSchema) {}
export class AmbulatoryCommissionQueryDto extends createZodDto(ambulatoryCommissionQuerySchema) {}
export class AmbulatoryRatesDto extends createZodDto(ambulatoryRatesSchema) {}
