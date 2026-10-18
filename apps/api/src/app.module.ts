import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';

import { AppConfigModule } from './core/config/app-config.module';
import { AppConfigService } from './core/config/app-config.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';
import { RedisService } from './core/redis/redis.service';
import { RealtimeModule } from './core/realtime/realtime.module';
import { AuditModule } from './core/audit/audit.module';
import { SequenceModule } from './core/sequence/sequence.module';
import { StorageModule } from './core/storage/storage.module';
import { PrincipalModule } from './core/principal/principal.module';
import { SubscriptionModule } from './core/subscription/subscription.module';
import { ProvisioningModule } from './core/provisioning/provisioning.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HealthController } from './health.controller';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ClinicsModule } from './modules/clinics/clinics.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { QueueModule } from './modules/queue/queue.module';
import { ClinicalOrdersModule } from './modules/clinical-orders/clinical-orders.module';
import { VisitsModule } from './modules/visits/visits.module';
import { ServicesModule } from './modules/services/services.module';
import { BillingModule } from './modules/billing/billing.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { SurgeriesModule } from './modules/surgeries/surgeries.module';
import { LabModule } from './modules/lab/lab.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StaffModule } from './modules/staff/staff.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { AuditViewerModule } from './modules/audit-viewer/audit-viewer.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { PortalModule } from './modules/portal/portal.module';
import { RecordAccessModule } from './modules/record-access/record-access.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.isProd ? 'info' : 'debug',
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
          // Medical data: never log request/response bodies or PHI-bearing headers.
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie'],
            remove: true,
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url?.split('?')[0],
            }),
          },
          transport: config.isProd
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): JwtModuleOptions => ({
        privateKey: config.jwtPrivateKey,
        publicKey: config.jwtPublicKey,
        signOptions: {
          algorithm: 'RS256',
          expiresIn: config.env.JWT_ACCESS_TTL as unknown as number,
        },
        verifyOptions: { algorithms: ['RS256'] },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage: new ThrottlerStorageRedisService(redis.createClient('throttler')),
      }),
    }),
    BullModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        connection: redis.createClient('bullmq'),
      }),
    }),
    PrismaModule,
    RedisModule,
    RealtimeModule,
    AuditModule,
    SequenceModule,
    StorageModule,
    PrincipalModule,
    SubscriptionModule,
    ProvisioningModule,
    // Features
    AuthModule,
    UsersModule,
    ClinicsModule,
    PatientsModule,
    AppointmentsModule,
    QueueModule,
    VisitsModule,
    ClinicalOrdersModule,
    ServicesModule,
    BillingModule,
    AdmissionsModule,
    SurgeriesModule,
    LabModule,
    NotificationsModule,
    ReportsModule,
    StaffModule,
    FeedbackModule,
    AuditViewerModule,
    ...(process.env.SINGLE_CLINIC_MODE === 'false' ? [SuperAdminModule] : []),
    RecordAccessModule,
    AiModule,
    PortalModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Last: permissions decide first, so a caller who may not touch the endpoint
    // at all gets a plain 403 instead of leaking the clinic's billing state.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
