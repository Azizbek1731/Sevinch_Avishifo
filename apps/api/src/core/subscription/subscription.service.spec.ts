import { describe, expect, it, vi } from 'vitest';
import { SubscriptionService, NO_SUBSCRIPTION } from './subscription.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { AppConfigService } from '../config/app-config.service';

describe('single-clinic subscription state', () => {
  it('ignores an expired SaaS subscription without querying Redis or the database', async () => {
    const findFirst = vi.fn();
    const get = vi.fn();
    const prisma = { unscoped: { clinicSubscription: { findFirst } } } as unknown as PrismaService;
    const redis = { client: { get } } as unknown as RedisService;
    const config = { env: { SINGLE_CLINIC_MODE: true } } as unknown as AppConfigService;
    const service = new SubscriptionService(prisma, redis, config);

    expect(await service.getState('clinic')).toEqual(NO_SUBSCRIPTION);
    expect(get).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('still enforces expiry when SaaS mode is explicitly enabled', async () => {
    const get = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...NO_SUBSCRIPTION,
        status: 'TRIAL',
        isTrial: true,
        endsAt: '2000-01-01T00:00:00Z',
      }),
    );
    const prisma = {} as PrismaService;
    const redis = { client: { get } } as unknown as RedisService;
    const config = { env: { SINGLE_CLINIC_MODE: false } } as unknown as AppConfigService;
    const service = new SubscriptionService(prisma, redis, config);

    expect(await service.getState('clinic')).toMatchObject({ isExpired: true, daysLeft: 0 });
  });
});
