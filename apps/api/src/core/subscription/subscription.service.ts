import { Injectable, Logger } from '@nestjs/common';
import type { ClinicSubscription, SubscriptionPlan } from '@prisma/client';
import { SubscriptionStatus } from '@avishifo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** Statuses that represent a subscription the clinic is currently living on. */
const LIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

/**
 * Cache TTL. Short on purpose: a super-admin extending a trial must take effect
 * almost immediately, and the key is invalidated explicitly on every write.
 */
const CACHE_TTL_SECONDS = 30;
const cacheKey = (clinicId: string): string => `subscription:state:${clinicId}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the clinic's plan lets it do right now. */
export interface SubscriptionState {
  status: SubscriptionStatus | null;
  planCode: string | null;
  planName: string | null;
  startsAt: string | null;
  /** null = perpetual (a paid plan with no end date). */
  endsAt: string | null;
  /** Whole days until endsAt; 0 once lapsed; null when perpetual/absent. */
  daysLeft: number | null;
  isTrial: boolean;
  /** endsAt is in the past — the clinic is read-only. */
  isExpired: boolean;
}

export const NO_SUBSCRIPTION: SubscriptionState = {
  status: null,
  planCode: null,
  planName: null,
  startsAt: null,
  endsAt: null,
  daysLeft: null,
  isTrial: false,
  isExpired: false,
};

type SubscriptionWithPlan = ClinicSubscription & { plan: SubscriptionPlan };

/**
 * The single source of truth for "what is this clinic's subscription right now".
 *
 * Expiry is DERIVED from `endsAt`, never written into `status`: flipping an
 * expired trial out of TRIAL/ACTIVE would silently disable the plan seat limit
 * in UsersService.assertPlanUserLimit (which treats "no live subscription" as
 * "no limit"), handing expired clinics unlimited staff.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Days from `now` to `endsAt`, rounded up; 0 once lapsed. */
  private daysLeft(endsAt: Date | null, now: Date): number | null {
    if (!endsAt) return null;
    const diff = endsAt.getTime() - now.getTime();
    return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
  }

  private toState(sub: SubscriptionWithPlan | null, now: Date): SubscriptionState {
    if (!sub) return NO_SUBSCRIPTION;
    const status = sub.status as SubscriptionStatus;
    return {
      status,
      planCode: sub.plan.code,
      planName: sub.plan.name,
      startsAt: sub.startsAt.toISOString(),
      endsAt: sub.endsAt ? sub.endsAt.toISOString() : null,
      daysLeft: this.daysLeft(sub.endsAt, now),
      isTrial: status === SubscriptionStatus.TRIAL,
      isExpired: sub.endsAt !== null && sub.endsAt.getTime() <= now.getTime(),
    };
  }

  /**
   * The clinic's current subscription row — the newest LIVE one.
   *
   * prisma.unscoped justified: this runs from the auth guard (before any tenant
   * context exists) and from platform scope, always with an explicit clinicId.
   */
  async currentSubscription(clinicId: string): Promise<SubscriptionWithPlan | null> {
    return this.prisma.unscoped.clinicSubscription.findFirst({
      where: { clinicId, status: { in: LIVE_STATUSES } },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      include: { plan: true },
    });
  }

  /** Cached subscription state for a clinic. Never throws — falls back to a DB read. */
  async getState(clinicId: string): Promise<SubscriptionState> {
    const key = cacheKey(clinicId);
    try {
      const cached = await this.redis.client.get(key);
      if (cached) {
        const state = JSON.parse(cached) as SubscriptionState & { endsAt: string | null };
        // Re-derive the time-dependent fields so a cached entry cannot keep a
        // clinic alive past its end date for the length of the TTL.
        const now = new Date();
        const endsAt = state.endsAt ? new Date(state.endsAt) : null;
        return {
          ...state,
          daysLeft: this.daysLeft(endsAt, now),
          isExpired: endsAt !== null && endsAt.getTime() <= now.getTime(),
        };
      }
    } catch (err) {
      this.logger.warn(`subscription cache read failed: ${(err as Error).message}`);
    }

    const sub = await this.currentSubscription(clinicId);
    const state = this.toState(sub, new Date());
    try {
      await this.redis.client.set(key, JSON.stringify(state), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`subscription cache write failed: ${(err as Error).message}`);
    }
    return state;
  }

  /** Drop the cached state after any subscription write. */
  async invalidate(clinicId: string): Promise<void> {
    try {
      await this.redis.client.del(cacheKey(clinicId));
    } catch (err) {
      this.logger.warn(`subscription cache invalidation failed: ${(err as Error).message}`);
    }
  }
}
