import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  AppointmentStatus,
  AuditAction,
  ClinicStatus,
  ErrorCode,
  InvoiceStatus,
  LabOrderStatus,
  UserRole,
  UserStatus,
  VisitStatus,
  normalizePhone,
  type PortalCancelAppointmentInput,
  type PortalRequestOtpInput,
  type PortalVerifyOtpInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { SlotsService } from '../appointments/slots.service';
import { type FreeSlot } from '../appointments/slots.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  PortalAppointmentsQueryInput,
  PortalBookExtendedInput,
  PortalFeedbackInput,
} from './dto';

const OTP_PURPOSE = 'portal_login';
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const PORTAL_TOKEN_TTL = '30d';
const CANCEL_MIN_MS = 2 * 3_600_000; // cancellation cutoff: 2h before start

const ARGON2_OPTS: argon2.Options = { type: argon2.argon2id };

/** "+998901234567" → "+998 90*****67" — keep PHI out of log lines. */
function maskPhone(phone: string): string {
  return `${phone.slice(0, 7)}*****${phone.slice(-2)}`;
}

interface PageQuery {
  page: number;
  limit: number;
}

// ---------------------------------------------------------------- output DTOs

export interface PortalClinicDto {
  id: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  onlineBookingEnabled: boolean;
  branches: Array<{
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
    workingHours: unknown;
  }>;
  doctors: Array<{
    id: string;
    fullName: string;
    specialty: string | null;
    photoUrl: string | null;
    bio: string | null;
  }>;
  services: Array<{
    id: string;
    code: string;
    name: unknown;
    durationMin: number;
    category: { name: string; kind: string } | null;
    /** Current clinic-default price as a decimal string, null if not priced. */
    price: string | null;
  }>;
}

export interface PortalBookingResultDto {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface PortalPatientCardDto {
  clinicId: string;
  clinicName: string;
  patientId: string;
  mrn: string;
  fullName: string;
}

export interface PortalAppointmentDto {
  id: string;
  clinicId: string;
  clinicName: string;
  branchId: string;
  doctorName: string;
  startAt: string;
  endAt: string;
  status: string;
  note: string | null;
  cancelledReason: string | null;
}

export interface PortalVisitDto {
  id: string;
  clinicId: string;
  clinicName: string;
  doctorName: string;
  startedAt: string;
  completedAt: string | null;
  diagnoses: Array<{
    code: string;
    nameUz: string;
    nameRu: string;
    nameEn: string | null;
    isPrimary: boolean;
  }>;
}

export interface PortalLabOrderDto {
  id: string;
  clinicId: string;
  clinicName: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  items: Array<{
    id: string;
    testCode: string;
    testName: unknown;
    result: {
      approvedAt: string | null;
      note: string | null;
      values: Array<{
        parameter: string;
        unit: string | null;
        value: string;
        flag: string;
      }>;
    } | null;
  }>;
}

export interface PortalInvoiceDto {
  id: string;
  clinicId: string;
  clinicName: string;
  number: string;
  status: string;
  subtotal: string;
  discountTotal: string;
  total: string;
  paidTotal: string;
  issuedAt: string | null;
  createdAt: string;
}

/**
 * Patient-facing portal API (spec §M14): OTP login, public clinic catalog,
 * online booking and the personal cabinet.
 *
 * Tenancy note: portal requests carry no staff tenant context. Cabinet reads
 * use `prisma.unscoped` restricted to patient cards linked to the OTP-verified
 * phone (the patient owns those records across clinics); booking resolves the
 * clinic from the branch and runs inside TenantContext.run.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly appointments: AppointmentsService,
    private readonly slots: SlotsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------- auth

  async requestOtp(input: PortalRequestOtpInput): Promise<{ requested: true }> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid phone number', 400);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Unscoped (justified): OtpCode is a platform model (no clinicId), pre-auth flow.
    await this.prisma.unscoped.otpCode.updateMany({
      where: { phone, purpose: OTP_PURPOSE, usedAt: null },
      data: { usedAt: new Date() }, // invalidate previous outstanding codes
    });
    await this.prisma.unscoped.otpCode.create({
      data: {
        phone,
        codeHash: await argon2.hash(code, ARGON2_OPTS),
        purpose: OTP_PURPOSE,
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    });

    // Log-mode SMS delivery (spec §M14): the portal must not depend on the
    // notification channels. Phone is masked to keep PHI out of logs.
    this.logger.log(`[PORTAL OTP → ${maskPhone(phone)}]: ${code} (expires in ${OTP_TTL_MINUTES}m)`);
    return { requested: true };
  }

  async verifyOtp(input: PortalVerifyOtpInput): Promise<{ accessToken: string; phone: string }> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid phone number', 400);
    }

    // Unscoped (justified): OtpCode is a platform model, pre-auth flow.
    const otp = await this.prisma.unscoped.otpCode.findFirst({
      where: { phone, purpose: OTP_PURPOSE, usedAt: null },
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

    const ok = await argon2.verify(otp.codeHash, input.code).catch(() => false);
    if (!ok) {
      await this.prisma.unscoped.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException(ErrorCode.OTP_INVALID, 'Invalid code', 400);
    }

    await this.prisma.unscoped.otpCode.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    const accessToken = await this.jwt.signAsync(
      { typ: 'portal', sub: phone, sid: randomUUID() },
      { expiresIn: PORTAL_TOKEN_TTL },
    );
    return { accessToken, phone };
  }

  // --------------------------------------------------------- public catalog

  async getClinic(clinicId: string): Promise<PortalClinicDto> {
    // Unscoped (justified): public catalog endpoint — read-only, whitelisted
    // fields only, every query explicitly scoped to the requested clinicId.
    const clinic = await this.prisma.unscoped.clinic.findFirst({
      where: { id: clinicId, status: ClinicStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        phone: true,
        email: true,
        address: true,
        settings: true,
      },
    });
    if (!clinic) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }

    const [branches, doctors, services, priceRows] = await Promise.all([
      this.prisma.unscoped.branch.findMany({
        where: { clinicId, isActive: true },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          latitude: true,
          longitude: true,
          workingHours: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.unscoped.user.findMany({
        where: { clinicId, role: UserRole.DOCTOR, status: UserStatus.ACTIVE, deletedAt: null },
        select: {
          id: true,
          fullName: true,
          staffProfile: { select: { specialty: true, photoUrl: true, bio: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.unscoped.service.findMany({
        where: { clinicId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          durationMin: true,
          category: { select: { name: true, kind: true } },
        },
        orderBy: { code: 'asc' },
      }),
      // Latest clinic-default price per service in one grouped query
      // (DISTINCT ON keeps the newest effective row per serviceId).
      this.prisma.unscoped.$queryRaw<Array<{ serviceId: string; price: Prisma.Decimal }>>`
        SELECT DISTINCT ON ("serviceId") "serviceId", "price"
        FROM "ServicePrice"
        WHERE "clinicId" = ${clinicId}
          AND "branchId" IS NULL
          AND "effectiveFrom" <= now()
          AND ("effectiveTo" IS NULL OR "effectiveTo" > now())
        ORDER BY "serviceId", "effectiveFrom" DESC`,
    ]);

    const priceByService = new Map<string, string>(
      priceRows.map((r) => [r.serviceId, r.price.toFixed(2)]),
    );

    return {
      id: clinic.id,
      name: clinic.name,
      logoUrl: clinic.logoUrl,
      phone: clinic.phone,
      email: clinic.email,
      address: clinic.address,
      onlineBookingEnabled: this.onlineBookingEnabled(clinic.settings),
      branches,
      doctors: doctors.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        specialty: d.staffProfile?.specialty ?? null,
        photoUrl: d.staffProfile?.photoUrl ?? null,
        bio: d.staffProfile?.bio ?? null,
      })),
      services: services.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        durationMin: s.durationMin,
        category: s.category ? { name: s.category.name, kind: s.category.kind } : null,
        price: priceByService.get(s.id) ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------- booking

  async getSlots(q: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    date: string;
    serviceId?: string;
  }): Promise<FreeSlot[]> {
    // Unscoped (justified): public pre-auth lookup — validates that the branch
    // belongs to the requested clinic before entering its tenant context.
    const branch = await this.prisma.unscoped.branch.findFirst({
      where: { id: q.branchId, clinicId: q.clinicId, isActive: true },
      select: { id: true },
    });
    if (!branch) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    }

    return TenantContext.run({ clinicId: q.clinicId }, () =>
      this.slots.getFreeSlots({
        doctorUserId: q.doctorUserId,
        branchId: q.branchId,
        date: q.date,
        serviceId: q.serviceId,
      }),
    );
  }

  async book(phone: string, input: PortalBookExtendedInput): Promise<PortalBookingResultDto> {
    // Unscoped (justified): the tenant is resolved from the branch — portal
    // requests carry no clinic context of their own.
    const branch = await this.prisma.unscoped.branch.findFirst({
      where: { id: input.branchId, isActive: true },
      select: { id: true, clinicId: true },
    });
    if (!branch) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    }
    const clinicId = branch.clinicId;

    // Unscoped (justified): clinic root row lookup for the booking toggle.
    const clinic = await this.prisma.unscoped.clinic.findFirst({
      where: { id: clinicId, status: ClinicStatus.ACTIVE },
      select: { settings: true },
    });
    if (!clinic) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }
    if (!this.onlineBookingEnabled(clinic.settings)) {
      throw new AppException(
        ErrorCode.FEATURE_DISABLED,
        'Online booking is disabled for this clinic',
        403,
      );
    }

    return TenantContext.run({ clinicId }, async () => {
      let patient = await this.prisma.db.patient.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });

      if (!patient) {
        if (!input.firstName || !input.lastName) {
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'firstName and lastName are required for the first booking in this clinic',
            400,
          );
        }
        const mrn = await this.sequence.nextFormatted('mrn', 'P');
        patient = await this.prisma.db.patient.create({
          data: {
            // Top-level create is auto-stamped by the tenant extension, but the
            // Prisma input type requires clinicId — same value, kept explicit.
            clinicId,
            mrn,
            firstName: input.firstName,
            lastName: input.lastName,
            fullName: `${input.lastName} ${input.firstName}`,
            phone,
            source: 'portal',
          },
          select: { id: true },
        });
        await this.audit.log({
          action: AuditAction.CREATE,
          entity: 'Patient',
          entityId: patient.id,
          clinicId,
          after: { mrn, source: 'portal' },
        });
      }

      const created = await this.appointments.create(
        {
          patientId: patient.id,
          branchId: input.branchId,
          doctorUserId: input.doctorUserId,
          serviceIds: input.serviceId ? [input.serviceId] : undefined,
          startAt: input.startAt,
          walkIn: false,
        },
        null,
      );

      return {
        id: created.id,
        startAt: created.startAt.toISOString(),
        endAt: created.endAt.toISOString(),
        status: created.status,
      };
    });
  }

  // ---------------------------------------------------------------- cabinet

  async me(phone: string): Promise<PortalPatientCardDto[]> {
    const patients = await this.ownPatients(phone);
    const clinicNames = await this.clinicNames(patients.map((p) => p.clinicId));
    return patients.map((p) => ({
      clinicId: p.clinicId,
      clinicName: clinicNames.get(p.clinicId) ?? '',
      patientId: p.id,
      mrn: p.mrn,
      fullName: p.fullName,
    }));
  }

  async meAppointments(
    phone: string,
    query: PortalAppointmentsQueryInput,
  ): Promise<PaginatedResult<PortalAppointmentDto>> {
    const now = new Date();
    const where: Prisma.AppointmentWhereInput = {
      patient: { phone, deletedAt: null },
      startAt: query.scope === 'upcoming' ? { gte: now } : { lt: now },
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics, linked by
    // the OTP-verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.appointment.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          branchId: true,
          startAt: true,
          endAt: true,
          status: true,
          note: true,
          cancelledReason: true,
          doctor: { select: { fullName: true } },
        },
        orderBy: { startAt: query.scope === 'upcoming' ? 'asc' : 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.appointment.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((a) => ({
        id: a.id,
        clinicId: a.clinicId,
        clinicName: clinicNames.get(a.clinicId) ?? '',
        branchId: a.branchId,
        doctorName: a.doctor.fullName,
        startAt: a.startAt.toISOString(),
        endAt: a.endAt.toISOString(),
        status: a.status,
        note: a.note,
        cancelledReason: a.cancelledReason,
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async cancelAppointment(
    phone: string,
    id: string,
    input: PortalCancelAppointmentInput,
  ): Promise<{ id: string; status: string }> {
    // Unscoped (justified): ownership is proven by the OTP-verified phone —
    // the relation filter restricts the lookup to the patient's own cards.
    const appointment = await this.prisma.unscoped.appointment.findFirst({
      where: { id, patient: { phone, deletedAt: null } },
      select: { id: true, clinicId: true, status: true, startAt: true },
    });
    if (!appointment) {
      throw new AppException(ErrorCode.APPOINTMENT_NOT_FOUND, 'Appointment not found', 404);
    }
    if (
      appointment.status !== AppointmentStatus.SCHEDULED &&
      appointment.status !== AppointmentStatus.CONFIRMED
    ) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Only scheduled or confirmed appointments can be cancelled',
        409,
      );
    }
    if (appointment.startAt.getTime() - Date.now() < CANCEL_MIN_MS) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'Appointments can be cancelled no later than 2 hours before the start',
        409,
      );
    }

    // Unscoped (justified): same ownership proof as the lookup above.
    await this.prisma.unscoped.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledReason: input.reason ?? 'Cancelled by patient via portal',
      },
    });
    await this.notifications.cancelAppointmentReminders(id);

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Appointment',
      entityId: id,
      clinicId: appointment.clinicId,
      before: { status: appointment.status },
      after: {
        status: AppointmentStatus.CANCELLED,
        reason: input.reason ?? null,
        cancelledBy: 'portal',
      },
    });

    return { id, status: AppointmentStatus.CANCELLED };
  }

  async meVisits(phone: string, query: PageQuery): Promise<PaginatedResult<PortalVisitDto>> {
    const where: Prisma.VisitWhereInput = {
      patient: { phone, deletedAt: null },
      status: VisitStatus.COMPLETED,
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.visit.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          startedAt: true,
          completedAt: true,
          doctor: { select: { fullName: true } },
          diagnoses: {
            select: {
              isPrimary: true,
              icd10: { select: { code: true, nameUz: true, nameRu: true, nameEn: true } },
            },
          },
        },
        orderBy: { startedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.visit.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((v) => ({
        id: v.id,
        clinicId: v.clinicId,
        clinicName: clinicNames.get(v.clinicId) ?? '',
        doctorName: v.doctor.fullName,
        startedAt: v.startedAt.toISOString(),
        completedAt: v.completedAt ? v.completedAt.toISOString() : null,
        diagnoses: v.diagnoses.map((d) => ({
          code: d.icd10.code,
          nameUz: d.icd10.nameUz,
          nameRu: d.icd10.nameRu,
          nameEn: d.icd10.nameEn,
          isPrimary: d.isPrimary,
        })),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async meLabResults(phone: string, query: PageQuery): Promise<PaginatedResult<PortalLabOrderDto>> {
    const where: Prisma.LabOrderWhereInput = {
      patient: { phone, deletedAt: null },
      status: { in: [LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED] },
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.labOrder.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          orderNumber: true,
          status: true,
          createdAt: true,
          deliveredAt: true,
          items: {
            select: {
              id: true,
              labTest: { select: { code: true, name: true } },
              result: {
                select: {
                  approvedAt: true,
                  note: true,
                  values: {
                    select: {
                      value: true,
                      flag: true,
                      parameter: { select: { name: true, unit: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.labOrder.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((o) => ({
        id: o.id,
        clinicId: o.clinicId,
        clinicName: clinicNames.get(o.clinicId) ?? '',
        orderNumber: o.orderNumber,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
        items: o.items.map((item) => ({
          id: item.id,
          testCode: item.labTest.code,
          testName: item.labTest.name,
          result: item.result
            ? {
                approvedAt: item.result.approvedAt ? item.result.approvedAt.toISOString() : null,
                note: item.result.note,
                values: item.result.values.map((v) => ({
                  parameter: v.parameter.name,
                  unit: v.parameter.unit,
                  value: v.value,
                  flag: v.flag,
                })),
              }
            : null,
        })),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async meInvoices(phone: string, query: PageQuery): Promise<PaginatedResult<PortalInvoiceDto>> {
    const where: Prisma.InvoiceWhereInput = {
      patient: { phone, deletedAt: null },
      status: { not: InvoiceStatus.DRAFT },
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.invoice.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          number: true,
          status: true,
          subtotal: true,
          discountTotal: true,
          total: true,
          paidTotal: true,
          issuedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.invoice.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((inv) => ({
        id: inv.id,
        clinicId: inv.clinicId,
        clinicName: clinicNames.get(inv.clinicId) ?? '',
        number: inv.number,
        status: inv.status,
        subtotal: inv.subtotal.toFixed(2),
        discountTotal: inv.discountTotal.toFixed(2),
        total: inv.total.toFixed(2),
        paidTotal: inv.paidTotal.toFixed(2),
        issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
        createdAt: inv.createdAt.toISOString(),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async submitFeedback(phone: string, input: PortalFeedbackInput): Promise<{ id: string }> {
    // Unscoped (justified): ownership proven by the OTP-verified phone — the
    // relation filter restricts the visit lookup to the patient's own records.
    const visit = await this.prisma.unscoped.visit.findFirst({
      where: {
        id: input.visitId,
        status: VisitStatus.COMPLETED,
        patient: { phone, deletedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        branchId: true,
        patientId: true,
        doctorUserId: true,
        feedback: { select: { id: true } },
      },
    });
    if (!visit) {
      throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
    }
    if (visit.feedback) {
      throw new AppException(ErrorCode.CONFLICT, 'Feedback for this visit already exists', 409);
    }

    // Unscoped (justified): write scoped by ids taken from the owned visit row.
    const feedback = await this.prisma.unscoped.feedback.create({
      data: {
        clinicId: visit.clinicId,
        branchId: visit.branchId,
        patientId: visit.patientId,
        visitId: visit.id,
        doctorUserId: visit.doctorUserId,
        rating: input.rating,
        comment: input.comment,
      },
      select: { id: true },
    });
    return { id: feedback.id };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Unscoped (justified): the patient owns their cards across clinics —
   * linked by the OTP-verified phone from the portal token.
   */
  private ownPatients(
    phone: string,
  ): Promise<Array<{ id: string; clinicId: string; mrn: string; fullName: string }>> {
    return this.prisma.unscoped.patient.findMany({
      where: { phone, deletedAt: null },
      select: { id: true, clinicId: true, mrn: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async clinicNames(clinicIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(clinicIds)];
    if (unique.length === 0) return new Map();
    // Unscoped (justified): Clinic is the tenant root — name lookup only,
    // restricted to ids already proven to belong to the patient's records.
    const clinics = await this.prisma.unscoped.clinic.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(clinics.map((c) => [c.id, c.name]));
  }

  /** Clinic booking toggle: settings.onlineBookingEnabled !== false (default on). */
  private onlineBookingEnabled(settings: unknown): boolean {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      return (settings as Record<string, unknown>)['onlineBookingEnabled'] !== false;
    }
    return true;
  }
}
