import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { JwtPayload } from '@avishifo/shared';
import { AppConfigService } from '../../core/config/app-config.service';

/** Refresh cookie name (spec M1). */
export const REFRESH_COOKIE = 'avishifo_rt';

const TTL_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Tiny TTL parser: "30d" | "12h" | "15m" | "45s" | "500ms" → milliseconds. */
export function parseTtlMs(ttl: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl.trim());
  if (!match) {
    throw new Error(`Unparsable TTL "${ttl}" — expected e.g. "30d", "12h", "15m"`);
  }
  const value = Number(match[1]);
  const factor = TTL_UNIT_MS[match[2] as string];
  if (factor === undefined) throw new Error(`Unknown TTL unit in "${ttl}"`);
  return value * factor;
}

/**
 * Issues access JWTs (RS256, via the globally configured JwtModule) and
 * generates/splits opaque refresh tokens.
 *
 * Refresh token format over the wire: `<sessionId>.<64-byte-hex-secret>`.
 * Only the random secret's argon2 hash is persisted (AuthSession.refreshTokenHash);
 * the sessionId prefix lets us locate the session row without a hash lookup.
 */
@Injectable()
export class TokenService {
  readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {
    this.refreshTtlMs = parseTtlMs(this.config.env.JWT_REFRESH_TTL);
  }

  signAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwt.signAsync({ ...payload });
  }

  /** Random 64-byte hex secret — the part that gets argon2-hashed and stored. */
  generateRefreshSecret(): string {
    return randomBytes(64).toString('hex');
  }

  composeRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  splitRefreshToken(token: string): { sessionId: string; secret: string } | null {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
  }
}
