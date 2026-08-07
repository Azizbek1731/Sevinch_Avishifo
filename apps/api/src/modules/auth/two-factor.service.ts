import { Injectable, Logger } from '@nestjs/common';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { AUTH_2FA_MAX_ATTEMPTS, AUTH_2FA_TTL_SECONDS, ErrorCode } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { RedisService } from '../../core/redis/redis.service';
import { TelegramChannel } from '../notifications/channels/telegram.channel';

/**
 * Which flow a challenge belongs to. A code is only ever valid for the step that
 * asked for it: `second-factor` follows a correct password, `passwordless` is
 * the whole of the authentication on its own.
 */
export type ChallengePurpose = 'second-factor' | 'passwordless';

interface Challenge {
  userId: string;
  code: string;
  /** Absent on challenges issued before purposes existed — those were 2FA. */
  purpose?: ChallengePurpose;
}

const key = (id: string): string => `auth:2fa:${id}`;
/**
 * Wrong guesses are counted in their own key with INCR rather than inside the
 * challenge JSON. Read-compare-write on the JSON is not atomic, so guesses fired
 * in parallel all read attempts=0 and the cap never bites — which is precisely
 * the case a brute-forcer creates.
 */
const attemptsKey = (id: string): string => `auth:2fa:${id}:attempts`;

/**
 * Telegram-delivered login codes for staff and super-admin: the opt-in second
 * factor after a password, and the passwordless sign-in that replaces one.
 *
 * The second factor is opt-in per user and only effective once a Telegram chat
 * is linked — enabling it without a chat would lock the account out, so
 * `isRequiredFor` checks both.
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

  private async createChallenge(
    userId: string,
    purpose: ChallengePurpose,
  ): Promise<{ challengeId: string; code: string }> {
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.client.set(
      key(challengeId),
      JSON.stringify({ userId, code, purpose } satisfies Challenge),
      'EX',
      AUTH_2FA_TTL_SECONDS,
    );
    return { challengeId, code };
  }

  /**
   * Sends the code and returns the challenge id. If Telegram delivery fails the
   * challenge is discarded and the caller gets a hard error rather than a
   * challenge nobody can answer.
   *
   * Only safe after the caller has already proved something (a correct
   * password): awaiting the send makes the response time depend on whether a
   * chat exists. Use `issueInBackground` where the request itself is
   * unauthenticated.
   */
  async issue(
    userId: string,
    chatId: string,
    fullName: string,
    purpose: ChallengePurpose = 'second-factor',
  ): Promise<{
    challengeId: string;
    expiresInSeconds: number;
  }> {
    const { challengeId, code } = await this.createChallenge(userId, purpose);

    try {
      await this.telegram.send(chatId, this.codeMessage(code, fullName, purpose));
    } catch (e) {
      await this.redis.client.del(key(challengeId));
      this.logger.error(`Login code delivery failed for user ${userId}: ${String(e)}`);
      throw new AppException(
        ErrorCode.TELEGRAM_NOT_LINKED,
        'Tasdiqlash kodini yuborib bo‘lmadi. Telegram botni tekshiring yoki administratorga murojaat qiling.',
        503,
      );
    }

    return { challengeId, expiresInSeconds: AUTH_2FA_TTL_SECONDS };
  }

  /**
   * Same challenge, but the Telegram round-trip happens after the response is
   * on its way. On an unauthenticated endpoint the delivery latency is itself
   * the answer to "is this phone a staff account with a linked chat?", so it
   * must not be inside the request. A send that fails simply leaves a challenge
   * nobody can answer, which is what every other rejection looks like anyway.
   */
  async issueInBackground(
    userId: string,
    chatId: string,
    fullName: string,
    purpose: ChallengePurpose,
  ): Promise<{ challengeId: string; expiresInSeconds: number }> {
    const { challengeId, code } = await this.createChallenge(userId, purpose);
    void this.telegram
      .send(chatId, this.codeMessage(code, fullName, purpose))
      .catch((e: unknown) =>
        this.logger.warn(`Login code delivery failed for user ${userId}: ${String(e)}`),
      );
    return { challengeId, expiresInSeconds: AUTH_2FA_TTL_SECONDS };
  }

  /**
   * One code per phone per minute. Without it an unauthenticated caller can walk
   * the throttle limit and keep a victim's Telegram ringing with login codes.
   * Returns false when a code was already sent recently.
   */
  async claimSendSlot(phone: string): Promise<boolean> {
    const ok = await this.redis.client.set(`auth:tglogin:cooldown:${phone}`, '1', 'EX', 60, 'NX');
    return ok === 'OK';
  }

  private codeMessage(code: string, fullName: string, purpose: ChallengePurpose): string {
    const minutes = Math.round(AUTH_2FA_TTL_SECONDS / 60);
    if (purpose === 'passwordless') {
      // Here the code IS the whole authentication, so the warning is blunter
      // than the second-factor one — there is no password behind it.
      return (
        `🔑 AviShifo — Telegram orqali kirish kodi\n\n` +
        `Kod: ${code}\n\n` +
        `${fullName}, bu kod AviShifo paneliga parolsiz kirish uchun va ${minutes} daqiqa amal qiladi.\n` +
        `Kodni HECH KIMGA bermang — uni bilgan odam sizning nomingizdan tizimga kira oladi.\n` +
        `Agar kirishni siz so‘ramagan bo‘lsangiz, bu kodni e'tiborsiz qoldiring.`
      );
    }
    return (
      `🔐 AviShifo — kirish uchun tasdiqlash kodi\n\n` +
      `Kod: ${code}\n\n` +
      `${fullName}, bu kod ${minutes} daqiqa amal qiladi.\n` +
      `Agar tizimga kirmoqchi bo‘lmagan bo‘lsangiz, kodni HECH KIMGA bermang va parolingizni almashtiring.`
    );
  }

  /**
   * Told to a 2FA account that asked for a passwordless sign-in. They chose that
   * one factor is not enough for them, so no usable challenge is created — this
   * message is the only thing that goes out, and it must not fail the request.
   */
  async notifyPasswordRequired(chatId: string, fullName: string): Promise<void> {
    try {
      await this.telegram.send(
        chatId,
        `🔐 AviShifo — Telegram orqali kirish so‘raldi\n\n` +
          `${fullName}, sizning hisobingizda ikki bosqichli himoya yoqilgan, shuning uchun ` +
          `faqat Telegram kodi bilan kirib bo‘lmaydi.\n` +
          `Parolingiz bilan kiring — tasdiqlash kodi shundan keyin shu yerga keladi.\n\n` +
          `Agar kirishni siz so‘ramagan bo‘lsangiz, parolingizni almashtiring.`,
      );
    } catch (e) {
      this.logger.warn(`Passwordless-refusal notice not delivered: ${String(e)}`);
    }
  }

  /**
   * Burns the challenge on success and after too many wrong codes, so a stolen
   * password plus code guessing cannot be brute-forced within the TTL.
   *
   * `purpose` must match the flow that issued the challenge: the two endpoints
   * demand different evidence to get here, and a code obtained through the
   * cheaper one must not be spendable on the other.
   */
  async consume(
    challengeId: string,
    code: string,
    purpose: ChallengePurpose = 'second-factor',
  ): Promise<string> {
    const raw = await this.redis.client.get(key(challengeId));
    if (!raw) {
      throw new AppException(
        ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
        'Kod muddati tugagan. Qaytadan kiring.',
        401,
      );
    }

    const challenge = JSON.parse(raw) as Challenge;
    if ((challenge.purpose ?? 'second-factor') !== purpose) {
      throw new AppException(
        ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
        'Kod muddati tugagan. Qaytadan kiring.',
        401,
      );
    }

    const expected = Buffer.from(challenge.code);
    const given = Buffer.from(code);
    const ok = expected.length === given.length && timingSafeEqual(expected, given);

    if (!ok) {
      const attempts = await this.redis.client.incr(attemptsKey(challengeId));
      if (attempts === 1) {
        // First failure: bound the counter to what is left of the challenge, so
        // it can never outlive it. A wrong guess must not extend the window.
        const ttl = await this.redis.client.ttl(key(challengeId));
        await this.redis.client.expire(attemptsKey(challengeId), ttl > 0 ? ttl : 1);
      }
      if (attempts >= AUTH_2FA_MAX_ATTEMPTS) {
        await this.redis.client.del(key(challengeId), attemptsKey(challengeId));
        throw new AppException(
          ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
          'Juda ko‘p urinish. Qaytadan kiring.',
          401,
        );
      }
      throw new AppException(ErrorCode.OTP_INVALID, 'Kod noto‘g‘ri', 401);
    }

    await this.redis.client.del(key(challengeId), attemptsKey(challengeId));
    return challenge.userId;
  }
}
