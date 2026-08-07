import { createZodDto } from 'nestjs-zod';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerClinicSchema,
  requestPasswordResetSchema,
  resetPasswordWithOtpSchema,
  setTwoFactorSchema,
  telegramLoginRequestSchema,
  telegramLoginVerifySchema,
  verifyTwoFactorSchema,
} from '@avishifo/shared';

export class LoginDto extends createZodDto(loginSchema) {}
export class RegisterClinicDto extends createZodDto(registerClinicSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class RequestPasswordResetDto extends createZodDto(requestPasswordResetSchema) {}
export class ResetPasswordWithOtpDto extends createZodDto(resetPasswordWithOtpSchema) {}

export class VerifyTwoFactorDto extends createZodDto(verifyTwoFactorSchema) {}
export class SetTwoFactorDto extends createZodDto(setTwoFactorSchema) {}

export class TelegramLoginRequestDto extends createZodDto(telegramLoginRequestSchema) {}
export class TelegramLoginVerifyDto extends createZodDto(telegramLoginVerifySchema) {}
