import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3001),
  API_URL: z.string().default('http://localhost:3001'),
  WEB_URL: z.string().default('http://localhost:3000'),
  PORTAL_URL: z.string().default('http://localhost:3003'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3002,http://localhost:3003'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_PRIVATE_KEY_PATH: z.string().default('.keys/jwt-private.pem'),
  JWT_PUBLIC_KEY_PATH: z.string().default('.keys/jwt-public.pem'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  // Refresh-cookie Secure flag. Default follows NODE_ENV (prod → secure).
  // Set "false" only for a plain-HTTP deployment (e.g. IP demo before TLS).
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  SMS_PROVIDER: z.enum(['log', 'eskiz']).default('log'),
  ESKIZ_EMAIL: z.string().optional(),
  ESKIZ_PASSWORD: z.string().optional(),
  ESKIZ_FROM: z.string().default('4546'),
  TELEGRAM_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Bot @username (without @) — used to build t.me deep links for web linking. */
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  /**
   * Telegram Gateway (gatewayapi.telegram.org) access token. Delivers
   * verification codes to ANY phone registered on Telegram, from the verified
   * "Verification Codes" sender — no bot linking needed, which is what makes it
   * usable for first-time sign-ins. Unset disables the channel entirely.
   */
  TELEGRAM_GATEWAY_TOKEN: z.string().optional(),
  /** Optional verified channel to send as, instead of the generic sender. */
  TELEGRAM_GATEWAY_SENDER: z.string().optional(),
  /**
   * Which Telegram route carries verification codes when both are available.
   * `gateway` is the default: it is the purpose-built verification channel, it
   * looks the same to every user whether or not they ever linked our bot, and
   * it costs about $0.01 a code. Set `bot` to prefer the user's linked chat
   * instead, which is free but only reaches people who already pressed /start.
   * Either way the other route is the fallback.
   */
  VERIFICATION_CODE_CHANNEL: z.enum(['gateway', 'bot']).default('gateway'),
  PAYME_MERCHANT_ID: z.string().optional(),
  PAYME_KEY: z.string().optional(),
  CLICK_MERCHANT_ID: z.string().optional(),
  CLICK_SERVICE_ID: z.string().optional(),
  CLICK_SECRET_KEY: z.string().optional(),
  UZUM_MERCHANT_ID: z.string().optional(),
  UZUM_SECRET_KEY: z.string().optional(),
  /** Free-trial length for a self-service sign-up. */
  TRIAL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  /** Shown on the "trial expired" screen so the clinic can reach the operator. */
  SUPPORT_PHONE: z.string().optional(),
  /** Telegram username without @, e.g. "avishifo_support". */
  SUPPORT_TELEGRAM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Repo root (apps/api/../..) — .env and .keys live there. */
export const REPO_ROOT = resolve(__dirname, '../../../../..');

function readKey(path: string): string {
  const abs = resolve(REPO_ROOT, path);
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    throw new Error(
      `JWT key not found at ${abs}. Run "pnpm keys:generate" from the repo root first.`,
    );
  }
}

@Injectable()
export class AppConfigService {
  readonly env: Env;
  readonly jwtPrivateKey: string;
  readonly jwtPublicKey: string;

  constructor() {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    this.env = parsed.data;
    this.jwtPrivateKey = readKey(this.env.JWT_PRIVATE_KEY_PATH);
    this.jwtPublicKey = readKey(this.env.JWT_PUBLIC_KEY_PATH);
  }

  get isProd(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** Whether the refresh cookie carries the Secure flag (HTTPS-only). */
  get cookieSecure(): boolean {
    if (this.env.COOKIE_SECURE) return this.env.COOKIE_SECURE === 'true';
    return this.isProd;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get uploadsDir(): string {
    return resolve(REPO_ROOT, this.env.STORAGE_LOCAL_DIR);
  }
}
