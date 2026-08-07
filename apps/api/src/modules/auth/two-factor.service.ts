import { Injectable, Logger } from '@nestjs/common';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { AUTH_2FA_MAX_ATTEMPTS, AUTH_2FA_TTL_SECONDS, ErrorCode } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { RedisService } from '../../core/redis/redis.service';
import { TelegramChannel } from '../notifications/channels/telegram.channel';

interface Challenge {
  userId: string;
  code: string;
  attempts: number;
}

const key = (id: string): string => `auth:2fa:${id}`;

/**
 * Telegram second factor for staff and super-admin logins.
 *
 * Opt-in per user, and only effective once a Telegram chat is linked — enabling
 * it without a chat would lock the account out, so `isRequiredFor` checks both.
 *
 * Challenges live in Redis, not the database: they expire in minutes, must
 * vanish on their own, and a login attempt should never leave a row behind.
 * Losing Redis costs pending logins, nothing more — the user retries.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly telegram: TelegramChannel,
  ) {}

  /**
   * A user is challenged only when they asked for it AND can actually receive
   * the code. The second half of that condition is what keeps the feature from
   * ever locking anyone out.
   */
  isRequiredFor(user: { twoFactorEnabled: boolean; telegramChatId: string | null }): boolean {
    return user.twoFactorEnabled && !!user.telegramChatId;
  }

  /**
   * Sends the code and returns the challenge id. If Telegram delivery fails the
   * challenge is discarded and the caller gets a hard error rather than a
   * challenge nobody can answer.
   */
  async issue(userId: string, chatId: string, fullName: string): Promise<{
    challengeId: string;
    expiresInSeconds: number;
  }> {
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.redis.client.set(
      key(challengeId),
      JSON.stringify({ userId, code, attempts: 0 } satisfies Challenge),
      'EX',
      AUTH_2FA_TTL_SECONDS,
    );

    const minutes = Math.round(AUTH_2FA_TTL_SECONDS / 60);
    try {
      await this.telegram.send(
        chatId,
        `🔐 AviShifo — kirish uchun tasdiqlash kodi\n\n` +
          `Kod: ${code}\n\n` +
          `${fullName}, bu kod ${minutes} daqiqa amal qiladi.\n` +
          `Agar tizimga kirmoqchi bo‘lmagan bo‘lsangiz, kodni HECH KIMGA bermang va parolingizni almashtiring.`,
      );
    } catch (e) {
      await this.redis.client.del(key(challengeId));
      this.logger.error(`2FA code delivery failed for user ${userId}: ${String(e)}`);
      throw new AppException(
        ErrorCode.TELEGRAM_NOT_LINKED,
        'Tasdiqlash kodini yuborib bo‘lmadi. Telegram botni tekshiring yoki administratorga murojaat qiling.',
        503,
      );
    }

    return { challengeId, expiresInSeconds: AUTH_2FA_TTL_SECONDS };
  }

  /**
   * Burns the challenge on success and after too many wrong codes, so a stolen
   * password plus code guessing cannot be brute-forced within the TTL.
   */
  async consume(challengeId: string, code: string): Promise<string> {
    const raw = await this.redis.client.get(key(challengeId));
    if (!raw) {
      throw new AppException(
        ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
        'Kod muddati tugagan. Qaytadan kiring.',
        401,
      );
    }

    const challenge = JSON.parse(raw) as Challenge;
    const expected = Buffer.from(challenge.code);
    const given = Buffer.from(code);
    const ok = expected.length === given.length && timingSafeEqual(expected, given);

    if (!ok) {
      const attempts = challenge.attempts + 1;
      if (attempts >= AUTH_2FA_MAX_ATTEMPTS) {
        await this.redis.client.del(key(challengeId));
        throw new AppException(
          ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
          'Juda ko‘p urinish. Qaytadan kiring.',
          401,
        );
      }
      // Keep the original expiry — a wrong guess must not extend the window.
      const ttl = await this.redis.client.ttl(key(challengeId));
      await this.redis.client.set(
        key(challengeId),
        JSON.stringify({ ...challenge, attempts } satisfies Challenge),
        'EX',
        ttl > 0 ? ttl : 1,
      );
      throw new AppException(ErrorCode.OTP_INVALID, 'Kod noto‘g‘ri', 401);
    }

    await this.redis.client.del(key(challengeId));
    return challenge.userId;
  }
}
