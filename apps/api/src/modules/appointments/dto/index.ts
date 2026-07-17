import { createZodDto } from 'nestjs-zod';
import {
  appointmentQuerySchema,
  changeAppointmentStatusSchema,
  createAppointmentSchema,
  createRecurringAppointmentSchema,
  slotsQuerySchema,
  updateAppointmentSchema,
} from '@avishifo/shared';

export class CreateAppointmentDto extends createZodDto(createAppointmentSchema) {}
export class UpdateAppointmentDto extends createZodDto(updateAppointmentSchema) {}
export class ChangeAppointmentStatusDto extends createZodDto(changeAppointmentStatusSchema) {}
export class AppointmentQueryDto extends createZodDto(appointmentQuerySchema) {}
export class SlotsQueryDto extends createZodDto(slotsQuerySchema) {}
export class CreateRecurringAppointmentDto extends createZodDto(createRecurringAppointmentSchema) {}
