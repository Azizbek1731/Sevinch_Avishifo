import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * M1 — Auth: staff login (phone/email + password), refresh-token rotation with
 * reuse detection, session management, password change/reset (OTP, log mode).
 * Relies on global core modules (Prisma, Config, Audit, Principal, Jwt).
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
