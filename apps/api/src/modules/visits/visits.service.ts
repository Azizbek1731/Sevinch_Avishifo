import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';
import { AppConfigService } from '../../core/config/app-config.service';
import { VisitReportPdfService } from './visit-report-pdf.service';
import { buildVisitReportPdfData } from './visit-report.data';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  NotificationEvent,
  ReferralType,
  TicketStatus,
  UserRole,
  VisitStatus,
  type AuthUser,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { randomUUID } from 'node:crypto';
import { ClinicalOrdersService } from '../clinical-orders/clinical-orders.service';
import { LabService } from '../lab/lab.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AddDiagnosisDto,
  AddDrugDto,
  AddPrescriptionDto,
  AddReferralDto,
  AmendVisitDto,
  CreateVisitDto,
  DrugQueryDto,
  Icd10QueryDto,
  PaginationQueryDto,
  ReplacePrescriptionsDto,
  UpdateVisitDto,
  UpsertVitalsDto,
  VisitQueryDto,
  VisitTemplatePatchDto,
  VisitTemplateUpsertDto,
} from './dto';

/** SOAP-ish fields amendable/patchable on a visit. */
const VISIT_EDIT_FIELDS = [
  'subjective',
  'objective',
  'assessmentNote',
  'plan',
  'nextVisitAt',
  'reportTitle',
  'reportBody',
] as const;
type VisitEditField = (typeof VISIT_EDIT_FIELDS)[number];

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const dateOnly = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;
const PRESCRIPTION_ORDER = [
  { sortOrder: 'asc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
];

type VisitDetailRow = Prisma.VisitGetPayload<{
  include: {
    clinicalOrder: { select: { id: true } };
    amendments: {
      orderBy: { createdAt: 'desc' };
      take: 1;
      select: { createdAt: true; authorId: true; reason: true };
    };
    vitals: true;
    diagnoses: { include: { icd10: true } };
    prescriptions: { include: { drug: true } };
    referrals: {
      include: {
        clinicalOrder: {
          include: {
            initialInvoice: { include: { refunds: true; lines: true } };
            visit: { select: { status: true } };
          };
        };
      };
    };
    patient: true;
    doctor: { include: { staffProfile: true } };
  };
}>;

type VisitListRow = Prisma.VisitGetPayload<{
  include: { patient: true; doctor: true };
}>;

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly labService: LabService,
    private readonly clinicalOrders: ClinicalOrdersService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfigService,
    private readonly reportPdf: VisitReportPdfService,
  ) {}

  // ------------------------------------------------------------ helpers

  /** Clinic-level settings blob (visitLockHours, doctorPatientAccess, ...). */
  private async clinicSettings(): Promise<Record<string, unknown>> {
    // Clinic is not tenant-auto-scoped; justified read of OWN clinic row by
    // context id (settings drive the visit lock and doctor access mode).
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { settings: true },
    });
    const s: unknown = clinic?.settings;
    return s !== null && typeof s === 'object' && !Array.isArray(s)
      ? (s as Record<string, unknown>)
      : {};
  }

  private async isBranchWideDoctorAccess(): Promise<boolean> {
    const settings = await this.clinicSettings();
    return settings['doctorPatientAccess'] === 'branch';
  }

  /** Authors can edit; a treating doctor can read this patient's signed history. */
  private async assertVisitAccess(
    user: AuthUser,
    visit: { doctorUserId: string; patientId: string; branchId: string; status: string },
  ): Promise<void> {
    if (user.branchIds.length && !user.branchIds.includes(visit.branchId))
      throw new AppException(ErrorCode.FORBIDDEN, 'Branch access required', 403);
    if (user.role !== UserRole.DOCTOR || visit.doctorUserId === user.id) return;
    if (visit.status === 'COMPLETED') {
      const care = await this.prisma.db.clinicalOrder.findFirst({
        where: {
          patientId: visit.patientId,
          branchId: visit.branchId,
          doctorUserId: user.id,
          initialInvoice: { status: 'PAID', refunds: { none: {} } },
          visit: { status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
        },
        select: { id: true },
      });
      if (care || (await this.isBranchWideDoctorAccess())) return;
    }
    throw new AppException(ErrorCode.FORBIDDEN, 'No access to this visit', 403);
  }

  private assertVisitWrite(
    user: AuthUser,
    visit: { doctorUserId: string },
    allowNurse = false,
  ): void {
    if (
      (user.role === UserRole.DOCTOR && visit.doctorUserId !== user.id) ||
      (user.role === UserRole.NURSE && !allowNurse)
    ) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Only the treating doctor can change this report',
        403,
      );
    }
  }

  private async ensureEditable(visit: {
    completedAt: Date | null;
    status?: string;
  }): Promise<void> {
    if (visit.completedAt || (visit.status && visit.status !== 'IN_PROGRESS'))
      throw new AppException(
        ErrorCode.VISIT_LOCKED,
        'Confirmed reports are read-only; use an audited amendment',
        423,
      );
  }

  private async edit<T>(
    id: string,
    action: (tx: TenantTransactionClient) => Promise<T>,
  ): Promise<T> {
    const clinicId = TenantContext.requireClinicId();
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClinicalOrder" WHERE "visitId" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const order = await tx.clinicalOrder.findFirst({ where: { visitId: id } });
      if (order) {
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "clinicalOrderId" = ${order.id} AND "clinicId" = ${clinicId} ORDER BY "id" FOR UPDATE`;
        const cancelled = await tx.invoice.count({
          where: {
            clinicalOrderId: order.id,
            OR: [
              { id: order.initialInvoiceId, status: { in: ['CANCELLED', 'REFUNDED'] } },
              { refunds: { some: {} } },
            ],
          },
        });
        if (cancelled)
          throw new AppException(
            ErrorCode.VISIT_LOCKED,
            'Cancelled examinations are read-only',
            423,
          );
      }

      await tx.$queryRaw`SELECT "id" FROM "Visit" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const visit = await tx.visit.findFirstOrThrow({ where: { id } });
      await this.ensureEditable(visit);
      return action(tx);
    });
  }

  private async requireVisit(id: string, user: AuthUser): Promise<VisitDetailRow> {
    const visit = await this.prisma.db.visit.findUnique({
      where: { id },
      include: {
        clinicalOrder: { select: { id: true } },
        amendments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, authorId: true, reason: true },
        },
        vitals: true,
        diagnoses: { include: { icd10: true }, orderBy: { createdAt: 'asc' } },
        prescriptions: { include: { drug: true }, orderBy: PRESCRIPTION_ORDER },
        referrals: {
          orderBy: { createdAt: 'asc' },
          include: {
            clinicalOrder: {
              include: {
                initialInvoice: { include: { refunds: true, lines: true } },
                visit: { select: { status: true } },
              },
            },
          },
        },
        patient: true,
        doctor: { include: { staffProfile: true } },
      },
    });
    if (!visit) throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
    await this.assertVisitAccess(user, visit);
    return visit;
  }

  // ------------------------------------------------------------ mapping

  private toVitals(v: VisitDetailRow['vitals']): Record<string, unknown> | null {
    if (!v) return null;
    return {
      id: v.id,
      heightCm: v.heightCm,
      weightKg: v.weightKg,
      bpSystolic: v.bpSystolic,
      bpDiastolic: v.bpDiastolic,
      pulseBpm: v.pulseBpm,
      temperatureC: v.temperatureC,
      spo2: v.spo2,
      note: v.note,
      recordedById: v.recordedById,
      recordedAt: iso(v.recordedAt),
    };
  }

  private toDiagnosis(d: VisitDetailRow['diagnoses'][number]): Record<string, unknown> {
    return {
      id: d.id,
      icd10Id: d.icd10Id,
      isPrimary: d.isPrimary,
      note: d.note,
      createdAt: iso(d.createdAt),
      icd10: {
        id: d.icd10.id,
        code: d.icd10.code,
        nameUz: d.icd10.nameUz,
        nameRu: d.icd10.nameRu,
        nameEn: d.icd10.nameEn,
      },
    };
  }

  private toPrescription(p: VisitDetailRow['prescriptions'][number]): Record<string, unknown> {
    return {
      id: p.id,
      drugName: p.drugName,
      drugId: p.drugId,
      strength: p.strength,
      form: p.form,
      quantity: p.quantity,
      dosage: p.dosage,
      route: p.route,
      dripRate: p.dripRate,
      frequency: p.frequency,
      durationDays: p.durationDays,
      durationText: p.durationText,
      instructions: p.instructions,
      combineWithPrevious: p.combineWithPrevious,
      sortOrder: p.sortOrder,
      createdAt: iso(p.createdAt),
      drug: p.drug
        ? { id: p.drug.id, name: p.drug.name, form: p.drug.form, strength: p.drug.strength }
        : null,
    };
  }

  private toReferral(r: VisitDetailRow['referrals'][number]): Record<string, unknown> {
    const order = r.clinicalOrder;
    let clinicalOrder: Record<string, unknown> | null = null;
    if (order) {
      const invoice = order.initialInvoice;
      const refunds = invoice.refunds.reduce(
        (sum, refund) => sum.add(refund.amount),
        new Prisma.Decimal(0),
      );
      const paidTotal = invoice.paidTotal.sub(refunds);
      const fullyPaid = invoice.status === 'PAID' && paidTotal.gte(invoice.total);
      let status: string = 'WAITING_PAYMENT';
      if (order.visit?.status === 'COMPLETED') status = 'COMPLETED';
      else if (
        order.visit?.status === 'CANCELLED' ||
        ['CANCELLED', 'REFUNDED'].includes(invoice.status)
      )
        status = 'CANCELLED';
      else if (order.visitId) status = 'IN_PROGRESS';
      else if (fullyPaid) status = 'READY';
      clinicalOrder = {
        id: order.id,
        kind: order.kind,
        status,
        visitId: order.visitId,
        doctorUserId: order.doctorUserId,
        services: invoice.lines.map((line) => ({
          id: line.serviceId ?? line.id,
          title: line.title,
        })),
        invoice: {
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          due: Prisma.Decimal.max(0, invoice.total.sub(paidTotal)).toFixed(2),
        },
      };
    }
    return {
      id: r.id,
      type: r.type,
      targetSpecialty: r.targetSpecialty,
      targetDoctorUserId: r.targetDoctorUserId,
      labOrderId: r.labOrderId,
      clinicalOrderId: r.clinicalOrderId,
      clinicalOrder,
      appointmentId: r.appointmentId,
      note: r.note,
      createdAt: iso(r.createdAt),
    };
  }

  private toDetail(v: VisitDetailRow): Record<string, unknown> {
    return {
      id: v.id,
      kind: v.kind,
      reportTitle: v.reportTitle,
      reportBody: v.reportBody,
      clinicalOrderId: v.clinicalOrder?.id ?? null,
      branchId: v.branchId,
      patientId: v.patientId,
      doctorUserId: v.doctorUserId,
      appointmentId: v.appointmentId,
      ticketId: v.ticketId,
      status: v.status,
      subjective: v.subjective,
      objective: v.objective,
      assessmentNote: v.assessmentNote,
      plan: v.plan,
      physiotherapy: v.physiotherapy,
      prescriptionRevision: v.prescriptionRevision,
      startedAt: iso(v.startedAt),
      completedAt: iso(v.completedAt),
      nextVisitAt: iso(v.nextVisitAt),
      createdAt: iso(v.createdAt),
      updatedAt: iso(v.updatedAt),
      vitals: this.toVitals(v.vitals),
      diagnoses: v.diagnoses.map((d) => this.toDiagnosis(d)),
      prescriptions: v.prescriptions.map((p) => this.toPrescription(p)),
      referrals: v.referrals.map((r) => this.toReferral(r)),
      patient: {
        id: v.patient.id,
        mrn: v.patient.mrn,
        fullName: v.patient.fullName,
        dob: dateOnly(v.patient.dob),
        gender: v.patient.gender,
        phone: v.patient.phone,
        allergies: v.patient.allergies,
        chronicConditions: v.patient.chronicConditions,
      },
      doctor: {
        id: v.doctor.id,
        fullName: v.doctor.fullName,
        specialty: v.doctor.staffProfile?.specialty ?? null,
      },
    };
  }

  private toListItem(v: VisitListRow): Record<string, unknown> {
    return {
      id: v.id,
      kind: v.kind,
      reportTitle: v.reportTitle,
      branchId: v.branchId,
      patientId: v.patientId,
      doctorUserId: v.doctorUserId,
      appointmentId: v.appointmentId,
      ticketId: v.ticketId,
      status: v.status,
      startedAt: iso(v.startedAt),
      completedAt: iso(v.completedAt),
      nextVisitAt: iso(v.nextVisitAt),
      patient: { id: v.patient.id, mrn: v.patient.mrn, fullName: v.patient.fullName },
      doctor: { id: v.doctor.id, fullName: v.doctor.fullName },
    };
  }

  // ------------------------------------------------------------ visits CRUD

  async create(
    input: CreateVisitDto,
    user: AuthUser,
    activeBranchId: string,
  ): Promise<Record<string, unknown>> {
    if (this.config.env.SINGLE_CLINIC_MODE) {
      throw new AppException(
        ErrorCode.INVOICE_INVALID_STATE,
        'Start a paid clinical order from the worklist',
        409,
      );
    }
    const doctorUserId = user.role === UserRole.DOCTOR ? user.id : input.doctorUserId;
    if (!doctorUserId) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'doctorUserId is required', 400);
    }
    if (doctorUserId !== user.id) {
      // User is not tenant-auto-scoped — justified lookup constrained to own clinic.
      const doctor = await this.prisma.unscoped.user.findFirst({
        where: { id: doctorUserId, clinicId: TenantContext.requireClinicId(), deletedAt: null },
        select: { id: true },
      });
      if (!doctor) throw new AppException(ErrorCode.NOT_FOUND, 'Doctor not found', 404);
    }

    let patientId: string;
    let branchId: string;
    let ticketId: string | undefined;
    let appointmentId: string | undefined;

    if (input.ticketId) {
      const ticket = await this.prisma.db.queueTicket.findUnique({ where: { id: input.ticketId } });
      if (!ticket) throw new AppException(ErrorCode.TICKET_NOT_FOUND, 'Ticket not found', 404);
      const allowed: string[] = [TicketStatus.CALLED, TicketStatus.IN_ROOM, TicketStatus.DONE];
      if (!allowed.includes(ticket.status)) {
        throw new AppException(
          ErrorCode.TICKET_INVALID_TRANSITION,
          'A visit can only be opened for a called, in-room or done ticket',
          409,
        );
      }
      patientId = ticket.patientId;
      branchId = ticket.branchId;
      ticketId = ticket.id;
      appointmentId = ticket.appointmentId ?? undefined;
    } else if (input.appointmentId) {
      const appointment = await this.prisma.db.appointment.findUnique({
        where: { id: input.appointmentId },
      });
      if (!appointment) {
        throw new AppException(ErrorCode.APPOINTMENT_NOT_FOUND, 'Appointment not found', 404);
      }
      patientId = appointment.patientId;
      branchId = appointment.branchId;
      appointmentId = appointment.id;
    } else {
      const patient = await this.prisma.db.patient.findUnique({
        where: { id: input.patientId as string },
      });
      if (!patient) throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
      patientId = patient.id;
      branchId = activeBranchId;
    }

    if (ticketId || appointmentId) {
      const existing = await this.prisma.db.visit.findFirst({
        where: {
          OR: [...(ticketId ? [{ ticketId }] : []), ...(appointmentId ? [{ appointmentId }] : [])],
        },
        select: { id: true },
      });
      if (existing) {
        throw new AppException(
          ErrorCode.VISIT_ALREADY_OPEN,
          'A visit already exists for this ticket/appointment',
          409,
        );
      }
    }

    let visitId: string;
    try {
      visitId = await this.prisma.db.$transaction(async (tx) => {
        const visit = await tx.visit.create({
          // clinicId also auto-stamped by the tenant extension; set for typing.
          data: {
            clinicId: TenantContext.requireClinicId(),
            branchId,
            patientId,
            doctorUserId,
            ticketId,
            appointmentId,
          },
        });
        if (appointmentId) {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: { status: 'IN_PROGRESS' },
          });
        }
        await tx.patient.update({
          where: { id: patientId },
          data: { visitCount: { increment: 1 } },
        });
        return visit.id;
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          ErrorCode.VISIT_ALREADY_OPEN,
          'A visit already exists for this ticket/appointment',
          409,
        );
      }
      throw err;
    }

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Visit',
      entityId: visitId,
      after: { patientId, doctorUserId, branchId, ticketId, appointmentId },
    });

    return this.getById(visitId, user);
  }

  async list(query: VisitQueryDto, user: AuthUser): Promise<PaginatedResult<unknown>> {
    const where: Prisma.VisitWhereInput = user.branchIds.length
      ? { branchId: { in: user.branchIds } }
      : {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.doctorUserId) where.doctorUserId = query.doctorUserId;
    if (query.from || query.to) {
      where.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (user.role === UserRole.DOCTOR) {
      const readable: Prisma.VisitWhereInput[] = [{ doctorUserId: user.id }];
      if (await this.isBranchWideDoctorAccess()) {
        readable.push({ status: 'COMPLETED' });
      } else {
        const care = await this.prisma.db.clinicalOrder.findMany({
          where: {
            doctorUserId: user.id,
            ...(query.patientId ? { patientId: query.patientId } : {}),
            ...(user.branchIds.length ? { branchId: { in: user.branchIds } } : {}),
            initialInvoice: { status: 'PAID', refunds: { none: {} } },
            visit: { status: { in: ['IN_PROGRESS', 'COMPLETED'] } },
          },
          select: { patientId: true, branchId: true },
          distinct: ['patientId', 'branchId'],
        });
        readable.push(...care.map((scope) => ({ ...scope, status: VisitStatus.COMPLETED })));
      }
      where.AND = [{ OR: readable }];
    }

    const [rows, total] = await Promise.all([
      this.prisma.db.visit.findMany({
        where,
        include: { patient: true, doctor: true },
        orderBy: { startedAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.visit.count({ where }),
    ]);
    return paginated(
      rows.map((v) => this.toListItem(v)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async getById(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    return this.toDetail(visit);
  }

  async update(id: string, dto: UpdateVisitDto, user: AuthUser): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    await this.ensureEditable(visit);

    const data: Prisma.VisitUpdateInput = {};
    if (dto.reportTitle !== undefined) data.reportTitle = dto.reportTitle;
    if (dto.reportBody !== undefined) data.reportBody = dto.reportBody;
    if (dto.subjective !== undefined) data.subjective = dto.subjective;
    if (dto.objective !== undefined) data.objective = dto.objective;
    if (dto.assessmentNote !== undefined) data.assessmentNote = dto.assessmentNote;
    if (dto.plan !== undefined) data.plan = dto.plan;
    if (dto.nextVisitAt !== undefined) data.nextVisitAt = new Date(dto.nextVisitAt);

    await this.edit(id, (tx) => tx.visit.update({ where: { id }, data }));

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Visit',
      entityId: id,
      before: {
        reportTitle: visit.reportTitle,
        reportBody: visit.reportBody,
        subjective: visit.subjective,
        objective: visit.objective,
        assessmentNote: visit.assessmentNote,
        plan: visit.plan,
        nextVisitAt: iso(visit.nextVisitAt),
      },
      after: {
        reportTitle: dto.reportTitle ?? visit.reportTitle,
        reportBody: dto.reportBody ?? visit.reportBody,
        subjective: dto.subjective ?? visit.subjective,
        objective: dto.objective ?? visit.objective,
        assessmentNote: dto.assessmentNote ?? visit.assessmentNote,
        plan: dto.plan ?? visit.plan,
        nextVisitAt: dto.nextVisitAt ?? iso(visit.nextVisitAt),
      },
    });

    return this.getById(id, user);
  }

  async complete(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    const completedAt = new Date();
    const clinicId = TenantContext.requireClinicId();
    await this.prisma.db.$transaction(async (tx) => {
      if (visit.clinicalOrder) {
        // Extras and confirmation take the order lock first, so a concurrently
        // added examination cannot escape the final payment check.
        await tx.$queryRaw`SELECT "id" FROM "ClinicalOrder" WHERE "id" = ${visit.clinicalOrder.id} AND "clinicId" = ${clinicId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "clinicalOrderId" = ${visit.clinicalOrder.id} AND "clinicId" = ${clinicId} ORDER BY "id" FOR UPDATE`;
        const invoices = await tx.invoice.findMany({
          where: { clinicalOrderId: visit.clinicalOrder.id, status: { not: 'CANCELLED' } },
          include: { refunds: true },
        });
        if (
          !invoices.length ||
          invoices.some(
            (invoice) =>
              invoice.status !== 'PAID' ||
              invoice.paidTotal
                .sub(
                  invoice.refunds.reduce(
                    (sum, refund) => sum.add(refund.amount),
                    new Prisma.Decimal(0),
                  ),
                )
                .lt(invoice.total),
          )
        ) {
          throw new AppException(
            ErrorCode.INVOICE_INVALID_STATE,
            'Pay all examination invoices before confirming the report',
            409,
          );
        }
      }
      await tx.$queryRaw`SELECT "id" FROM "Visit" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const current = await tx.visit.findFirstOrThrow({
        where: { id },
        include: { diagnoses: true },
      });
      await this.ensureEditable(current);
      if (
        current.kind === 'ULTRASOUND' &&
        (!current.reportTitle?.trim() || !current.reportBody?.trim())
      ) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Ultrasound report title and findings are required',
          400,
        );
      }
      if (
        current.kind === 'CONSULTATION' &&
        !current.assessmentNote?.trim() &&
        !current.diagnoses.length
      ) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Record a diagnosis before confirming the consultation',
          400,
        );
      }
      await tx.visit.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt, lockedAt: completedAt },
      });
      if (visit.appointmentId)
        await tx.appointment.update({
          where: { id: visit.appointmentId },
          data: { status: 'COMPLETED' },
        });
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Visit',
      entityId: id,
      before: { status: visit.status, completedAt: iso(visit.completedAt) },
      after: { status: VisitStatus.COMPLETED, completedAt: completedAt.toISOString() },
    });

    await this.notifications
      .enqueueEvent({
        event: NotificationEvent.FEEDBACK_REQUEST,
        clinicId: TenantContext.requireClinicId(),
        patientId: visit.patientId,
        vars: {
          patient_name: visit.patient.fullName,
          doctor_name: visit.doctor.fullName,
          // Portal feedback link is produced later (portal module) — empty for now.
          link: '',
        },
      })
      .catch(() => {
        this.logger.warn('Visit confirmed; feedback notification could not be queued');
      });

    return this.getById(id, user);
  }

  // ------------------------------------------------------------ amendments

  async amend(id: string, dto: AmendVisitDto, user: AuthUser): Promise<Record<string, unknown>> {
    // Amendments are allowed even when the visit is locked (append-only history).
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);

    const clinicId = TenantContext.requireClinicId();
    const { amendmentId, diff } = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Visit" WHERE "id" = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`;
      const current = await tx.visit.findFirstOrThrow({
        where: { id },
        include: { diagnoses: true },
      });
      if (current.status !== 'COMPLETED')
        throw new AppException(
          ErrorCode.INVALID_STATUS_TRANSITION,
          'Only confirmed reports can be amended',
          409,
        );
      const nextTitle = dto.reportTitle ?? current.reportTitle;
      const nextBody = dto.reportBody ?? current.reportBody;
      if (current.kind === 'ULTRASOUND' && (!nextTitle?.trim() || !nextBody?.trim()))
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'A confirmed ultrasound report cannot be empty',
          400,
        );
      if (
        current.kind === 'CONSULTATION' &&
        !(dto.assessmentNote ?? current.assessmentNote)?.trim() &&
        !current.diagnoses.length
      )
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'A confirmed consultation must retain its diagnosis',
          400,
        );
      const diff: Record<string, { before: unknown; after: unknown }> = {};
      const data: Prisma.VisitUpdateInput = {};
      for (const field of VISIT_EDIT_FIELDS) {
        const next = dto[field as VisitEditField];
        if (next === undefined) continue;
        if (field === 'nextVisitAt') {
          const before = iso(current.nextVisitAt);
          const after = new Date(next).toISOString();
          if (before !== after) {
            diff[field] = { before, after };
            data.nextVisitAt = new Date(next);
          }
        } else if (current[field] !== next) {
          diff[field] = { before: current[field], after: next };
          data[field] = next;
        }
      }
      if (!Object.keys(diff).length)
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Nothing to amend', 400);
      const amendment = await tx.visitAmendment.create({
        data: {
          clinicId,
          visitId: id,
          authorId: user.id,
          diff: diff as Prisma.InputJsonValue,
          reason: dto.reason,
        },
      });
      await tx.visit.update({ where: { id }, data });
      return { amendmentId: amendment.id, diff };
    });

    await this.audit.log({
      action: AuditAction.AMEND,
      entity: 'Visit',
      entityId: id,
      before: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.before])),
      after: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.after])),
    });

    return { id: amendmentId, visit: await this.getById(id, user) };
  }

  async listAmendments(
    id: string,
    query: PaginationQueryDto,
    user: AuthUser,
  ): Promise<PaginatedResult<unknown>> {
    await this.requireVisit(id, user);
    const where: Prisma.VisitAmendmentWhereInput = { visitId: id };
    const [rows, total] = await Promise.all([
      this.prisma.db.visitAmendment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.visitAmendment.count({ where }),
    ]);
    return paginated(
      rows.map((a) => ({
        id: a.id,
        visitId: a.visitId,
        authorId: a.authorId,
        diff: a.diff,
        reason: a.reason,
        createdAt: iso(a.createdAt),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  // ------------------------------------------------------------ vitals

  async upsertVitals(
    id: string,
    dto: UpsertVitalsDto,
    user: AuthUser,
  ): Promise<Record<string, unknown> | null> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit, true);
    await this.ensureEditable(visit);

    const fields = {
      heightCm: dto.heightCm,
      weightKg: dto.weightKg,
      bpSystolic: dto.bpSystolic,
      bpDiastolic: dto.bpDiastolic,
      pulseBpm: dto.pulseBpm,
      temperatureC: dto.temperatureC,
      spo2: dto.spo2,
      note: dto.note,
    };
    const vitals = await this.edit(id, (tx) =>
      tx.visitVital.upsert({
        where: { visitId: id },
        create: {
          clinicId: TenantContext.requireClinicId(),
          visitId: id,
          ...fields,
          recordedById: user.id,
        },
        update: { ...fields, recordedById: user.id, recordedAt: new Date() },
      }),
    );

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'VisitVital',
      entityId: vitals.id,
      before: this.toVitals(visit.vitals),
      after: this.toVitals(vitals),
    });

    return this.toVitals(vitals);
  }

  // ------------------------------------------------------------ diagnoses

  async addDiagnosis(
    id: string,
    dto: AddDiagnosisDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    await this.ensureEditable(visit);

    // Icd10Code is a global read-only directory (no clinicId) — justified unscoped read.
    const icd10 = await this.prisma.unscoped.icd10Code.findUnique({ where: { id: dto.icd10Id } });
    if (!icd10) throw new AppException(ErrorCode.NOT_FOUND, 'ICD-10 code not found', 404);

    const created = await this.edit(id, async (tx) => {
      if (dto.isPrimary) {
        await tx.diagnosis.updateMany({ where: { visitId: id }, data: { isPrimary: false } });
      }
      return tx.diagnosis.create({
        data: {
          clinicId: TenantContext.requireClinicId(),
          visitId: id,
          icd10Id: dto.icd10Id,
          isPrimary: dto.isPrimary,
          note: dto.note,
        },
        include: { icd10: true },
      });
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Diagnosis',
      entityId: created.id,
      after: { visitId: id, icd10: icd10.code, isPrimary: dto.isPrimary },
    });

    return this.toDiagnosis(created);
  }

  async removeDiagnosis(id: string, dxId: string, user: AuthUser): Promise<{ id: string }> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    await this.ensureEditable(visit);

    const diagnosis = await this.prisma.db.diagnosis.findFirst({
      where: { id: dxId, visitId: id },
    });
    if (!diagnosis) throw new AppException(ErrorCode.NOT_FOUND, 'Diagnosis not found', 404);
    await this.edit(id, (tx) => tx.diagnosis.delete({ where: { id: dxId } }));

    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Diagnosis',
      entityId: dxId,
      before: { visitId: id, icd10Id: diagnosis.icd10Id, isPrimary: diagnosis.isPrimary },
    });

    return { id: dxId };
  }

  // ------------------------------------------------------------ prescriptions

  private prescriptionData(id: string, dto: AddPrescriptionDto, sortOrder: number) {
    const direction = (value: string | undefined) =>
      dto.combineWithPrevious ? null : value || null;
    return {
      clinicId: TenantContext.requireClinicId(),
      visitId: id,
      drugName: dto.drugName,
      drugId: dto.drugId ?? null,
      strength: dto.strength || null,
      form: direction(dto.form),
      quantity: direction(dto.quantity),
      dosage: direction(dto.dosage),
      route: direction(dto.route),
      dripRate: direction(dto.dripRate),
      frequency: direction(dto.frequency),
      durationDays: dto.combineWithPrevious ? null : (dto.durationDays ?? null),
      durationText: direction(dto.durationText),
      instructions: direction(dto.instructions),
      combineWithPrevious: dto.combineWithPrevious,
      sortOrder,
    };
  }

  private async validatePrescriptionDrugs(
    tx: TenantTransactionClient,
    items: AddPrescriptionDto[],
  ) {
    const ids = [...new Set(items.flatMap((item) => (item.drugId ? [item.drugId] : [])))];
    if (!ids.length) return;
    // DrugDirectory mixes global and clinic rows and is not tenant-extended.
    const count = await tx.drugDirectory.count({
      where: {
        id: { in: ids },
        OR: [{ clinicId: null }, { clinicId: TenantContext.requireClinicId() }],
      },
    });
    if (count !== ids.length) throw new AppException(ErrorCode.NOT_FOUND, 'Drug not found', 404);
  }

  async replacePrescriptions(id: string, dto: ReplacePrescriptionsDto, user: AuthUser) {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    const saved = await this.edit(id, async (tx) => {
      const current = await tx.visit.findUniqueOrThrow({ where: { id } });
      if (current.prescriptionRevision !== dto.expectedRevision)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Retsept boshqa oynada o‘zgartirilgan. Yangilangan ma’lumotlarni yuklang.',
          409,
          [{ prescriptionRevision: current.prescriptionRevision }],
        );
      await this.validatePrescriptionDrugs(tx, dto.items);
      const previous = await tx.prescription.findMany({
        where: { visitId: id },
        include: { drug: true },
        orderBy: PRESCRIPTION_ORDER,
      });
      await tx.prescription.deleteMany({ where: { visitId: id } });
      if (dto.items.length)
        await tx.prescription.createMany({
          data: dto.items.map((item, index) => this.prescriptionData(id, item, index)),
        });
      const updated = await tx.visit.update({
        where: { id },
        data: {
          prescriptionRevision: { increment: 1 },
          ...(dto.physiotherapy === undefined ? {} : { physiotherapy: dto.physiotherapy || null }),
        },
      });
      const prescriptions = await tx.prescription.findMany({
        where: { visitId: id },
        include: { drug: true },
        orderBy: PRESCRIPTION_ORDER,
      });
      return {
        before: {
          prescriptions: previous.map((p) => this.toPrescription(p)),
          prescriptionRevision: current.prescriptionRevision,
          physiotherapy: current.physiotherapy,
        },
        after: {
          prescriptions: prescriptions.map((p) => this.toPrescription(p)),
          prescriptionRevision: updated.prescriptionRevision,
          physiotherapy: updated.physiotherapy,
        },
      };
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'VisitPrescriptions',
      entityId: id,
      before: saved.before,
      after: saved.after,
    });
    return saved.after;
  }

  async addPrescription(
    id: string,
    dto: AddPrescriptionDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    // A legacy append has no base identity or revision; concurrent appends could
    // otherwise attach an ingredient to a different doctor's intended mixture.
    if (dto.combineWithPrevious)
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Aralashma dorilarini retsept bilan birgalikda saqlang',
        400,
      );
    const saved = await this.edit(id, async (tx) => {
      const previous = await tx.prescription.findMany({
        where: { visitId: id },
        orderBy: PRESCRIPTION_ORDER,
      });
      await this.validatePrescriptionDrugs(tx, [dto]);
      const created = await tx.prescription.create({
        data: this.prescriptionData(id, dto, (previous.at(-1)?.sortOrder ?? -1) + 1),
        include: { drug: true },
      });
      const updated = await tx.visit.update({
        where: { id },
        data: { prescriptionRevision: { increment: 1 } },
      });
      return { created, prescriptionRevision: updated.prescriptionRevision };
    });
    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Prescription',
      entityId: saved.created.id,
      after: {
        visitId: id,
        ...this.toPrescription(saved.created),
        prescriptionRevision: saved.prescriptionRevision,
      },
    });
    return {
      ...this.toPrescription(saved.created),
      prescriptionRevision: saved.prescriptionRevision,
    };
  }

  async removePrescription(id: string, rxId: string, user: AuthUser) {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    const saved = await this.edit(id, async (tx) => {
      const prescriptions = await tx.prescription.findMany({
        where: { visitId: id },
        include: { drug: true },
        orderBy: PRESCRIPTION_ORDER,
      });
      const index = prescriptions.findIndex((p) => p.id === rxId);
      const prescription = prescriptions[index];
      if (!prescription) throw new AppException(ErrorCode.NOT_FOUND, 'Prescription not found', 404);
      if (!prescription.combineWithPrevious && prescriptions[index + 1]?.combineWithPrevious)
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Aralashma asosini alohida o‘chirib bo‘lmaydi. Retsept guruhini birgalikda tahrirlang.',
          409,
        );
      await tx.prescription.delete({ where: { id: rxId } });
      const updated = await tx.visit.update({
        where: { id },
        data: { prescriptionRevision: { increment: 1 } },
      });
      return { prescription, prescriptionRevision: updated.prescriptionRevision };
    });
    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Prescription',
      entityId: rxId,
      before: { visitId: id, ...this.toPrescription(saved.prescription) },
      after: { prescriptionRevision: saved.prescriptionRevision },
    });
    return { id: rxId, prescriptionRevision: saved.prescriptionRevision };
  }

  // ------------------------------------------------------------ referrals

  async addReferral(
    id: string,
    dto: AddReferralDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    this.assertVisitWrite(user, visit);
    await this.ensureEditable(visit);

    const created = await this.edit(id, async (tx) => {
      let labOrderId: string | undefined;
      let clinicalOrderId: string | undefined;
      if (dto.type === ReferralType.LAB) {
        if (!dto.labTestIds?.length)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'labTestIds are required for a LAB referral',
            400,
          );
        const order = await this.labService.createOrderFromReferral(
          {
            patientId: visit.patientId,
            branchId: visit.branchId,
            visitId: visit.id,
            testIds: dto.labTestIds,
            orderedById: user.id,
          },
          tx,
        );
        labOrderId = order.id;
      }
      if (dto.type === ReferralType.ULTRASOUND || dto.type === ReferralType.SPECIALIST) {
        if (!dto.serviceIds?.length || !dto.targetDoctorUserId)
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'serviceIds and targetDoctorUserId are required for this referral',
            400,
          );
        const kind = dto.type === ReferralType.ULTRASOUND ? 'ULTRASOUND' : 'CONSULTATION';
        const order = await this.clinicalOrders.createFromReferral(
          {
            patientId: visit.patientId,
            branchId: visit.branchId,
            doctorUserId: dto.targetDoctorUserId,
            serviceIds: dto.serviceIds,
            kind,
            note: dto.note,
            orderedById: user.id,
            requestKey: `${kind === 'ULTRASOUND' ? 'uzi' : 'doc'}-ref:${visit.id}:${randomUUID()}`,
          },
          tx,
        );
        clinicalOrderId = order.id;
      }
      let targetSpecialty = dto.type === ReferralType.SPECIALIST ? dto.targetSpecialty : undefined;
      if (dto.type === ReferralType.SPECIALIST && dto.targetDoctorUserId && !targetSpecialty?.trim()) {
        const target = await this.prisma.unscoped.user.findFirst({
          where: { id: dto.targetDoctorUserId },
          select: { staffProfile: { select: { specialty: true } }, fullName: true },
        });
        targetSpecialty = target?.staffProfile?.specialty ?? target?.fullName ?? undefined;
      }
      return tx.referral.create({
        data: {
          clinicId: TenantContext.requireClinicId(),
          visitId: id,
          type: dto.type,
          targetSpecialty,
          targetDoctorUserId:
            dto.type === ReferralType.SPECIALIST || dto.type === ReferralType.ULTRASOUND
              ? dto.targetDoctorUserId
              : undefined,
          labOrderId,
          clinicalOrderId,
          note: dto.note,
        },
        include: {
          clinicalOrder: {
            include: {
              initialInvoice: { include: { refunds: true, lines: true } },
              visit: { select: { status: true } },
            },
          },
        },
      });
    });
    if (created.labOrderId) await this.labService.announceReferralOrder(created.labOrderId);
    if (created.clinicalOrderId)
      await this.clinicalOrders.announceReferralOrder(created.clinicalOrderId);

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Referral',
      entityId: created.id,
      after: {
        visitId: id,
        type: dto.type,
        labOrderId: created.labOrderId ?? null,
        clinicalOrderId: created.clinicalOrderId ?? null,
      },
    });

    return this.toReferral(created);
  }

  // ------------------------------------------------------------ print payload

  async printPayload(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    if (visit.status !== 'COMPLETED')
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Confirm the report before printing',
        409,
      );
    // Clinic is not tenant-auto-scoped — justified letterhead read of own clinic row.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: TenantContext.requireClinicId() },
      select: { name: true, logoUrl: true, address: true, phone: true },
    });
    return {
      clinic: {
        name: clinic?.name ?? '',
        logoUrl: clinic?.logoUrl ?? null,
        address: clinic?.address ?? null,
        phone: clinic?.phone ?? null,
      },
      visit: this.toDetail(visit),
      patient: {
        fullName: visit.patient.fullName,
        dob: dateOnly(visit.patient.dob),
        mrn: visit.patient.mrn,
      },
      doctor: {
        fullName: visit.doctor.fullName,
        specialty: visit.doctor.staffProfile?.specialty ?? null,
      },
    };
  }

  async history(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    const active = await this.requireVisit(id, user);
    const [visits, labOrders] = await Promise.all([
      this.prisma.db.visit.findMany({
        where: {
          patientId: active.patientId,
          branchId: active.branchId,
          status: 'COMPLETED',
          id: { not: id },
        },
        include: {
          doctor: { select: { fullName: true } },
          diagnoses: { include: { icd10: true } },
          prescriptions: { orderBy: PRESCRIPTION_ORDER },
        },
        orderBy: { startedAt: 'desc' },
        take: 100,
      }),
      this.prisma.db.labOrder.findMany({
        where: {
          patientId: active.patientId,
          branchId: active.branchId,
          status: { in: ['APPROVED', 'DELIVERED'] },
        },
        select: { id: true, orderNumber: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      visits: visits.map((v) => ({
        id: v.id,
        kind: v.kind,
        reportTitle: v.reportTitle,
        reportBody: v.reportBody,
        subjective: v.subjective,
        objective: v.objective,
        assessmentNote: v.assessmentNote,
        plan: v.plan,
        physiotherapy: v.physiotherapy,
        prescriptionRevision: v.prescriptionRevision,
        startedAt: v.startedAt.toISOString(),
        doctor: v.doctor,
        diagnoses: v.diagnoses.map((d) => ({ code: d.icd10.code, name: d.icd10.nameUz })),
        prescriptions: v.prescriptions.map((p) => ({
          drugName: p.drugName,
          strength: p.strength,
          form: p.form,
          quantity: p.quantity,
          dosage: p.dosage,
          route: p.route,
          dripRate: p.dripRate,
          frequency: p.frequency,
          durationDays: p.durationDays,
          durationText: p.durationText,
          instructions: p.instructions,
          combineWithPrevious: p.combineWithPrevious,
          sortOrder: p.sortOrder,
        })),
      })),
      labOrders: labOrders.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
    };
  }

  async pdf(
    id: string,
    user: AuthUser,
    mode: 'summary' | 'prescription' = 'summary',
  ): Promise<Buffer> {
    const visit = await this.requireVisit(id, user);
    if (visit.status !== 'COMPLETED')
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Only confirmed reports can be downloaded',
        409,
      );
    // Clinic is not auto-scoped; this explicit own-clinic lookup supplies the letterhead.
    const clinic = await this.prisma.unscoped.clinic.findUniqueOrThrow({
      where: { id: TenantContext.requireClinicId() },
      select: { name: true, legalName: true, logoUrl: true, address: true, phone: true },
    });
    const authorId = visit.amendments[0]?.authorId;
    const author = authorId
      ? await this.prisma.unscoped.user.findFirst({
          where: { id: authorId, clinicId: TenantContext.requireClinicId() },
          select: { fullName: true },
        })
      : null;
    return this.reportPdf.render(buildVisitReportPdfData(visit, clinic, author), 'uz', mode);
  }

  // ------------------------------------------------------------ visit templates

  private toTemplate(t: {
    id: string;
    name: string;
    specialty: string | null;
    content: Prisma.JsonValue;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Record<string, unknown> {
    return {
      id: t.id,
      name: t.name,
      specialty: t.specialty,
      content: t.content,
      isActive: t.isActive,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    };
  }

  async listTemplates(query: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const [rows, total] = await Promise.all([
      this.prisma.db.visitTemplate.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.db.visitTemplate.count({ where: { isActive: true } }),
    ]);
    return paginated(
      rows.map((t) => this.toTemplate(t)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async createTemplate(dto: VisitTemplateUpsertDto): Promise<Record<string, unknown>> {
    const created = await this.prisma.db.visitTemplate.create({
      data: {
        clinicId: TenantContext.requireClinicId(),
        name: dto.name,
        specialty: dto.specialty,
        content: dto.content as Prisma.InputJsonValue,
      },
    });
    return this.toTemplate(created);
  }

  async updateTemplate(id: string, dto: VisitTemplatePatchDto): Promise<Record<string, unknown>> {
    const existing = await this.prisma.db.visitTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Template not found', 404);
    const updated = await this.prisma.db.visitTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.specialty !== undefined ? { specialty: dto.specialty } : {}),
        ...(dto.content !== undefined ? { content: dto.content as Prisma.InputJsonValue } : {}),
      },
    });
    return this.toTemplate(updated);
  }

  async deleteTemplate(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.db.visitTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Template not found', 404);
    await this.prisma.db.visitTemplate.delete({ where: { id } });
    return { id };
  }

  // ------------------------------------------------------------ directories

  async searchIcd10(query: Icd10QueryDto): Promise<PaginatedResult<unknown>> {
    // Icd10Code is a global read-only directory (no clinicId) — justified unscoped read.
    const where: Prisma.Icd10CodeWhereInput = {
      OR: [
        { code: { contains: query.search, mode: 'insensitive' } },
        { nameUz: { contains: query.search, mode: 'insensitive' } },
        { nameRu: { contains: query.search, mode: 'insensitive' } },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.icd10Code.findMany({
        where,
        orderBy: { code: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.unscoped.icd10Code.count({ where }),
    ]);
    return paginated(
      rows.map((c) => ({
        id: c.id,
        code: c.code,
        nameUz: c.nameUz,
        nameRu: c.nameRu,
        nameEn: c.nameEn,
        chapter: c.chapter,
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async searchDrugs(query: DrugQueryDto): Promise<PaginatedResult<unknown>> {
    // DrugDirectory mixes global (clinicId null) and clinic rows and is not
    // tenant-auto-scoped — justified unscoped read constrained to null|own clinic.
    const where: Prisma.DrugDirectoryWhereInput = {
      isActive: true,
      OR: [{ clinicId: null }, { clinicId: TenantContext.requireClinicId() }],
      name: { contains: query.search, mode: 'insensitive' },
    };
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.drugDirectory.findMany({
        where,
        orderBy: { name: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.unscoped.drugDirectory.count({ where }),
    ]);
    return paginated(
      rows.map((d) => ({
        id: d.id,
        clinicId: d.clinicId,
        name: d.name,
        form: d.form,
        strength: d.strength,
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async addDrug(dto: AddDrugDto): Promise<Record<string, unknown>> {
    // DrugDirectory is not tenant-auto-scoped — clinicId stamped explicitly (justified).
    const created = await this.prisma.unscoped.drugDirectory.create({
      data: {
        clinicId: TenantContext.requireClinicId(),
        name: dto.name,
        form: dto.form,
        strength: dto.strength,
      },
    });
    return {
      id: created.id,
      clinicId: created.clinicId,
      name: created.name,
      form: created.form,
      strength: created.strength,
    };
  }
}
