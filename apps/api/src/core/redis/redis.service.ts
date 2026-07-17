import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  /** General-purpose client (cache, rate limits, locks). */
  readonly client: Redis;

  constructor(private readonly config: AppConfigService) {
    this.client = this.createClient('main');
  }

  /** New dedicated connection (Socket.IO adapter pub/sub, BullMQ, etc.). */
  createClient(name: string): Redis {
    const client = new Redis(this.config.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    client.on('error', (err) => this.logger.error(`redis[${name}]: ${err.message}`));
    return client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
