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

/**
 * Public self-service sign-up: a clinic director creates the clinic and becomes
 * its CLINIC_OWNER, starting a free trial. No verification step — the platform
 * super-admin reviews and can suspend abusive registrations.
 */
export const registerClinicSchema = z.object({
  clinicName: z.string().min(2).max(120),
  fullName: z.string().min(2).max(120),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: z.string().min(8),
  locale: z.nativeEnum(Locale).optional(),
});
export type RegisterClinicInput = z.infer<typeof registerClinicSchema>;

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  locale: z.nativeEnum(Locale).optional(),
  avatarUrl: z.string().url().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Second step of a two-factor login. The password step returns a challengeId
 * instead of tokens; the 6-digit code is delivered to the user's linked Telegram
 * chat. The challenge is single-use and short-lived (see AUTH_2FA_TTL_SECONDS).
 */
export const verifyTwoFactorSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, { message: 'Code must be 6 digits' }),
});
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;

/**
 * Turning the Telegram second factor on requires a linked chat — enabling it
 * blind would lock the user out on their next login.
 */
export const setTwoFactorSchema = z.object({
  enabled: z.boolean(),
});
export type SetTwoFactorInput = z.infer<typeof setTwoFactorSchema>;

/**
 * Passwordless staff sign-in: the phone identifies the account and the code
 * arrives in its linked Telegram chat. Email is deliberately not accepted here —
 * the flow only works for an account bound to a chat, and the phone is what the
 * bot binding is built around.
 */
export const telegramLoginRequestSchema = z.object({
  phone: phoneSchema,
});
export type TelegramLoginRequestInput = z.infer<typeof telegramLoginRequestSchema>;

/**
 * Second step of the passwordless sign-in — same shape as the two-factor step,
 * but the challenges are not interchangeable: each is tagged with the flow that
 * issued it, so a code meant for one step cannot complete the other.
 */
export const telegramLoginVerifySchema = verifyTwoFactorSchema;
export type TelegramLoginVerifyInput = VerifyTwoFactorInput;

/** How long a pending 2FA challenge stays valid. */
export const AUTH_2FA_TTL_SECONDS = 300;
/** Wrong codes tolerated before the challenge is burned. */
export const AUTH_2FA_MAX_ATTEMPTS = 5;
