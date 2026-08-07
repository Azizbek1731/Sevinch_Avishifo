import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * M1 — Auth: staff login (phone/email + password), refresh-token rotation with
 * reuse detection, session management, password change/reset (OTP, log mode),
 * and an opt-in Telegram second factor.
 * Relies on global core modules (Prisma, Config, Audit, Principal, Jwt).
 */
@Module({
  // NotificationsModule supplies TelegramChannel for delivering 2FA codes.
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, TwoFactorService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
