import { createZodDto } from "nestjs-zod";
import {
  addSurgeryEntriesSchema,
  addSurgeryStaffFeesSchema,
  createSurgerySchema,
  surgeryQuerySchema,
  surgerySelectorQuerySchema,
} from "@avishifo/shared";

export class CreateSurgeryDto extends createZodDto(createSurgerySchema) {}
export class AddSurgeryEntriesDto extends createZodDto(
  addSurgeryEntriesSchema,
) {}
export class AddSurgeryStaffFeesDto extends createZodDto(
  addSurgeryStaffFeesSchema,
) {}
export class SurgeryQueryDto extends createZodDto(surgeryQuerySchema) {}
export class SurgerySelectorQueryDto extends createZodDto(
  surgerySelectorQuerySchema,
) {}
