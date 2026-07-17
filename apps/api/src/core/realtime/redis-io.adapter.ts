import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { INestApplicationContext } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';
import { RedisService } from '../redis/redis.service';
import { AppConfigService } from '../config/app-config.service';

/**
 * Socket.IO adapter with Redis pub/sub so multiple API instances broadcast
 * correctly (spec §10).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private corsOrigins: string[] = [];

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redis = this.app.get(RedisService);
    const config = this.app.get(AppConfigService);
    this.corsOrigins = config.corsOrigins;
    const pubClient = redis.createClient('socket.io-pub');
    const subClient = redis.createClient('socket.io-sub');
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    }) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
