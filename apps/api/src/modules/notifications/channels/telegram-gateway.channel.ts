import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../core/config/app-config.service';
import { maskPhone } from './sms.channel';

const BASE_URL = 'https://gatewayapi.telegram.org';

interface GatewayResponse {
  ok: boolean;
  result?: { request_id?: string; delivery_status?: { status?: string } };
  error?: string;
}

/**
 * Telegram Gateway — verification codes delivered to any phone number that is
 * registered on Telegram, shown to the user by the verified "Verification
 * Codes" sender.
 *
 * This is the piece the bot could never cover: the bot can only reach a chat
 * that already pressed /start, which is exactly what a first-time sign-in does
 * not have. Gateway needs nothing from the user beyond having Telegram, so it
 * sits between the linked bot chat (free, richer) and SMS (slowest, costliest,
 * and currently unconfigured).
 *
 * Every send is best-effort by design: callers treat a null request id as "not
 * delivered here" and fall through to the next channel rather than failing the
 * request. Telegram refunds anything it could not deliver.
 */
@Injectable()
export class TelegramGatewayChannel {
  private readonly logger = new Logger(TelegramGatewayChannel.name);

  constructor(private readonly config: AppConfigService) {}

  /** False when no token is configured — callers skip straight to the next channel. */
  get enabled(): boolean {
    const token = this.config.env.TELEGRAM_GATEWAY_TOKEN;
    return !!token && token.trim() !== '';
  }

  /**
   * Sends `code` to `phone` (E.164). Returns the Gateway request id on success
   * and null on any failure, including a number that has no Telegram account.
   *
   * The code is ours, not Telegram's: we keep verifying it locally so the
   * authentication decision never depends on a third party being reachable, and
   * so one code works identically whichever channel carried it.
   */
  async sendCode(phone: string, code: string, ttlSeconds: number): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const res = await this.call('sendVerificationMessage', {
        phone_number: phone,
        code,
        // Telegram refunds a message it could not deliver inside the TTL, so it
        // is set to the code's own lifetime — paying for a code that expired
        // before it arrived would be paying for nothing.
        ttl: Math.min(Math.max(ttlSeconds, 30), 3600),
        ...(this.config.env.TELEGRAM_GATEWAY_SENDER
          ? { sender_username: this.config.env.TELEGRAM_GATEWAY_SENDER }
          : {}),
      });

      const requestId = res.result?.request_id;
      if (!res.ok || !requestId) {
        this.logger.warn(
          `Gateway refused ${maskPhone(phone)}: ${res.error ?? 'no request_id in response'}`,
        );
        return null;
      }
      return requestId;
    } catch (e) {
      this.logger.warn(`Gateway send failed for ${maskPhone(phone)}: ${String(e)}`);
      return null;
    }
  }

  /**
   * Withdraws a code that is no longer wanted — after a successful sign-in
   * through another route, or when the challenge is burned. Telegram removes it
   * from the user's chat when it can, which keeps a live code from sitting in
   * their history. Never throws: the code has already been invalidated on our
   * side by the time this runs.
   */
  async revoke(requestId: string): Promise<void> {
    if (!this.enabled) return;
    await this.call('revokeVerificationMessage', { request_id: requestId }).catch((e: unknown) =>
      this.logger.debug(`Gateway revoke failed: ${String(e)}`),
    );
  }

  private async call(method: string, body: Record<string, unknown>): Promise<GatewayResponse> {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.env.TELEGRAM_GATEWAY_TOKEN ?? ''}`,
      },
      body: JSON.stringify(body),
      // A verification code is worthless once the user has given up waiting.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as GatewayResponse;
  }
}
