import { Injectable } from '@nestjs/common';
import type { Prisma} from '@prisma/client';
import { type $Enums } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  AuditAction,
  ErrorCode,
  PERMISSIONS,
  SubscriptionStatus,
  UserRole,
  UserStatus,
  type Locale as SharedLocale,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { CreateUserDto, PermissionOverridesDto, UpdateUserDto, UpdateUserStatusDto, UserQueryDto } from './dto/user.dto';

/**
 * TENANCY NOTE (justification for prisma.unscoped):
 * The `User` model is NOT tenant-auto-scoped by the Prisma tenant extension
 * (`clinicId` is nullable — SUPER_ADMIN rows are platform-level), so
 * `prisma.db.user` performs no clinicId injection. Every User query in this
 * service therefore goes through `prisma.unscoped.user` and MUST include an
 * explicit `clinicId: TenantContext.requireClinicId()` filter. Never omit it.
 *
 * `AuthSession` is likewise platform-level (no clinicId column); we only touch
 * sessions of a user already verified to belong to the current clinic.
 */

/** Prisma record shape used everywhere in this service. */
type UserRecord = Prisma.UserGetPayload<{
  include: { staffProfile: true; branches: true };
}>;

const USER_INCLUDE = { staffProfile: true, branches: true } as const;

/** Staff = everything except platform admins and portal patients. */
const NON_STAFF_ROLES: $Enums.UserRole[] = [UserRole.SUPER_ADMIN, UserRole.PATIENT];

export interface StaffProfileResponse {
  specialty: string | null;
  licenseNo: string | null;
  hireDate: string | null;
  photoUrl: string | null;
  bio: string | null;
  slotMinutes: number | null;
}

export interface UserResponse {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  locale: SharedLocale;
  permissionOverrides: { grant: string[]; revoke: string[] };
  branchIds: string[];
  staffProfile: StaffProfileResponse | null;
  createdAt: string;
  updatedAt: string;
}

/** Shared Locale 'uz-Cyrl' ↔ Prisma enum member 'uz_Cyrl'. */
function toDbLocale(locale: SharedLocale): $Enums.Locale {
  return locale === 'uz-Cyrl' ? 'uz_Cyrl' : locale;
}
function fromDbLocale(locale: $Enums.Locale): SharedLocale {
  return locale === 'uz_Cyrl' ? 'uz-Cyrl' : locale;
}

function parseOverrides(value: Prisma.JsonValue): { grant: string[]; revoke: string[] } {
  const asStrings = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return { grant: asStrings(o.grant), revoke: asStrings(o.revoke) };
  }
  return { grant: [], revoke: [] };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------- queries

  async list(query: UserQueryDto): Promise<PaginatedResult<UserResponse>> {
    const clinicId = TenantContext.requireClinicId();
    const where: Prisma.UserWhereInput = {
      clinicId, // manual tenant filter — see TENANCY NOTE
      deletedAt: null,
      role: query.role ?? { notIn: NON_STAFF_ROLES },
      ...(query.status ? { status: query.status } : {}),
      // No explicit branch assignment = works in every branch (the /auth/me rule),
      // so a branch filter must keep branchless staff visible. AND-wrapped to avoid
      // colliding with the search OR below.
      ...(query.branchId
        ? {
            AND: [
              {
                OR: [
                  { branches: { some: { branchId: query.branchId } } },
                  { branches: { none: {} } },
                ],
              },
            ],
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.unscoped.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.unscoped.user.count({ where }),
    ]);

    return paginated(
      items.map((u) => this.toResponse(u)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async getById(id: string): Promise<UserResponse> {
    return this.toResponse(await this.findOwnedStaffUser(id));
  }

  // -------------------------------------------------------------- mutations

  async create(input: CreateUserDto): Promise<UserResponse> {
    const clinicId = TenantContext.requireClinicId();

    await this.assertBranchesBelongToClinic(input.branchIds);
    await this.assertContactsFree(clinicId, { phone: input.phone, email: input.email });
    await this.assertPlanUserLimit(clinicId);

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const user = await this.prisma.unscoped.user.create({
      data: {
        clinicId,
        fullName: input.fullName,
        phone: input.phone ?? null,
        email: input.email ?? null,
        passwordHash,
        role: input.role,
        status: UserStatus.ACTIVE,
        ...(input.locale ? { locale: toDbLocale(input.locale) } : {}),
        branches: {
          // nested creates are not auto-stamped — clinicId set explicitly
          create: input.branchIds.map((branchId) => ({ branchId, clinicId })),
        },
        ...(input.staffProfile
          ? {
              staffProfile: {
                create: {
                  clinicId, // nested create — explicit clinicId required
                  specialty: input.staffProfile.specialty ?? null,
                  licenseNo: input.staffProfile.licenseNo ?? null,
                  hireDate: input.staffProfile.hireDate
                    ? new Date(input.staffProfile.hireDate)
                    : null,
                  bio: input.staffProfile.bio ?? null,
                  slotMinutes: input.staffProfile.slotMinutes ?? null,
                },
              },
            }
          : {}),
      },
      include: USER_INCLUDE,
    });

    const response = this.toResponse(user);
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'User',
      entityId: user.id,
      // never log passwordHash
      after: {
        fullName: response.fullName,
        phone: response.phone,
        email: response.email,
        role: response.role,
        status: response.status,
        locale: response.locale,
        branchIds: response.branchIds,
        staffProfile: response.staffProfile,
      },
    });
    return response;
  }

  async update(id: string, input: UpdateUserDto): Promise<UserResponse> {
    const clinicId = TenantContext.requireClinicId();
    const existing = await this.findOwnedStaffUser(id);

    if (input.branchIds) await this.assertBranchesBelongToClinic(input.branchIds);
    await this.assertContactsFree(
      clinicId,
      {
        phone: input.phone !== undefined && input.phone !== existing.phone ? input.phone : undefined,
        email: input.email !== undefined && input.email !== existing.email ? input.email : undefined,
      },
      id,
    );

    const passwordHash = input.password
      ? await argon2.hash(input.password, { type: argon2.argon2id })
      : undefined;

    const data: Prisma.UserUpdateInput = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.locale !== undefined ? { locale: toDbLocale(input.locale) } : {}),
      ...(passwordHash !== undefined ? { passwordHash } : {}),
    };

    const updated = await this.prisma.db.$transaction(async (tx) => {
      // manual clinicId guard on the unscoped model — see TENANCY NOTE
      await tx.user.update({ where: { id, clinicId }, data });

      if (input.branchIds) {
        // replace the UserBranch set (tenant extension scopes these calls)
        await tx.userBranch.deleteMany({ where: { userId: id } });
        if (input.branchIds.length > 0) {
          await tx.userBranch.createMany({
            data: input.branchIds.map((branchId) => ({ userId: id, branchId, clinicId })),
          });
        }
      }

      if (input.staffProfile) {
        const profile = {
          specialty: input.staffProfile.specialty ?? null,
          licenseNo: input.staffProfile.licenseNo ?? null,
          hireDate: input.staffProfile.hireDate ? new Date(input.staffProfile.hireDate) : null,
          bio: input.staffProfile.bio ?? null,
          slotMinutes: input.staffProfile.slotMinutes ?? null,
        };
        await tx.staffProfile.upsert({
          where: { userId: id },
          create: { clinicId, userId: id, ...profile },
          update: profile,
        });
      }

      return tx.user.findUniqueOrThrow({ where: { id, clinicId }, include: USER_INCLUDE });
    });

    // Archiving through PATCH /users/:id behaves the same as the status endpoint.
    if (input.status === UserStatus.ARCHIVED && existing.status !== UserStatus.ARCHIVED) {
      await this.revokeSessions(id);
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: id,
      ...this.buildUpdateDiff(existing, input),
    });

    return this.toResponse(updated);
  }

  async updateStatus(id: string, input: UpdateUserStatusDto): Promise<UserResponse> {
    const clinicId = TenantContext.requireClinicId();
    const existing = await this.findOwnedStaffUser(id);

    if (existing.status === input.status) return this.toResponse(existing);

    const updated = await this.prisma.unscoped.user.update({
      where: { id, clinicId }, // manual tenant guard — see TENANCY NOTE
      data: { status: input.status },
      include: USER_INCLUDE,
    });

    if (input.status === UserStatus.ARCHIVED) {
      await this.revokeSessions(id);
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: id,
      before: { status: existing.status },
      after: { status: input.status },
    });

    return this.toResponse(updated);
  }

  async updatePermissionOverrides(
    id: string,
    input: PermissionOverridesDto,
  ): Promise<UserResponse> {
    const clinicId = TenantContext.requireClinicId();
    const existing = await this.findOwnedStaffUser(id);

    const known = PERMISSIONS as readonly string[];
    const unknown = [...input.grant, ...input.revoke].filter((p) => !known.includes(p));
    if (unknown.length > 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Unknown permission strings',
        400,
        unknown,
      );
    }

    const overrides = { grant: input.grant, revoke: input.revoke };
    const updated = await this.prisma.unscoped.user.update({
      where: { id, clinicId }, // manual tenant guard — see TENANCY NOTE
      data: { permissionOverrides: overrides },
      include: USER_INCLUDE,
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: id,
      before: { permissionOverrides: parseOverrides(existing.permissionOverrides) },
      after: { permissionOverrides: overrides },
    });

    return this.toResponse(updated);
  }

  // -------------------------------------------------------------- helpers

  private async findOwnedStaffUser(id: string): Promise<UserRecord> {
    const clinicId = TenantContext.requireClinicId();
    const user = await this.prisma.unscoped.user.findFirst({
      // manual tenant filter — see TENANCY NOTE
      where: { id, clinicId, deletedAt: null, role: { notIn: NON_STAFF_ROLES } },
      include: USER_INCLUDE,
    });
    if (!user) {
      throw new AppException(ErrorCode.NOT_FOUND, 'User not found', 404);
    }
    return user;
  }

  private async assertBranchesBelongToClinic(branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const unique = [...new Set(branchIds)];
    // Branch is tenant-scoped: prisma.db auto-filters by clinicId.
    const count = await this.prisma.db.branch.count({ where: { id: { in: unique } } });
    if (count !== unique.length) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'One or more branches do not belong to this clinic',
        400,
      );
    }
  }

  private async assertContactsFree(
    clinicId: string,
    contacts: { phone?: string; email?: string },
    excludeUserId?: string,
  ): Promise<void> {
    if (contacts.phone) {
      const clash = await this.prisma.unscoped.user.findFirst({
        // manual tenant filter — see TENANCY NOTE
        where: {
          clinicId,
          phone: contacts.phone,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        throw new AppException(ErrorCode.CONFLICT, 'Phone is already in use', 409);
      }
    }
    if (contacts.email) {
      const clash = await this.prisma.unscoped.user.findFirst({
        // manual tenant filter — see TENANCY NOTE
        where: {
          clinicId,
          email: contacts.email,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        throw new AppException(ErrorCode.CONFLICT, 'Email is already in use', 409);
      }
    }
  }

  /** Enforce plan.maxUsers against active (non-archived-role) staff count. */
  private async assertPlanUserLimit(clinicId: string): Promise<void> {
    // ClinicSubscription is tenant-scoped: prisma.db auto-filters by clinicId.
    const subscription = await this.prisma.db.clinicSubscription.findFirst({
      where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    // No active/trial subscription record → no limit to enforce here
    // (suspended clinics are blocked earlier by auth/tenant checks).
    if (!subscription) return;

    const activeUsers = await this.prisma.unscoped.user.count({
      // manual tenant filter — see TENANCY NOTE
      where: {
        clinicId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        role: { notIn: NON_STAFF_ROLES },
      },
    });
    if (activeUsers >= subscription.plan.maxUsers) {
      throw new AppException(
        ErrorCode.PLAN_LIMIT_REACHED,
        `Plan user limit reached (${subscription.plan.maxUsers})`,
        403,
      );
    }
  }

  /** Revoke every live session of a user (used when a user is archived). */
  private async revokeSessions(userId: string): Promise<void> {
    // AuthSession has no clinicId column (platform-level model); the target
    // user was already verified to belong to the current clinic.
    await this.prisma.unscoped.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** before/after snapshots of only the fields present in the PATCH payload. */
  private buildUpdateDiff(
    existing: UserRecord,
    input: UpdateUserDto,
  ): { before: Record<string, unknown>; after: Record<string, unknown> } {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (input.fullName !== undefined) {
      before.fullName = existing.fullName;
      after.fullName = input.fullName;
    }
    if (input.phone !== undefined) {
      before.phone = existing.phone;
      after.phone = input.phone;
    }
    if (input.email !== undefined) {
      before.email = existing.email;
      after.email = input.email;
    }
    if (input.role !== undefined) {
      before.role = existing.role;
      after.role = input.role;
    }
    if (input.status !== undefined) {
      before.status = existing.status;
      after.status = input.status;
    }
    if (input.locale !== undefined) {
      before.locale = fromDbLocale(existing.locale);
      after.locale = input.locale;
    }
    if (input.password !== undefined) {
      // never log passwordHash or the plain password — only the fact of change
      before.password = null;
      after.password = '[CHANGED]';
    }
    if (input.branchIds !== undefined) {
      before.branchIds = existing.branches.map((b) => b.branchId).sort();
      after.branchIds = [...input.branchIds].sort();
    }
    if (input.staffProfile !== undefined) {
      before.staffProfile = existing.staffProfile
        ? {
            specialty: existing.staffProfile.specialty,
            licenseNo: existing.staffProfile.licenseNo,
            hireDate: existing.staffProfile.hireDate?.toISOString() ?? null,
            bio: existing.staffProfile.bio,
            slotMinutes: existing.staffProfile.slotMinutes,
          }
        : null;
      after.staffProfile = input.staffProfile;
    }

    return { before, after };
  }

  private toResponse(user: UserRecord): UserResponse {
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      locale: fromDbLocale(user.locale),
      permissionOverrides: parseOverrides(user.permissionOverrides),
      branchIds: user.branches.map((b) => b.branchId),
      staffProfile: user.staffProfile
        ? {
            specialty: user.staffProfile.specialty,
            licenseNo: user.staffProfile.licenseNo,
            hireDate: user.staffProfile.hireDate?.toISOString() ?? null,
            photoUrl: user.staffProfile.photoUrl,
            bio: user.staffProfile.bio,
            slotMinutes: user.staffProfile.slotMinutes,
          }
        : null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
