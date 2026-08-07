import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ClinicStatus,
  ErrorCode,
  SubscriptionStatus,
  UserRole,
  UserStatus,
  type AuthUser,
  type JwtPayload,
  type SubscriptionFilter,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  ClinicProvisioningService,
  daysFromNow,
} from '../../core/provisioning/clinic-provisioning.service';
import { SubscriptionService } from '../../core/subscription/subscription.service';
import {
  AssignPlanDto,
  ClinicListQueryDto,
  CreateClinicWithOwnerDto,
  FeatureFlagSetDto,
  PlanUpdateDto,
  PlanUpsertDto,
  UpdateClinicStatusDto,
  UpdateSubscriptionDto,
} from './dto/super-admin.dto';

/**
 * TENANCY NOTE (justification for prisma.unscoped everywhere in this service):
 * Platform scope (M17) operates ACROSS tenants — the SUPER_ADMIN principal has
 * clinicId null, so there is no tenant context and `prisma.db` would refuse to
 * run for tenant-scoped models. Every query below is therefore made through
 * `prisma.unscoped` and, where it targets a single clinic, carries an explicit
 * clinicId filter derived from the validated route parameter.
 */

const IMPERSONATION_TTL = '30m';
/** "Expiring soon" bucket for the clinic-list filter. */
const EXPIRING_SOON_DAYS = 3;

// ----------------------------------------------------------------- responses

export interface PlanResponse {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  maxBranches: number;
  maxUsers: number;
  modules: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionResponse {
  id: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string | null;
  /** Whole days until endsAt; 0 once lapsed; null when perpetual. */
  daysLeft: number | null;
  isExpired: boolean;
  plan: PlanResponse;
}

export interface ClinicUsage {
  branches: number;
  users: number;
  patients: number;
  visitsLast30d: number;
}

export interface ClinicBaseResponse {
  id: string;
  name: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicListItemResponse extends ClinicBaseResponse {
  subscription: SubscriptionResponse | null;
  usage: ClinicUsage;
}

export interface FeatureFlagResponse {
  key: string;
  enabled: boolean;
}

export interface ClinicDetailResponse extends ClinicBaseResponse {
  subscription: SubscriptionResponse | null;
  featureFlags: FeatureFlagResponse[];
}

export interface ClinicOwnerResponse {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: string;
}

export interface CreatedClinicResponse {
  clinic: ClinicBaseResponse;
  branch: { id: string; name: string };
  owner: ClinicOwnerResponse;
  subscription: SubscriptionResponse;
}

export interface PlatformAnalyticsResponse {
  activeClinics: number;
  totalUsers: number;
  totalPatients: number;
  visitsLast30dPerDay: Array<{ date: string; count: number }>;
  paymentsLast30dSum: string;
}

export interface ImpersonationResponse {
  accessToken: string;
  user: { id: string; fullName: string };
}

// ----------------------------------------------------------------- internals

type PlanRecord = Prisma.SubscriptionPlanGetPayload<Record<string, never>>;
type SubscriptionWithPlan = Prisma.ClinicSubscriptionGetPayload<{ include: { plan: true } }>;
type ClinicRecord = Prisma.ClinicGetPayload<Record<string, never>>;

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly provisioning: ClinicProvisioningService,
    private readonly subscriptions: SubscriptionService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------- clinics

  async createClinicWithOwner(input: CreateClinicWithOwnerDto): Promise<CreatedClinicResponse> {
    const result = await this.provisioning.provision({
      clinic: input.clinic,
      owner: input.owner,
      planCode: input.planCode,
      source: 'super-admin',
    });

    return {
      clinic: this.toClinicBase(result.clinic),
      branch: { id: result.branch.id, name: result.branch.name },
      owner: {
        id: result.owner.id,
        fullName: result.owner.fullName,
        phone: result.owner.phone,
        email: result.owner.email,
        role: result.owner.role,
      },
      subscription: this.toSubscription(result.subscription),
    };
  }

  async listClinics(query: ClinicListQueryDto): Promise<PaginatedResult<ClinicListItemResponse>> {
    const where: Prisma.ClinicWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { legalName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.subscription ? { subscriptions: { some: this.subscriptionFilter(query.subscription) } } : {}),
    };

    const [clinics, total] = await Promise.all([
      this.prisma.unscoped.clinic.findMany({
        where,
        include: {
          // Only LIVE rows — the same selector SubscriptionService uses, so the
          // panel never shows a stale CANCELLED row as "the" subscription.
          subscriptions: {
            where: {
              status: {
                in: [
                  SubscriptionStatus.TRIAL,
                  SubscriptionStatus.ACTIVE,
                  SubscriptionStatus.PAST_DUE,
                ],
              },
            },
            orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            include: { plan: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.unscoped.clinic.count({ where }),
    ]);

    const usageByClinic = await this.usageForClinics(clinics.map((c) => c.id));

    return paginated(
      clinics.map((clinic) => ({
        ...this.toClinicBase(clinic),
        subscription: clinic.subscriptions[0] ? this.toSubscription(clinic.subscriptions[0]) : null,
        usage: usageByClinic.get(clinic.id) ?? {
          branches: 0,
          users: 0,
          patients: 0,
          visitsLast30d: 0,
        },
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async getClinic(id: string): Promise<ClinicDetailResponse> {
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id },
      include: {
        // Live rows only — same selector as the list and SubscriptionService.
        subscriptions: {
          where: {
            status: {
              in: [
                SubscriptionStatus.TRIAL,
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.PAST_DUE,
              ],
            },
          },
          orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          include: { plan: true },
        },
        featureFlags: { orderBy: { key: 'asc' } },
      },
    });
    if (!clinic) throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);

    return {
      ...this.toClinicBase(clinic),
      subscription: clinic.subscriptions[0] ? this.toSubscription(clinic.subscriptions[0]) : null,
      featureFlags: clinic.featureFlags.map((f) => ({ key: f.key, enabled: f.enabled })),
    };
  }

  async updateClinicStatus(id: string, input: UpdateClinicStatusDto): Promise<ClinicBaseResponse> {
    const clinic = await this.requireClinic(id);
    if (clinic.status === input.status) return this.toClinicBase(clinic);

    const updated = await this.prisma.unscoped.clinic.update({
      where: { id },
      data: { status: input.status },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Clinic',
      entityId: id,
      clinicId: id,
      before: { status: clinic.status },
      after: { status: input.status },
    });

    return this.toClinicBase(updated);
  }

  // ------------------------------------------------------------- plans

  async listPlans(): Promise<PaginatedResult<PlanResponse>> {
    const plans = await this.prisma.unscoped.subscriptionPlan.findMany({
      orderBy: { priceMonthly: 'asc' },
    });
    return paginated(
      plans.map((p) => this.toPlan(p)),
      { page: 1, limit: Math.max(plans.length, 1), total: plans.length },
    );
  }

  /** Create-or-update by the unique plan `code`. */
  async upsertPlan(input: PlanUpsertDto): Promise<PlanResponse> {
    const data = {
      name: input.name,
      priceMonthly: input.priceMonthly,
      maxBranches: input.maxBranches,
      maxUsers: input.maxUsers,
      modules: input.modules,
      isActive: true,
    };
    const plan = await this.prisma.unscoped.subscriptionPlan.upsert({
      where: { code: input.code },
      create: { code: input.code, ...data },
      update: data,
    });
    return this.toPlan(plan);
  }

  async updatePlan(id: string, input: PlanUpdateDto): Promise<PlanResponse> {
    const existing = await this.prisma.unscoped.subscriptionPlan.findUnique({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Plan not found', 404);

    if (input.code && input.code !== existing.code) {
      const clash = await this.prisma.unscoped.subscriptionPlan.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (clash) throw new AppException(ErrorCode.CONFLICT, 'Plan code is already in use', 409);
    }

    const plan = await this.prisma.unscoped.subscriptionPlan.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.priceMonthly !== undefined ? { priceMonthly: input.priceMonthly } : {}),
        ...(input.maxBranches !== undefined ? { maxBranches: input.maxBranches } : {}),
        ...(input.maxUsers !== undefined ? { maxUsers: input.maxUsers } : {}),
        ...(input.modules !== undefined ? { modules: input.modules } : {}),
      },
    });
    return this.toPlan(plan);
  }

  /** Soft delete — subscriptions keep referencing the row; it just stops being assignable. */
  async deactivatePlan(id: string): Promise<PlanResponse> {
    const existing = await this.prisma.unscoped.subscriptionPlan.findUnique({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Plan not found', 404);
    const plan = await this.prisma.unscoped.subscriptionPlan.update({
      where: { id },
      data: { isActive: false },
    });
    return this.toPlan(plan);
  }

  // ------------------------------------------------------------- subscription & flags

  async assignPlan(clinicId: string, input: AssignPlanDto): Promise<SubscriptionResponse> {
    await this.requireClinic(clinicId);
    const plan = await this.prisma.unscoped.subscriptionPlan.findUnique({
      where: { id: input.planId },
    });
    if (!plan) throw new AppException(ErrorCode.NOT_FOUND, 'Plan not found', 404);

    const status = input.status ?? SubscriptionStatus.ACTIVE;
    const now = new Date();

    const subscription = await this.prisma.unscoped.$transaction(async (tx) => {
      // Close out any live subscription before the new one takes over.
      await tx.clinicSubscription.updateMany({
        where: {
          clinicId,
          status: {
            in: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
          },
        },
        data: { status: SubscriptionStatus.CANCELLED, endsAt: now },
      });
      return tx.clinicSubscription.create({
        data: {
          clinicId,
          planId: plan.id,
          status,
          startsAt: now,
          endsAt:
            status === SubscriptionStatus.TRIAL
              ? daysFromNow(this.config.env.TRIAL_DAYS, now)
              : null,
        },
        include: { plan: true },
      });
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'ClinicSubscription',
      entityId: subscription.id,
      clinicId,
      after: { planId: plan.id, planCode: plan.code, status },
    });

    await this.subscriptions.invalidate(clinicId);
    return this.toSubscription(subscription);
  }

  /**
   * Edit the clinic's CURRENT subscription in place — extend/shorten a trial,
   * pin an end date, switch plan or status. Unlike assignPlan this keeps the
   * same row (and its startsAt), so the trial clock is adjusted, not reset.
   */
  async updateSubscription(
    clinicId: string,
    input: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    await this.requireClinic(clinicId);
    const current = await this.subscriptions.currentSubscription(clinicId);
    if (!current) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'Clinic has no live subscription — assign a plan first',
        404,
      );
    }

    const data: Prisma.ClinicSubscriptionUpdateInput = {};
    if (input.planId !== undefined) {
      const plan = await this.prisma.unscoped.subscriptionPlan.findUnique({
        where: { id: input.planId },
      });
      if (!plan) throw new AppException(ErrorCode.NOT_FOUND, 'Plan not found', 404);
      data.plan = { connect: { id: plan.id } };
    }
    if (input.status !== undefined) data.status = input.status;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (input.extendDays !== undefined) {
      const now = new Date();
      // Extend from the current end date, or from now when it has already lapsed
      // (or is perpetual) — so "+7 days" always means 7 usable days from today.
      const base =
        current.endsAt && current.endsAt.getTime() > now.getTime() ? current.endsAt : now;
      data.endsAt = daysFromNow(input.extendDays, base);
    }

    const updated = await this.prisma.unscoped.clinicSubscription.update({
      where: { id: current.id },
      data,
      include: { plan: true },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'ClinicSubscription',
      entityId: updated.id,
      clinicId,
      before: { status: current.status, endsAt: current.endsAt?.toISOString() ?? null },
      after: { status: updated.status, endsAt: updated.endsAt?.toISOString() ?? null },
    });

    await this.subscriptions.invalidate(clinicId);
    return this.toSubscription(updated);
  }

  async setFeatureFlag(clinicId: string, input: FeatureFlagSetDto): Promise<FeatureFlagResponse> {
    await this.requireClinic(clinicId);
    const flag = await this.prisma.unscoped.featureFlag.upsert({
      where: { clinicId_key: { clinicId, key: input.key } },
      create: { clinicId, key: input.key, enabled: input.enabled },
      update: { enabled: input.enabled },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'FeatureFlag',
      entityId: flag.id,
      clinicId,
      after: { key: flag.key, enabled: flag.enabled },
    });

    return { key: flag.key, enabled: flag.enabled };
  }

  // ------------------------------------------------------------- analytics

  async analytics(): Promise<PlatformAnalyticsResponse> {
    const since = daysFromNow(-30);

    const [activeClinics, totalUsers, totalPatients, visitRows, paymentsSum] = await Promise.all([
      this.prisma.unscoped.clinic.count({ where: { status: ClinicStatus.ACTIVE } }),
      this.prisma.unscoped.user.count({
        where: { deletedAt: null, role: { not: UserRole.SUPER_ADMIN } },
      }),
      this.prisma.unscoped.patient.count({ where: { deletedAt: null } }),
      this.prisma.unscoped.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', "startedAt") AS day, COUNT(*)::bigint AS count
        FROM "Visit"
        WHERE "startedAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.unscoped.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'COMPLETED', paidAt: { gte: since } },
      }),
    ]);

    return {
      activeClinics,
      totalUsers,
      totalPatients,
      visitsLast30dPerDay: visitRows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        count: Number(row.count),
      })),
      paymentsLast30dSum: (paymentsSum._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }

  // ------------------------------------------------------------- impersonation

  async impersonate(clinicId: string, actor: AuthUser): Promise<ImpersonationResponse> {
    await this.requireClinic(clinicId);

    const owner = await this.prisma.unscoped.user.findFirst({
      where: {
        clinicId,
        role: UserRole.CLINIC_OWNER,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic owner account not found', 404);
    }

    const payload: JwtPayload = {
      sub: owner.id,
      clinicId,
      role: UserRole.CLINIC_OWNER,
      sid: 'impersonation',
      impersonatedBy: actor.id,
    };
    const accessToken = await this.jwt.signAsync(
      { ...payload },
      { expiresIn: IMPERSONATION_TTL },
    );

    await this.audit.log({
      action: AuditAction.IMPERSONATE,
      entity: 'User',
      entityId: owner.id,
      clinicId,
      userId: actor.id,
    });

    return { accessToken, user: { id: owner.id, fullName: owner.fullName } };
  }

  // ------------------------------------------------------------- helpers

  private async requireClinic(id: string): Promise<ClinicRecord> {
    const clinic = await this.prisma.unscoped.clinic.findUnique({ where: { id } });
    if (!clinic) throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    return clinic;
  }

  /** Prisma filter for the subscription buckets exposed by the clinic list. */
  private subscriptionFilter(bucket: SubscriptionFilter): Prisma.ClinicSubscriptionWhereInput {
    const now = new Date();
    switch (bucket) {
      case 'trial':
        return { status: SubscriptionStatus.TRIAL, endsAt: { gt: now } };
      case 'expiring':
        return {
          status: { in: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE] },
          endsAt: { gt: now, lte: daysFromNow(EXPIRING_SOON_DAYS, now) },
        };
      case 'expired':
        return {
          status: {
            in: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
          },
          endsAt: { lte: now },
        };
      case 'paid':
        return { status: SubscriptionStatus.ACTIVE };
    }
  }

  /** Grouped counts for the clinics on the current page — avoids per-clinic N+1. */
  private async usageForClinics(clinicIds: string[]): Promise<Map<string, ClinicUsage>> {
    const usage = new Map<string, ClinicUsage>();
    if (clinicIds.length === 0) return usage;
    for (const id of clinicIds) {
      usage.set(id, { branches: 0, users: 0, patients: 0, visitsLast30d: 0 });
    }
    const since = daysFromNow(-30);

    const [branches, users, patients, visits] = await Promise.all([
      this.prisma.unscoped.branch.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds } },
        _count: { _all: true },
      }),
      this.prisma.unscoped.user.groupBy({
        by: ['clinicId'],
        where: {
          clinicId: { in: clinicIds },
          deletedAt: null,
          role: { notIn: [UserRole.SUPER_ADMIN, UserRole.PATIENT] },
        },
        _count: { _all: true },
      }),
      this.prisma.unscoped.patient.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.unscoped.visit.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds }, startedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const apply = (
      rows: Array<{ clinicId: string | null; _count: { _all: number } }>,
      key: keyof ClinicUsage,
    ): void => {
      for (const row of rows) {
        if (!row.clinicId) continue;
        const entry = usage.get(row.clinicId);
        if (entry) entry[key] = row._count._all;
      }
    };
    apply(branches, 'branches');
    apply(users, 'users');
    apply(patients, 'patients');
    apply(visits, 'visitsLast30d');

    return usage;
  }

  // ------------------------------------------------------------- mappers

  private toClinicBase(clinic: ClinicRecord): ClinicBaseResponse {
    return {
      id: clinic.id,
      name: clinic.name,
      legalName: clinic.legalName,
      phone: clinic.phone,
      email: clinic.email,
      status: clinic.status,
      createdAt: clinic.createdAt.toISOString(),
      updatedAt: clinic.updatedAt.toISOString(),
    };
  }

  private toPlan(plan: PlanRecord): PlanResponse {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      priceMonthly: plan.priceMonthly.toFixed(2),
      maxBranches: plan.maxBranches,
      maxUsers: plan.maxUsers,
      modules: plan.modules,
      isActive: plan.isActive,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  private toSubscription(sub: SubscriptionWithPlan): SubscriptionResponse {
    // Days-left is computed server-side so every client agrees on the number
    // regardless of the viewer's timezone (UTC storage, Asia/Tashkent display).
    const now = Date.now();
    const endsAtMs = sub.endsAt?.getTime() ?? null;
    return {
      id: sub.id,
      status: sub.status as SubscriptionStatus,
      startsAt: sub.startsAt.toISOString(),
      endsAt: sub.endsAt?.toISOString() ?? null,
      daysLeft:
        endsAtMs === null ? null : endsAtMs <= now ? 0 : Math.ceil((endsAtMs - now) / 86_400_000),
      isExpired: endsAtMs !== null && endsAtMs <= now,
      plan: this.toPlan(sub.plan),
    };
  }
}
