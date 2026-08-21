import { createZodDto } from 'nestjs-zod';
import {
  addChargeSchema,
  admissionQuerySchema,
  admitPatientSchema,
  createOrderSchema,
  dailyNoteSchema,
  dischargeSchema,
  invoiceChargesSchema,
  markAdministrationSchema,
  updateAdmissionSchema,
} from '@avishifo/shared';

export class AdmitPatientDto extends createZodDto(admitPatientSchema) {}
export class UpdateAdmissionDto extends createZodDto(updateAdmissionSchema) {}
export class DischargeDto extends createZodDto(dischargeSchema) {}
export class AdmissionQueryDto extends createZodDto(admissionQuerySchema) {}
export class CreateOrderDto extends createZodDto(createOrderSchema) {}
export class MarkAdministrationDto extends createZodDto(markAdministrationSchema) {}
export class DailyNoteDto extends createZodDto(dailyNoteSchema) {}
export class AddChargeDto extends createZodDto(addChargeSchema) {}
export class InvoiceChargesDto extends createZodDto(invoiceChargesSchema) {}
