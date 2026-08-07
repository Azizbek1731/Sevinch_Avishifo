import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  AuditAction,
  ErrorCode,
  Locale,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export const FIRST_BRANCH_NAME = "Asosiy filial";

type PlanRecord = Prisma.SubscriptionPlanGetPayload<Record<string, never>>;
type SubscriptionWithPlan = Prisma.ClinicSubscriptionGetPayload<{ include: { plan: true } }>;
type ClinicRecord = Prisma.ClinicGetPayload<Record<string, never>>;
type BranchRecord = Prisma.BranchGetPayload<Record<string, never>>;
type UserRecord = Prisma.UserGetPayload<Record<string, never>>;

export function daysFromNow(days: number, from = new Date()): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export interface ProvisionClinicInput {
  clinic: { name: string; legalName?: string; phone?: string; email?: string };
  owner: { fullName: string; phone: string; email?: string; password: string; locale?: Locale };
  /** SubscriptionPlan.code; the cheapest active plan is used when omitted. */
  planCode?: string;
  /** Trial length; falls back to the TRIAL_DAYS env setting. */
  trialDays?: number;
  /** How the clinic came to exist — recorded in the audit log. */
  source: 'super-admin' | 'self-signup';
}

export interface ProvisionedClinic {
  clinic: ClinicRecord;
  branch: BranchRecord;
  owner: UserRecord;
  subscription: SubscriptionWithPlan;
  plan: PlanRecord;
}

/**
 * Creates a clinic together with its first branch, its CLINIC_OWNER and a trial
 * subscription — in one transaction. Shared by the super-admin panel and by
 * public self-service sign-up so the two can never drift apart.
 *
 * prisma.unscoped justified throughout: a clinic is being created, so no tenant
 * context exists yet and every write carries its clinicId explicitly.
 */
@Injectable()
export class ClinicProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** Plan by code, or the cheapest active plan when no code was supplied. */
  async resolvePlan(planCode?: string): Promise<PlanRecord> {
    if (planCode) {
      const plan = await this.prisma.unscoped.subscriptionPlan.findUnique({
        where: { code: planCode },
      });
      if (!plan || !plan.isActive) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Subscription plan not found', 404);
      }
      return plan;
    }
    const cheapest = await this.prisma.unscoped.subscriptionPlan.findFirst({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
    if (!cheapest) {
      throw new AppException(ErrorCode.NOT_FOUND, 'No active subscription plan available', 404);
    }
    return cheapest;
  }

  async provision(input: ProvisionClinicInput): Promise<ProvisionedClinic> {
    const plan = await this.resolvePlan(input.planCode);
    const trialDays = input.trialDays ?? this.config.env.TRIAL_DAYS;
    // Hash outside the transaction (argon2 is slow; keep the tx short).
    const passwordHash = await argon2.hash(input.owner.password, { type: argon2.argon2id });

    const now = new Date();
    const result = await this.prisma.unscoped.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
        data: {
          name: input.clinic.name,
          legalName: input.clinic.legalName ?? null,
          phone: input.clinic.phone ?? null,
          email: input.clinic.email ?? null,
          settings: {},
        },
      });

      const branch = await tx.branch.create({
        data: { clinicId: clinic.id, name: FIRST_BRANCH_NAME },
      });

      const owner = await tx.user.create({
        data: {
          clinicId: clinic.id,
          fullName: input.owner.fullName,
          phone: input.owner.phone,
          email: input.owner.email ?? null,
          passwordHash,
          role: UserRole.CLINIC_OWNER,
          status: UserStatus.ACTIVE,
          ...(input.owner.locale ? { locale: input.owner.locale.replace('-', '_') as never } : {}),
          branches: {
            // nested create is not auto-stamped — clinicId set explicitly
            create: [{ clinicId: clinic.id, branchId: branch.id }],
          },
        },
      });

      const subscription = await tx.clinicSubscription.create({
        data: {
          clinicId: clinic.id,
          planId: plan.id,
          status: SubscriptionStatus.TRIAL,
          startsAt: now,
          endsAt: daysFromNow(trialDays, now),
        },
        include: { plan: true },
      });

      return { clinic, branch, owner, subscription };
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Clinic',
      entityId: result.clinic.id,
      clinicId: result.clinic.id,
      // never log the password or its hash
      after: {
        name: result.clinic.name,
        legalName: result.clinic.legalName,
        phone: result.clinic.phone,
        email: result.clinic.email,
        ownerId: result.owner.id,
        branchId: result.branch.id,
        planCode: plan.code,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialDays,
        source: input.source,
      },
    });

    return { ...result, plan };
  }
}
