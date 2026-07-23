import { Injectable } from '@nestjs/common';
import type { Prisma} from '@prisma/client';
import { SubscriptionStatus, type Clinic, Locale as DbLocale } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  Locale,
  clinicSettingsSchema,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { UpdateClinicDto, UpdateClinicSettingsDto } from './dto';

/** Shared wire locale ('uz-Cyrl') <-> Prisma enum member ('uz_Cyrl'). */
const LOCALE_TO_DB: Record<Locale, DbLocale> = {
  [Locale.UZ]: DbLocale.uz,
  [Locale.UZ_CYRL]: DbLocale.uz_Cyrl,
  [Locale.RU]: DbLocale.ru,
  [Locale.EN]: DbLocale.en,
};
const LOCALE_TO_WIRE: Record<DbLocale, Locale> = {
  [DbLocale.uz]: Locale.UZ,
  [DbLocale.uz_Cyrl]: Locale.UZ_CYRL,
  [DbLocale.ru]: Locale.RU,
  [DbLocale.en]: Locale.EN,
};

export interface ClinicResponse {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  defaultLocale: Locale;
  smsSenderName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  subscription: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
    plan: {
      id: string;
      code: string;
      name: string;
      priceMonthly: string;
      maxBranches: number;
      maxUsers: number;
      modules: string[];
    };
  } | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge `patch` over `base`: nested plain objects merge, everything else replaces. */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getClinic(): Promise<ClinicResponse> {
    const clinicId = TenantContext.requireClinicId();
    // Clinic is the tenant ROOT model and is not covered by the tenant auto-scoping
    // extension; we pin the id to the current tenant explicitly (justified unscoped use).
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      include: {
        subscriptions: {
          where: { status: { in: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });
    if (!clinic) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }
    const sub = clinic.subscriptions[0] ?? null;
    return {
      ...this.mapClinic(clinic),
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            startsAt: sub.startsAt.toISOString(),
            endsAt: sub.endsAt ? sub.endsAt.toISOString() : null,
            plan: {
              id: sub.plan.id,
              code: sub.plan.code,
              name: sub.plan.name,
              priceMonthly: sub.plan.priceMonthly.toFixed(2),
              maxBranches: sub.plan.maxBranches,
              maxUsers: sub.plan.maxUsers,
              modules: sub.plan.modules,
            },
          }
        : null,
    };
  }

  async updateClinic(dto: UpdateClinicDto): Promise<ClinicResponse> {
    const clinicId = TenantContext.requireClinicId();
    // Clinic is not auto-scoped — id pinned to the current tenant (justified unscoped use).
    const before = await this.prisma.unscoped.clinic.findUnique({ where: { id: clinicId } });
    if (!before) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }
    const after = await this.prisma.unscoped.clinic.update({
      where: { id: clinicId },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.taxId,
        // Empty string explicitly clears the logo; undefined leaves it untouched.
        logoUrl: dto.logoUrl === undefined ? undefined : dto.logoUrl === '' ? null : dto.logoUrl,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        defaultLocale: dto.defaultLocale ? LOCALE_TO_DB[dto.defaultLocale] : undefined,
        smsSenderName: dto.smsSenderName,
      },
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Clinic',
      entityId: clinicId,
      before: this.auditableClinicFields(before),
      after: this.auditableClinicFields(after),
    });
    return { ...this.mapClinic(after), subscription: null };
  }

  async getSettings(): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();
    // Clinic is not auto-scoped — id pinned to the current tenant (justified unscoped use).
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: { settings: true },
    });
    if (!clinic) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }
    return isPlainObject(clinic.settings) ? clinic.settings : {};
  }

  async updateSettings(dto: UpdateClinicSettingsDto): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();
    const before = await this.getSettings();
    const merged = deepMerge(before, dto as Record<string, unknown>);
    const parsed = clinicSettingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Merged clinic settings are invalid',
        400,
        parsed.error.issues,
      );
    }
    // Clinic is not auto-scoped — id pinned to the current tenant (justified unscoped use).
    await this.prisma.unscoped.clinic.update({
      where: { id: clinicId },
      data: { settings: merged as Prisma.InputJsonValue },
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'ClinicSettings',
      entityId: clinicId,
      before,
      after: merged,
    });
    return merged;
  }

  private mapClinic(clinic: Clinic): Omit<ClinicResponse, 'subscription'> {
    return {
      id: clinic.id,
      name: clinic.name,
      legalName: clinic.legalName,
      taxId: clinic.taxId,
      logoUrl: clinic.logoUrl,
      phone: clinic.phone,
      email: clinic.email,
      address: clinic.address,
      defaultLocale: LOCALE_TO_WIRE[clinic.defaultLocale],
      smsSenderName: clinic.smsSenderName,
      status: clinic.status,
      createdAt: clinic.createdAt.toISOString(),
      updatedAt: clinic.updatedAt.toISOString(),
    };
  }

  /** Fields worth diffing in the audit log (excludes the settings blob — audited separately). */
  private auditableClinicFields(clinic: Clinic): Record<string, unknown> {
    return {
      name: clinic.name,
      legalName: clinic.legalName,
      taxId: clinic.taxId,
      // Log only whether a logo is set — the data URI itself can be large.
      hasLogo: Boolean(clinic.logoUrl),
      phone: clinic.phone,
      email: clinic.email,
      address: clinic.address,
      defaultLocale: clinic.defaultLocale,
      smsSenderName: clinic.smsSenderName,
    };
  }
}
