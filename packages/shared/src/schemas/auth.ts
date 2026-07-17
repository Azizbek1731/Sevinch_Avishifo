import { z } from 'zod';
import { Locale } from '../enums';
import { phoneSchema } from './common';

/** Login identifier: normalized phone (+998XXXXXXXXX) or email. */
export const loginIdentifierSchema = z.union([phoneSchema, z.string().email()]);

export const loginSchema = z.object({
  identifier: loginIdentifierSchema,
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Refresh token normally travels in the httpOnly cookie — an empty body is valid. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const requestPasswordResetSchema = z.object({
  phone: phoneSchema,
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordWithOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{6}$/, { message: 'OTP must be 6 digits' }),
  newPassword: z.string().min(8),
});
export type ResetPasswordWithOtpInput = z.infer<typeof resetPasswordWithOtpSchema>;

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  locale: z.nativeEnum(Locale).optional(),
  avatarUrl: z.string().url().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
