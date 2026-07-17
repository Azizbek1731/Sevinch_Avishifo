import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../core/config/app-config.service';
import { RedisService } from '../../../core/redis/redis.service';

const ESKIZ_TOKEN_KEY = 'eskiz:token';
/** Eskiz tokens live 30 days; cache for 20 to refresh well before expiry. */
const ESKIZ_TOKEN_TTL_SECONDS = 20 * 24 * 60 * 60;
const ESKIZ_BASE_URL = 'https://notify.eskiz.uz/api';

/** "+998901234567" → "+99890*****67" (never log full phone numbers — PHI). */
export function maskPhone(phone: string): string {
  if (phone.length < 9) return '***';
  return `${phone.slice(0, 6)}${'*'.repeat(phone.length - 8)}${phone.slice(-2)}`;
}

/**
 * SMS delivery channel. `SMS_PROVIDER=log` (dev/sandbox) writes the message to
 * the application log; `eskiz` sends through the Eskiz.uz HTTP API with a
 * Redis-cached auth token and a single re-auth retry on 401.
 */
@Injectable()
export class SmsChannel {
  private readonly logger = new Logger(SmsChannel.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  async send(phone: string, body: string): Promise<void> {
    if (this.config.env.SMS_PROVIDER === 'log') {
      this.logger.log(`[SMS→${maskPhone(phone)}] ${body}`);
      return;
    }
    await this.sendViaEskiz(phone, body, true);
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.redis.client.get(ESKIZ_TOKEN_KEY);
      if (cached) return cached;
    }
    const { ESKIZ_EMAIL, ESKIZ_PASSWORD } = this.config.env;
    if (!ESKIZ_EMAIL || !ESKIZ_PASSWORD) {
      throw new Error('Eskiz credentials are not configured (ESKIZ_EMAIL / ESKIZ_PASSWORD)');
    }
    const res = await fetch(`${ESKIZ_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ESKIZ_EMAIL, password: ESKIZ_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Eskiz auth failed: HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    const token =
      typeof json === 'object' && json !== null
        ? (json as { data?: { token?: unknown } }).data?.token
        : undefined;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Eskiz auth failed: no token in response');
    }
    await this.redis.client.set(ESKIZ_TOKEN_KEY, token, 'EX', ESKIZ_TOKEN_TTL_SECONDS);
    return token;
  }

  private async sendViaEskiz(phone: string, message: string, retryOn401: boolean): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${ESKIZ_BASE_URL}/message/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        mobile_phone: phone.replace(/^\+/, ''),
        message,
        from: this.config.env.ESKIZ_FROM,
      }),
    });
    if (res.status === 401 && retryOn401) {
      // Token expired or revoked — re-authenticate once and retry.
      await this.redis.client.del(ESKIZ_TOKEN_KEY);
      await this.getToken(true);
      await this.sendViaEskiz(phone, message, false);
      return;
    }
    if (!res.ok) throw new Error(`Eskiz send failed: HTTP ${res.status}`);
  }
}
