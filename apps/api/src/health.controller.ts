import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './common/decorators';
import { PrismaService } from './core/prisma/prisma.service';
import { RedisService } from './core/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; db: boolean; redis: boolean }> {
    const [db, redis] = await Promise.all([
      this.prisma.unscoped.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.client.ping().then(
        (r) => r === 'PONG',
        () => false,
      ),
    ]);
    const ok = db && redis;
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'degraded', db, redis };
  }
}
