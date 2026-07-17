import { z } from 'zod';
import { Locale, UserRole, UserStatus } from '../enums';
import { idSchema, paginationQuerySchema, phoneSchema } from './common';

/** Roles assignable by clinic admins — SUPER_ADMIN and PATIENT are excluded. */
export const staffRoleSchema = z.enum([
  UserRole.CLINIC_OWNER,
  UserRole.CLINIC_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.CASHIER,
  UserRole.LAB_TECH,
  UserRole.ACCOUNTANT,
]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const createUserSchema = z.object({
  fullName: z.string().min(1),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  password: z.string().min(8),
  role: staffRoleSchema,
  branchIds: z.array(idSchema),
  locale: z.nativeEnum(Locale).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().extend({
  status: z.nativeEnum(UserStatus).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userQuerySchema = paginationQuerySchema.extend({
  role: staffRoleSchema.optional(),
  status: z.nativeEnum(UserStatus).optional(),
  branchId: idSchema.optional(),
  search: z.string().min(1).optional(),
});
export type UserQueryInput = z.infer<typeof userQuerySchema>;

/** User.permissionOverrides JSON: { grant: [...], revoke: [...] }. */
export const permissionOverridesSchema = z.object({
  grant: z.array(z.string().min(1)).default([]),
  revoke: z.array(z.string().min(1)).default([]),
});
export type PermissionOverridesInput = z.infer<typeof permissionOverridesSchema>;
