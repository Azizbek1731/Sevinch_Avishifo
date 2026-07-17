import { createZodDto } from 'nestjs-zod';
import {
  createUserSchema,
  permissionOverridesSchema,
  updateUserSchema,
  upsertStaffProfileSchema,
  userQuerySchema,
} from '@avishifo/shared';

/** POST /users — staff creation; optional staff profile in the same call. */
export class CreateUserDto extends createZodDto(
  createUserSchema.extend({ staffProfile: upsertStaffProfileSchema.optional() }),
) {}

/** PATCH /users/:id — profile fields, role, branch reassignment. */
export class UpdateUserDto extends createZodDto(
  updateUserSchema.extend({ staffProfile: upsertStaffProfileSchema.optional() }),
) {}

/** GET /users query filters. */
export class UserQueryDto extends createZodDto(userQuerySchema) {}

/** PATCH /users/:id/status */
export class UpdateUserStatusDto extends createZodDto(
  updateUserSchema.pick({ status: true }).required(),
) {}

/** PATCH /users/:id/permission-overrides */
export class PermissionOverridesDto extends createZodDto(permissionOverridesSchema) {}
