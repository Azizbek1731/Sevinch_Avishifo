import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ErrorCode,
  permissionsForRole,
  type AuthUser,
  type JwtPayload,
  type Locale,
  type UserRole,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';

export interface DisplayPrincipal {
  kind: 'display';
  clinicId: string;
  branchId: string;
}

export interface UserPrincipal {
  kind: 'user';
  user: AuthUser;
}

export type Principal = UserPrincipal | DisplayPrincipal;

/**
 * Resolves JWTs into principals. Used by the HTTP JwtAuthGuard and by the
 * Socket.IO handshake (which also accepts long-lived TV display tokens).
 */
@Injectable()
export class PrincipalService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async verifyToken(token: string): Promise<JwtPayload & { typ?: string; branchId?: string }> {
    try {
      return await this.jwt.verifyAsync(token);
    } catch {
      throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Invalid or expired token', 401);
    }
  }

  /** Loads the user row and computes effective permissions. */
  async buildAuthUser(payload: JwtPayload): Promise<AuthUser> {
    // Platform-scope lookup: identity resolution happens before tenant context exists.
    const user = await this.prisma.unscoped.user.findUnique({
      where: { id: payload.sub },
      include: { branches: true, clinic: { select: { status: true } } },
    });
    if (!user || user.deletedAt) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'User not found', 401);
    }
    if (this.config.env.SINGLE_CLINIC_MODE && (user.role === 'SUPER_ADMIN' || !user.clinicId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Platform accounts are disabled', 403);
    }
    if (user.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.ACCOUNT_SUSPENDED, 'Account is suspended', 403);
    }
    if (user.clinic && user.clinic.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.CLINIC_SUSPENDED, 'Clinic is suspended', 403);
    }
    if (payload.sid) {
      const session = await this.prisma.unscoped.authSession.findUnique({
        where: { id: payload.sid },
        select: { userId: true, revokedAt: true, expiresAt: true },
      });
      if (
        !session ||
        session.userId !== user.id ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      ) {
        throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Session ended', 401);
      }
    }

    const overrides = (user.permissionOverrides ?? {}) as { grant?: string[]; revoke?: string[] };
    return {
      id: user.id,
      clinicId: user.clinicId,
      role: user.role as UserRole,
      fullName: user.fullName,
      locale: user.locale.replace('uz_Cyrl', 'uz-Cyrl') as Locale,
      branchIds: user.branches.map((b) => b.branchId),
      permissions: permissionsForRole(user.role as UserRole, overrides),
      sessionId: payload.sid,
      impersonatedBy: payload.impersonatedBy,
    };
  }

  /** Resolve a WS handshake token: staff JWT or TV display token. */
  async resolveSocketPrincipal(token: string): Promise<Principal> {
    const payload = await this.verifyToken(token);
    if (payload.typ === 'display') {
      if (!payload.clinicId || !payload.branchId) {
        throw new AppException(ErrorCode.UNAUTHORIZED, 'Malformed display token', 401);
      }
      return { kind: 'display', clinicId: payload.clinicId, branchId: payload.branchId };
    }
    return { kind: 'user', user: await this.buildAuthUser(payload) };
  }
}
