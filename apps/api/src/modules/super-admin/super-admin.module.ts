import { Module } from '@nestjs/common';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

/**
 * M17 — platform super-admin panel: tenant (clinic) management, subscription
 * plans, feature flags, platform analytics and owner impersonation.
 * PrismaModule/AuditModule are @Global and JwtModule is registered globally,
 * so no extra imports are needed here.
 */
@Module({
  controllers: [SuperAdminController],
  providers: [SuperAdminService],
})
export class SuperAdminModule {}
