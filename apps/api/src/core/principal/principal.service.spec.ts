import { describe, expect, it, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import { UserRole } from '@avishifo/shared';
import { PrincipalService } from './principal.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AppConfigService } from '../config/app-config.service';

function principal(role: UserRole, clinicId: string | null) {
  const prisma = {
    unscoped: {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user',
          role,
          clinicId,
          deletedAt: null,
          status: 'ACTIVE',
          clinic: clinicId ? { status: 'ACTIVE' } : null,
          fullName: 'Demo',
          locale: 'uz',
          branches: [],
          permissionOverrides: {},
        }),
      },
      authSession: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    },
  } as unknown as PrismaService;
  const config = { env: { SINGLE_CLINIC_MODE: true } } as unknown as AppConfigService;
  return new PrincipalService({} as JwtService, prisma, config);
}

describe('single-clinic principals', () => {
  it('rejects a previously issued platform token', async () => {
    await expect(
      principal(UserRole.SUPER_ADMIN, null).buildAuthUser({
        sub: 'user',
        role: UserRole.SUPER_ADMIN,
        clinicId: null,
        sid: 'session',
      }),
    ).rejects.toThrow('Platform accounts are disabled');
  });

  it('keeps clinic administrator permissions and clinic scope', async () => {
    const user = await principal(UserRole.CLINIC_ADMIN, 'clinic').buildAuthUser({
      sub: 'user',
      role: UserRole.CLINIC_ADMIN,
      clinicId: 'clinic',
      sid: 'session',
    });
    expect(user.clinicId).toBe('clinic');
    expect(user.permissions).toContain('users.write');
    expect(user.permissions).not.toContain('platform.clinics.write');
  });
});
