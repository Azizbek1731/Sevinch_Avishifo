import { Injectable, Logger } from '@nestjs/common';
import {
  AUTH_DOCTOR_PAY_DEFAULT_PIN,
  AUTH_DOCTOR_PAY_UNLOCK_TTL_SECONDS,
  ErrorCode,
  type AuthUser,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';

const unlockKey = (userId: string): string => `doctor-pay:unlocked:${userId}`;

/**
 * Percentage earnings (ambulatory share + performer pay) open only after the
 * doctor's permanent 4-digit pay PIN (default 7777).
 */
@Injectable()
export class DoctorPayGateService {
  private readonly logger = new Logger(DoctorPayGateService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Admins with clinic-wide reports may see pay without the PIN gate. */
  needsUnlock(user: Pick<AuthUser, 'role' | 'permissions'>): boolean {
    if (user.role !== 'DOCTOR') return false;
    if (user.permissions.includes('reports.read')) return false;
    return true;
  }

  private normalizePin(value: string | null | undefined): string {
    const digits = (value ?? '').replace(/\D/g, '');
    if (/^\d{4}$/.test(digits)) return digits;
    return AUTH_DOCTOR_PAY_DEFAULT_PIN;
  }

  async isUnlocked(userId: string): Promise<boolean> {
    return (await this.redis.client.get(unlockKey(userId))) === '1';
  }

  async assertUnlocked(user: AuthUser): Promise<void> {
    if (!this.needsUnlock(user)) return;
    if (await this.isUnlocked(user.id)) return;
    throw new AppException(
      ErrorCode.DOCTOR_PAY_LOCKED,
      'Ulush va maoshni ko‘rish uchun 4 xonali kodni kiriting',
      403,
    );
  }

  async status(user: AuthUser): Promise<{
    required: boolean;
    unlocked: boolean;
    expiresInSeconds: number | null;
    unlockTtlSeconds: number;
  }> {
    const unlockTtlSeconds = AUTH_DOCTOR_PAY_UNLOCK_TTL_SECONDS;
    const required = this.needsUnlock(user);
    if (!required) {
      return {
        required: false,
        unlocked: true,
        expiresInSeconds: null,
        unlockTtlSeconds,
      };
    }
    const unlocked = await this.isUnlocked(user.id);
    const ttl = unlocked ? await this.redis.client.ttl(unlockKey(user.id)) : -1;
    return {
      required: true,
      unlocked,
      expiresInSeconds: ttl > 0 ? ttl : unlocked ? unlockTtlSeconds : null,
      unlockTtlSeconds,
    };
  }

  async verify(user: AuthUser, code: string): Promise<{
    unlocked: boolean;
    expiresInSeconds: number;
  }> {
    if (!this.needsUnlock(user)) {
      return { unlocked: true, expiresInSeconds: AUTH_DOCTOR_PAY_UNLOCK_TTL_SECONDS };
    }
    const row = await this.prisma.db.user.findFirst({
      where: { id: user.id, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, payPin: true },
    });
    if (!row) throw new AppException(ErrorCode.UNAUTHORIZED, 'Unauthorized', 401);
    const expected = this.normalizePin(row.payPin);
    const entered = this.normalizePin(code);
    if (entered !== expected) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Kod noto‘g‘ri', 400);
    }
    await this.redis.client.set(
      unlockKey(user.id),
      '1',
      'EX',
      AUTH_DOCTOR_PAY_UNLOCK_TTL_SECONDS,
    );
    this.logger.log(`Doctor-pay PIN unlocked for ${user.id}`);
    return { unlocked: true, expiresInSeconds: AUTH_DOCTOR_PAY_UNLOCK_TTL_SECONDS };
  }

  async changePin(
    user: AuthUser,
    currentCode: string,
    newCode: string,
  ): Promise<{ changed: boolean }> {
    if (user.role !== 'DOCTOR') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Faqat shifokor kodini o‘zgartirishi mumkin', 403);
    }
    const row = await this.prisma.db.user.findFirst({
      where: { id: user.id, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, payPin: true },
    });
    if (!row) throw new AppException(ErrorCode.UNAUTHORIZED, 'Unauthorized', 401);
    const expected = this.normalizePin(row.payPin);
    if (this.normalizePin(currentCode) !== expected) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Joriy kod noto‘g‘ri', 400);
    }
    const next = this.normalizePin(newCode);
    if (!/^\d{4}$/.test(newCode.replace(/\D/g, ''))) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Yangi kod 4 ta raqam bo‘lishi kerak', 400);
    }
    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { payPin: next },
    });
    this.logger.log(`Doctor-pay PIN changed for ${user.id}`);
    return { changed: true };
  }

  /** Manually close the pay screens until the doctor enters the PIN again. */
  async lock(user: AuthUser): Promise<{ locked: boolean }> {
    if (!this.needsUnlock(user)) return { locked: false };
    await this.redis.client.del(unlockKey(user.id));
    return { locked: true };
  }
}
