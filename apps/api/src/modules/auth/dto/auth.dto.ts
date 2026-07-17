import { createZodDto } from 'nestjs-zod';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  requestPasswordResetSchema,
  resetPasswordWithOtpSchema,
} from '@avishifo/shared';

export class LoginDto extends createZodDto(loginSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class RequestPasswordResetDto extends createZodDto(requestPasswordResetSchema) {}
export class ResetPasswordWithOtpDto extends createZodDto(resetPasswordWithOtpSchema) {}
