import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'node:crypto';
import {
  AUTH_2FA_TTL_SECONDS,
  AuditAction,
  ErrorCode,
  UserRole,
  UserStatus,
  type VerifyTwoFactorInput,
  normalizePhone,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterClinicInput,
  type RequestPasswordResetInput,
  type ResetPasswordWithOtpInput,
  type TelegramLoginRequestInput,
  type TelegramLoginVerifyInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { TwoFactorService } from './two-factor.service';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { PrincipalService } from '../../core/principal/principal.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { ClinicProvisioningService } from '../../core/provisioning/clinic-provisioning.service';
import { PlatformAlertsService } from '../notifications/platform-alerts.service';
import {
  SubscriptionService,
  type SubscriptionState,
} from '../../core/subscription/subscription.service';
import { TokenService } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;
const OTP_PURPOSE_PASSWORD_RESET = 'password_reset';

const ARGON2_OPTS: argon2.Options = { type: argon2.argon2id };

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  /** Composed `<sessionId>.<secret>` — controller puts it into the httpOnly cookie. */
  refreshToken: string;
}

/**
 * Password was correct but the account has the Telegram second factor on. No
 * session exists yet — the client posts the code to /auth/two-factor/verify.
 */
export interface TwoFactorPendingResult {
  twoFactorRequired: true;
  challengeId: string;
  expiresInSeconds: number;
  /** Last two digits of the linked Telegram chat's phone, for "code sent to …". */
  hint: string | null;
}

export type LoginOutcome = LoginResult | TwoFactorPendingResult;

export function isTwoFactorPending(r: LoginOutcome): r is TwoFactorPendingResult {
  return 'twoFactorRequired' in r;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/** Where a locked-out clinic should turn — surfaced on the trial-expired screen. */
export interface SupportContact {
  phone: string | null;
  /** Telegram username without @. */
  telegram: string | null;
}

export interface MeResult {
  user: AuthUser;
  clinic: { id: string; name: string; logoUrl: string | null } | null;
  branches: Array<{ id: string; name: string }>;
  /** null for SUPER_ADMIN (platform scope has no subscription). */
  subscription: SubscriptionState | null;
  support: SupportContact;
  /** Drives the security card and the "link Telegram" prompt in the panel. */
  security: {
    twoFactorEnabled: boolean;
    telegramLinked: boolean;
    telegramUsername: string | null;
  };
}

export interface SessionItem {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  current: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly principal: PrincipalService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly provisioning: ClinicProvisioningService,
    private readonly subscriptions: SubscriptionService,
    private readonly twoFactor: TwoFactorService,
    private readonly platformAlerts: PlatformAlertsService,
  ) {}

  // --------------------------------------------------------------- sign-up

  /**
   * Public self-service sign-up (M17): a clinic director creates their clinic
   * and is signed in immediately on a free trial. There is no verification step
   * by design — the super-admin panel surfaces every new trial and can suspend
   * abusive registrations.
   */
  async registerClinic(
    input: RegisterClinicInput,
  ): Promise<LoginResult & { trialEndsAt: string | null }> {
    if (this.config.env.SINGLE_CLINIC_MODE) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Clinic registration is disabled', 403);
    }
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid phone number', 400);
    }

    // A phone may only own ONE clinic — otherwise the same person can mint
    // unlimited trials (User uniqueness is per-clinic, so the DB won't stop it).
    // Unscoped: this is a pre-tenant lookup across all clinics (justified).
    const existingOwner = await this.prisma.unscoped.user.findFirst({
      where: { phone, deletedAt: null, role: UserRole.CLINIC_OWNER },
      select: { id: true },
    });
    if (existingOwner) {
      throw new AppException(
        ErrorCode.PHONE_ALREADY_OWNS_CLINIC,
        'This phone number already owns a clinic',
        409,
      );
    }

    const clinicName = input.clinicName.trim();
    const nameTaken = await this.prisma.unscoped.clinic.findFirst({
      where: { name: { equals: clinicName, mode: 'insensitive' }, status: { not: 'ARCHIVED' } },
      select: { id: true },
    });
    if (nameTaken) {
      throw new AppException(ErrorCode.CLINIC_NAME_TAKEN, 'Clinic name already taken', 409);
    }

    const provisioned = await this.provisioning.provision({
      clinic: { name: clinicName, phone },
      owner: {
        fullName: input.fullName.trim(),
        phone,
        email: input.email,
        password: input.password,
        locale: input.locale,
      },
      source: 'self-signup',
    });

    // Sign the director straight in — no verification gate to pass.
    const { session, refreshToken } = await this.createSession(provisioned.owner.id);
    const payload = {
      sub: provisioned.owner.id,
      clinicId: provisioned.clinic.id,
      role: provisioned.owner.role as UserRole,
      sid: session.id,
    };
    const [authUser, accessToken] = await Promise.all([
      this.principal.buildAuthUser(payload),
      this.tokens.signAccessToken(payload),
    ]);

    await this.audit.log({
      action: AuditAction.LOGIN,
      entity: 'User',
      entityId: provisioned.owner.id,
      userId: provisioned.owner.id,
      clinicId: provisioned.clinic.id,
    });

    // Tell the platform admins on Telegram. Not awaited and never throws: the
    // director is mid-signup and must not wait on — or be failed by — Telegram.
    void this.platformAlerts.newClinicRegistered({
      clinicName: provisioned.clinic.name,
      ownerName: provisioned.owner.fullName,
      ownerPhone: phone,
      ownerEmail: input.email ?? null,
      planName: provisioned.plan.name,
      trialEndsAt: provisioned.subscription.endsAt,
    });

    return {
      user: authUser,
      accessToken,
      refreshToken,
      trialEndsAt: provisioned.subscription.endsAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------------ login

  async login(input: LoginInput): Promise<LoginOutcome> {
    // normalizePhone strips every non-digit, so an address that happens to carry
    // nine digits ("clinic123456789@gmail.com") would be read as a phone and the
    // account would never be found. An identifier with an @ is always an email.
    const phone = input.identifier.includes('@') ? null : normalizePhone(input.identifier);

    // Pre-tenant identity resolution: no clinic context exists before login,
    // so the lookup must bypass tenant scoping (justified unscoped usage).
    const user = await this.prisma.unscoped.user.findFirst({
      where: {
        deletedAt: null,
        // PATIENT accounts are portal-only (OTP login there), never staff panel.
        role: { not: UserRole.PATIENT },
        ...(phone
          ? { phone }
          : { email: { equals: input.identifier, mode: 'insensitive' } }),
      },
      include: { clinic: { select: { status: true } } },
    });

    if (!user || !user.passwordHash) {
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        entity: 'User',
        clinicId: null,
      });
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        clinicId: user.clinicId,
      });
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        'Account temporarily locked after failed login attempts. Try again later.',
        429,
      );
    }

    const passwordOk = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!passwordOk) {
      await this.registerFailedLogin(user.id, user.failedLoginCount, user.clinicId);
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(ErrorCode.ACCOUNT_SUSPENDED, 'Account is suspended', 403);
    }
    if (user.clinic && user.clinic.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.CLINIC_SUSPENDED, 'Clinic is suspended', 403);
    }

    // Successful login: reset the failure counter. Unscoped: User is not tenant-scoped.
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.unscoped.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    // An enabled second factor stays required if its bot is unavailable.
    // No session is created until the code checks out.
    if (this.twoFactor.isRequiredFor(user)) {
      const { challengeId, expiresInSeconds } = await this.twoFactor.issue(
        user.id,
        user.telegramChatId,
        user.fullName,
        'second-factor',
      );
      return {
        twoFactorRequired: true,
        challengeId,
        expiresInSeconds,
        hint: user.phone ? user.phone.slice(-2) : null,
      };
    }

    return this.issueSession(user.id, user.clinicId, user.role as UserRole);
  }

  /**
   * Mints the session + tokens for an already-authenticated user. Shared by the
   * plain password path and the second step of a two-factor login.
   */
  private async issueSession(
    userId: string,
    clinicId: string | null,
    role: UserRole,
  ): Promise<LoginResult> {
    if (this.config.env.SINGLE_CLINIC_MODE && (role === UserRole.SUPER_ADMIN || !clinicId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Platform accounts are disabled', 403);
    }
    const user = { id: userId, clinicId, role };
    const { session, refreshToken } = await this.createSession(user.id);
    const authUser = await this.principal.buildAuthUser({
      sub: user.id,
      clinicId: user.clinicId,
      role: user.role as UserRole,
      sid: session.id,
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      clinicId: user.clinicId,
      role: user.role as UserRole,
      sid: session.id,
    });

    await this.audit.log({
      action: AuditAction.LOGIN,
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      clinicId: user.clinicId,
    });

    return { user: authUser, accessToken, refreshToken };
  }

  /**
   * Second step of a two-factor login: exchange the clinic-bot code for
   * a real session. The account state is re-checked here — a user suspended
   * between the two steps must not slip through.
   */
  async verifyTwoFactor(input: VerifyTwoFactorInput): Promise<LoginResult> {
    const userId = await this.twoFactor.consume(input.challengeId, input.code);
    const user = await this.requireSignInReady(userId);
    return this.issueSession(user.id, user.clinicId, user.role as UserRole);
  }

  /**
   * Re-reads the account between the two steps of a code login and refuses
   * anything that would not have been allowed to start one. The gap is small but
   * real: a suspension landing inside it must still take effect.
   */
  private async requireSignInReady(userId: string): Promise<{
    id: string;
    clinicId: string | null;
    role: string;
    twoFactorEnabled: boolean;
  }> {
    // Unscoped: pre-tenant, and the id comes from the challenge we just burned.
    const user = await this.prisma.unscoped.user.findFirst({
      where: { id: userId, deletedAt: null, role: { not: UserRole.PATIENT } },
      include: { clinic: { select: { status: true } } },
    });
    if (!user) throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(ErrorCode.ACCOUNT_SUSPENDED, 'Account is suspended', 403);
    }
    if (user.clinic && user.clinic.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.CLINIC_SUSPENDED, 'Clinic is suspended', 403);
    }
    return user;
  }

  // ------------------------------------------------- passwordless (Telegram)

  /**
   * Step one of signing in through the bot instead of typing a password.
   *
   * Every caller gets a challengeId, whether or not the phone belongs to anyone:
   * a 404 (or a slower 200) here would turn this endpoint into a directory of
   * which numbers are staff. When there is nobody to send to, nothing is sent
   * and the returned challenge simply never verifies.
   */
  async requestTelegramLoginCode(
    input: TelegramLoginRequestInput,
  ): Promise<{ challengeId: string; expiresInSeconds: number }> {
    // Pre-tenant identity resolution (same justification as login). PATIENT
    // accounts are portal-only and have their own OTP flow.
    // User.phone is unique per clinic, not globally, so a number reused across
    // two clinics matches twice. Resolve the oldest — the same one the bot binds
    // the chat to (bindChat orders identically) — or the code would be sent to a
    // chat that belongs to the other account.
    const user = await this.prisma.unscoped.user.findFirst({
      where: { phone: input.phone, deletedAt: null, role: { not: UserRole.PATIENT } },
      include: { clinic: { select: { status: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Same bar as a password login, plus somewhere to send the code. Every
    // rejection leaves through the same door, silently. lockedUntil is part of
    // that bar: an account the password door has locked after repeated failures
    // must not stay open through this one.
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      (user.clinic && user.clinic.status !== 'ACTIVE') ||
      (user.lockedUntil && user.lockedUntil > new Date())
    ) {
      return this.decoyChallenge();
    }

    // Only a verified link to the clinic bot can receive authentication codes.
    if (!user.telegramChatId) {
      return this.decoyChallenge();
    }

    // Apply the cooldown to codes and password-required notices alike.
    if (!(await this.twoFactor.claimSendSlot(input.phone))) {
      return this.decoyChallenge();
    }

    // The user turned on a second factor: letting a Telegram code alone in would
    // quietly undo that decision, so they are sent to the password flow — which
    // asks for a Telegram code as its second step anyway.
    if (user.twoFactorEnabled) {
      // Not awaited, for the same timing reason as the code itself below.
      if (user.telegramChatId) {
        void this.twoFactor.notifyPasswordRequired(user.id, user.telegramChatId, user.fullName);
      }
      return this.decoyChallenge();
    }

    // Delivery is deliberately NOT awaited: this endpoint is unauthenticated, and
    // waiting on Telegram would make the response time reveal which numbers
    // belong to staff with a linked chat.
    return this.twoFactor.issueInBackground(
      user.id,
      user.telegramChatId,
      user.fullName,
      'passwordless',
    );
  }

  /**
   * A challenge id backed by nothing. Indistinguishable from a real one to the
   * caller, and no code exists that could ever verify it.
   */
  private decoyChallenge(): { challengeId: string; expiresInSeconds: number } {
    return { challengeId: randomUUID(), expiresInSeconds: AUTH_2FA_TTL_SECONDS };
  }

  /** Step two: the code from the bot is the whole of the authentication. */
  async verifyTelegramLogin(input: TelegramLoginVerifyInput): Promise<LoginResult> {
    const userId = await this.twoFactor.consume(input.challengeId, input.code, 'passwordless');
    const user = await this.requireSignInReady(userId);

    // Turned on between the two steps: honour the stricter setting, not the
    // challenge that was issued before it.
    if (user.twoFactorEnabled) {
      throw new AppException(
        ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
        'Hisobingizda ikki bosqichli himoya yoqilgan — parolingiz bilan kiring.',
        401,
      );
    }

    return this.issueSession(user.id, user.clinicId, user.role as UserRole);
  }

  /**
   * Turn the Telegram second factor on or off for the signed-in user. Enabling
   * requires a linked chat: without one the next login would ask for a code that
   * can never arrive.
   */
  async setTwoFactor(userId: string, enabled: boolean): Promise<{ twoFactorEnabled: boolean }> {
    // Unscoped: User is not tenant-scoped.
    const user = await this.prisma.unscoped.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    if (enabled && !user?.telegramChatId) {
      throw new AppException(
        ErrorCode.TELEGRAM_NOT_LINKED,
        'Avval Telegram botni ulang — aks holda tasdiqlash kodi keladigan joy bo‘lmaydi',
        400,
      );
    }
    const updated = await this.prisma.unscoped.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enabled },
      select: { twoFactorEnabled: true },
    });
    return { twoFactorEnabled: updated.twoFactorEnabled };
  }

  private async registerFailedLogin(
    userId: string,
    currentCount: number,
    clinicId: string | null,
  ): Promise<void> {
    const failed = currentCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    // Unscoped: User is not tenant-scoped and this runs pre-authentication.
    await this.prisma.unscoped.user.update({
      where: { id: userId },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLoginCount: failed },
    });
    await this.audit.log({
      action: AuditAction.LOGIN_FAILED,
      entity: 'User',
      entityId: userId,
      userId,
      clinicId,
    });
  }

  private async createSession(
    userId: string,
  ): Promise<{ session: { id: string }; refreshToken: string }> {
    const ctx = TenantContext.get();
    const secret = this.tokens.generateRefreshSecret();
    // Unscoped: AuthSession is a platform model (no clinicId column).
    const session = await this.prisma.unscoped.authSession.create({
      data: {
        userId,
        refreshTokenHash: await argon2.hash(secret, ARGON2_OPTS),
        userAgent: ctx?.userAgent,
        ip: ctx?.ip,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
      },
      select: { id: true },
    });
    return { session, refreshToken: this.tokens.composeRefreshToken(session.id, secret) };
  }

  // ---------------------------------------------------------------- refresh

  async refresh(presentedToken: string | undefined): Promise<RefreshResult> {
    if (!presentedToken) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Missing refresh token', 401);
    }
    const parts = this.tokens.splitRefreshToken(presentedToken);
    if (!parts) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Malformed refresh token', 401);
    }

    // Unscoped: AuthSession/User are platform models; refresh runs pre-tenant-context.
    const session = await this.prisma.unscoped.authSession.findUnique({
      where: { id: parts.sessionId },
      include: { user: { select: { id: true, clinicId: true, role: true, status: true, deletedAt: true } } },
    });
    if (!session) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid refresh token', 401);
    }

    if (session.revokedAt) {
      // A token for a revoked session is being replayed — treat as reuse.
      await this.revokeReusedFamily(session.userId, session.user.clinicId);
    }

    if (session.expiresAt < new Date()) {
      throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Refresh token expired', 401);
    }

    const secretOk = await argon2
      .verify(session.refreshTokenHash, parts.secret)
      .catch(() => false);
    if (!secretOk) {
      // Hash holds only the CURRENT secret; a mismatching (i.e. already rotated)
      // token proves reuse → revoke the whole session family for this user.
      await this.revokeReusedFamily(session.userId, session.user.clinicId);
    }

    if (session.user.deletedAt || session.user.status !== UserStatus.ACTIVE) {
      throw new AppException(ErrorCode.ACCOUNT_SUSPENDED, 'Account is not active', 403);
    }

    // Rotate: replace the stored hash, stamp rotatedAt, slide expiry.
    const newSecret = this.tokens.generateRefreshSecret();
    await this.prisma.unscoped.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: await argon2.hash(newSecret, ARGON2_OPTS),
        rotatedAt: new Date(),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
      },
    });

    const accessToken = await this.tokens.signAccessToken({
      sub: session.user.id,
      clinicId: session.user.clinicId,
      role: session.user.role as UserRole,
      sid: session.id,
    });

    return {
      accessToken,
      refreshToken: this.tokens.composeRefreshToken(session.id, newSecret),
    };
  }

  /** Refresh-token reuse detected: revoke ALL of the user's sessions and abort. */
  private async revokeReusedFamily(userId: string, clinicId: string | null): Promise<never> {
    // Unscoped: AuthSession is a platform model.
    await this.prisma.unscoped.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      action: AuditAction.LOGOUT,
      entity: 'AuthSession',
      entityId: userId,
      userId,
      clinicId,
      after: { reason: 'refresh_reuse_detected', revokedAll: true },
    });
    throw new AppException(
      ErrorCode.REFRESH_REUSE_DETECTED,
      'Refresh token reuse detected — all sessions revoked',
      401,
    );
  }

  // ----------------------------------------------------------------- logout

  async logout(user: AuthUser): Promise<{ loggedOut: true }> {
    // Unscoped: AuthSession is a platform model.
    await this.prisma.unscoped.authSession.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      action: AuditAction.LOGOUT,
      entity: 'AuthSession',
      entityId: user.sessionId,
    });
    return { loggedOut: true };
  }

  // --------------------------------------------------------------------- me

  private supportContact(): SupportContact {
    return {
      phone: this.config.env.SUPPORT_PHONE ?? null,
      telegram: this.config.env.SUPPORT_TELEGRAM ?? null,
    };
  }

  async me(user: AuthUser): Promise<MeResult> {
    const security = await this.securityState(user.id);

    if (!user.clinicId) {
      // SUPER_ADMIN: platform scope, no clinic/branch context.
      return {
        user,
        clinic: null,
        branches: [],
        subscription: null,
        support: this.supportContact(),
        security,
      };
    }

    // Pre-branch-context bootstrap: /auth/me feeds the branch switcher before any
    // x-branch-id header exists, so the lookups bypass tenant scoping (justified).
    const [clinic, branches, subscription] = await Promise.all([
      this.prisma.unscoped.clinic.findUnique({
        where: { id: user.clinicId },
        select: { id: true, name: true, logoUrl: true },
      }),
      this.prisma.unscoped.branch.findMany({
        where: {
          clinicId: user.clinicId,
          isActive: true,
          // Users with explicit branch assignments only see those branches.
          ...(user.branchIds.length > 0 ? { id: { in: user.branchIds } } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.subscriptions.getState(user.clinicId),
    ]);

    return { user, clinic, branches, subscription, support: this.supportContact(), security };
  }

  /** Unscoped: User is a platform model; read for the caller only. */
  private async securityState(userId: string): Promise<MeResult['security']> {
    const row = await this.prisma.unscoped.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, telegramChatId: true, telegramUsername: true },
    });
    return {
      twoFactorEnabled: row?.twoFactorEnabled ?? false,
      telegramLinked: !!row?.telegramChatId,
      telegramUsername: row?.telegramUsername ?? null,
    };
  }

  // --------------------------------------------------------------- sessions

  async listSessions(user: AuthUser): Promise<SessionItem[]> {
    // Unscoped: AuthSession is a platform model; filtered to the caller only.
    const sessions = await this.prisma.unscoped.authSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, createdAt: true },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      current: s.id === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<{ revoked: true }> {
    // Unscoped: AuthSession is a platform model; ownership enforced in the filter.
    const result = await this.prisma.unscoped.authSession.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Session not found', 404);
    }
    await this.audit.log({
      action: AuditAction.LOGOUT,
      entity: 'AuthSession',
      entityId: sessionId,
      after: { remote: true },
    });
    return { revoked: true };
  }

  // -------------------------------------------------------- change password

  async changePassword(user: AuthUser, input: ChangePasswordInput): Promise<{ changed: true }> {
    // Unscoped: User is a platform model; row is the caller's own.
    const row = await this.prisma.unscoped.user.findUnique({
      where: { id: user.id },
      select: { id: true, passwordHash: true },
    });
    if (!row?.passwordHash) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'User not found', 401);
    }
    const ok = await argon2.verify(row.passwordHash, input.currentPassword).catch(() => false);
    if (!ok) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect', 400);
    }

    await this.prisma.unscoped.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(input.newPassword, ARGON2_OPTS) },
    });
    // Remote-logout every other device; the current session stays alive.
    await this.prisma.unscoped.authSession.updateMany({
      where: { userId: user.id, id: { not: user.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: user.id,
      after: { passwordChanged: true, otherSessionsRevoked: true },
    });
    return { changed: true };
  }

  // ---------------------------------------------------------- password reset

  async requestPasswordReset(input: RequestPasswordResetInput): Promise<{ requested: true }> {
    // Pre-tenant identity resolution (same justification as login).
    const user = await this.prisma.unscoped.user.findFirst({
      where: {
        phone: input.phone,
        deletedAt: null,
        role: { not: UserRole.PATIENT },
        status: UserStatus.ACTIVE,
      },
      select: { id: true, fullName: true, telegramChatId: true },
      orderBy: { createdAt: 'asc' },
    });

    // Always answer success — never reveal whether the phone exists.
    if (!user?.telegramChatId) return { requested: true };

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Unscoped: OtpCode is a platform model (no clinicId column).
    await this.prisma.unscoped.otpCode.updateMany({
      where: { phone: input.phone, purpose: OTP_PURPOSE_PASSWORD_RESET, usedAt: null },
      data: { usedAt: new Date() }, // invalidate any previous outstanding codes
    });
    const otp = await this.prisma.unscoped.otpCode.create({
      data: {
        phone: input.phone,
        codeHash: await argon2.hash(code, ARGON2_OPTS),
        purpose: OTP_PURPOSE_PASSWORD_RESET,
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    });
    await this.twoFactor.bindResetRecipient(otp.id, user.id, user.telegramChatId, OTP_TTL_MINUTES * 60);

    // Delivery is not awaited: this endpoint is unauthenticated and answers the
    // same way for every phone, so waiting on Telegram would let the response
    // time say whether the account exists.
    void this.twoFactor
      .deliverCode({
        userId: user.id,
        chatId: user.telegramChatId,
        botText:
          `🔑 AviShifo — parolni tiklash kodi\n\n` +
          `Kod: ${code}\n\n` +
          `${user.fullName}, bu kod ${OTP_TTL_MINUTES} daqiqa amal qiladi.\n` +
          `Agar parolni tiklashni siz so‘ramagan bo‘lsangiz, bu xabarni e'tiborsiz qoldiring — ` +
          `parolingiz o‘zgarmaydi.`,
        label: 'password-reset',
      })
      .then(async ({ delivered }) => {
        if (!delivered) {
          await this.prisma.unscoped.otpCode.updateMany({
            where: { id: otp.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          await this.twoFactor.forgetResetRecipient(otp.id);
        }
      })
      .catch(() => this.logger.warn('Password-reset code delivery failed'));

    return { requested: true };
  }

  async confirmPasswordReset(input: ResetPasswordWithOtpInput): Promise<{ reset: true }> {
    // Unscoped: OtpCode is a platform model; reset runs pre-authentication.
    const otp = await this.prisma.unscoped.otpCode.findFirst({
      where: { phone: input.phone, purpose: OTP_PURPOSE_PASSWORD_RESET, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new AppException(ErrorCode.OTP_INVALID, 'No active code — request a new one', 400);
    }
    if (otp.expiresAt < new Date()) {
      throw new AppException(ErrorCode.OTP_EXPIRED, 'Code expired — request a new one', 400);
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppException(ErrorCode.OTP_INVALID, 'Too many attempts — request a new code', 400);
    }

    const ok = await argon2.verify(otp.codeHash, input.otp).catch(() => false);
    if (!ok) {
      await this.prisma.unscoped.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException(ErrorCode.OTP_INVALID, 'Invalid code', 400);
    }

    const user = await this.prisma.unscoped.user.findFirst({
      where: {
        phone: input.phone,
        deletedAt: null,
        role: { not: UserRole.PATIENT },
        status: UserStatus.ACTIVE,
      },
      select: { id: true, clinicId: true, telegramChatId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user || !(await this.twoFactor.isResetRecipientCurrent(otp.id, user.id))) {
      throw new AppException(ErrorCode.OTP_INVALID, 'Invalid code', 400);
    }

    const passwordHash = await argon2.hash(input.newPassword, ARGON2_OPTS);
    // Only one verifier can claim a reset. The new password and session
    // revocation commit together with that claim.
    await this.prisma.unscoped.$transaction(async (tx) => {
      const claimed = await tx.otpCode.updateMany({
        where: { id: otp.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppException(ErrorCode.OTP_INVALID, 'Invalid code', 400);
      const updated = await tx.user.updateMany({
        where: { id: user.id, status: UserStatus.ACTIVE, deletedAt: null, telegramChatId: user.telegramChatId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      if (updated.count !== 1) throw new AppException(ErrorCode.OTP_INVALID, 'Invalid code', 400);
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.twoFactor.forgetResetRecipient(otp.id).catch(() => {
      this.logger.warn('Password-reset recipient cleanup failed');
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      clinicId: user.clinicId,
      after: { passwordReset: true, allSessionsRevoked: true },
    });
    return { reset: true };
  }
}
