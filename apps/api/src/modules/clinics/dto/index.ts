import { createZodDto } from 'nestjs-zod';
import {
  clinicSettingsSchema,
  createBranchSchema,
  createRoomSchema,
  paginationQuerySchema,
  updateBranchSchema,
  updateClinicSchema,
  updateRoomSchema,
} from '@avishifo/shared';

export class UpdateClinicDto extends createZodDto(updateClinicSchema) {}
export class UpdateClinicSettingsDto extends createZodDto(clinicSettingsSchema) {}

export class CreateBranchDto extends createZodDto(createBranchSchema) {}
export class UpdateBranchDto extends createZodDto(updateBranchSchema) {}

export class CreateRoomDto extends createZodDto(createRoomSchema) {}
export class UpdateRoomDto extends createZodDto(updateRoomSchema) {}

export class ListQueryDto extends createZodDto(paginationQuerySchema) {}
