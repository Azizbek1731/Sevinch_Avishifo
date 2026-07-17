import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfigService } from './core/config/app-config.service';
import { RedisIoAdapter } from './core/realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // Socket.IO with Redis adapter for horizontal scaling (spec §10).
  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  if (!config.isProd) {
    const doc = new DocumentBuilder()
      .setTitle('AviShifo API')
      .setDescription('Clinic CRM/HIS REST API. Envelope: { success, data, meta? } | { success:false, error }')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(SwaggerModule.createDocument(app, doc)));
  }

  await app.listen(config.env.API_PORT);
}

void bootstrap();
