import { Injectable } from '@nestjs/common';
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
import { LabService } from '../lab/lab.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AddDiagnosisDto, AddDrugDto, AddPrescriptionDto, AddReferralDto, AmendVisitDto, CreateVisitDto, DrugQueryDto, Icd10QueryDto, PaginationQueryDto, UpdateVisitDto, UpsertVitalsDto, VisitQueryDto, VisitTemplatePatchDto, VisitTemplateUpsertDto } from './dto';

const HOUR_MS = 3_600_000;
const DEFAULT_VISIT_LOCK_HOURS = 24;

/** SOAP-ish fields amendable/patchable on a visit. */
const VISIT_EDIT_FIELDS = ['subjective', 'objective', 'assessmentNote', 'plan', 'nextVisitAt'] as const;
type VisitEditField = (typeof VISIT_EDIT_FIELDS)[number];

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const dateOnly = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

type VisitDetailRow = Prisma.VisitGetPayload<{
  include: {
    vitals: true;
    diagnoses: { include: { icd10: true } };
    prescriptions: { include: { drug: true } };
    referrals: true;
    patient: true;
    doctor: { include: { staffProfile: true } };
  };
}>;

type VisitListRow = Prisma.VisitGetPayload<{
  include: { patient: true; doctor: true };
}>;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly labService: LabService,
    private readonly notifications: NotificationsService,
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

  private async visitLockHours(): Promise<number> {
    const settings = await this.clinicSettings();
    const raw = settings['visitLockHours'];
    return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_VISIT_LOCK_HOURS;
  }

  private async isBranchWideDoctorAccess(): Promise<boolean> {
    const settings = await this.clinicSettings();
    return settings['doctorPatientAccess'] === 'branch';
  }

  /** Object-level access: DOCTOR sees only own visits unless clinic allows branch-wide. */
  private async assertVisitAccess(user: AuthUser, visit: { doctorUserId: string }): Promise<void> {
    if (user.role !== UserRole.DOCTOR) return;
    if (visit.doctorUserId === user.id) return;
    if (await this.isBranchWideDoctorAccess()) return;
    throw new AppException(ErrorCode.FORBIDDEN, 'No access to this visit', 403);
  }

  /** Lock rule: completedAt + visitLockHours passed → read-only (use amendments). */
  private async ensureEditable(visit: { completedAt: Date | null }): Promise<void> {
    if (!visit.completedAt) return;
    const lockHours = await this.visitLockHours();
    if (Date.now() > visit.completedAt.getTime() + lockHours * HOUR_MS) {
      throw new AppException(
        ErrorCode.VISIT_LOCKED,
        'Visit is locked; changes require an amendment',
        423,
      );
    }
  }

  private async requireVisit(id: string, user: AuthUser): Promise<VisitDetailRow> {
    const visit = await this.prisma.db.visit.findUnique({
      where: { id },
      include: {
        vitals: true,
        diagnoses: { include: { icd10: true }, orderBy: { createdAt: 'asc' } },
        prescriptions: { include: { drug: true }, orderBy: { createdAt: 'asc' } },
        referrals: { orderBy: { createdAt: 'asc' } },
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
      dosage: p.dosage,
      frequency: p.frequency,
      durationDays: p.durationDays,
      instructions: p.instructions,
      createdAt: iso(p.createdAt),
      drug: p.drug
        ? { id: p.drug.id, name: p.drug.name, form: p.drug.form, strength: p.drug.strength }
        : null,
    };
  }

  private toReferral(r: VisitDetailRow['referrals'][number]): Record<string, unknown> {
    return {
      id: r.id,
      type: r.type,
      targetSpecialty: r.targetSpecialty,
      targetDoctorUserId: r.targetDoctorUserId,
      labOrderId: r.labOrderId,
      appointmentId: r.appointmentId,
      note: r.note,
      createdAt: iso(r.createdAt),
    };
  }

  private toDetail(v: VisitDetailRow): Record<string, unknown> {
    return {
      id: v.id,
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
          OR: [
            ...(ticketId ? [{ ticketId }] : []),
            ...(appointmentId ? [{ appointmentId }] : []),
          ],
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
    const where: Prisma.VisitWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.doctorUserId) where.doctorUserId = query.doctorUserId;
    if (query.from || query.to) {
      where.startedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    // Object-level scope: DOCTOR only sees own visits unless branch-wide mode.
    if (user.role === UserRole.DOCTOR && !(await this.isBranchWideDoctorAccess())) {
      where.doctorUserId = user.id;
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
    await this.ensureEditable(visit);

    const data: Prisma.VisitUpdateInput = {};
    if (dto.subjective !== undefined) data.subjective = dto.subjective;
    if (dto.objective !== undefined) data.objective = dto.objective;
    if (dto.assessmentNote !== undefined) data.assessmentNote = dto.assessmentNote;
    if (dto.plan !== undefined) data.plan = dto.plan;
    if (dto.nextVisitAt !== undefined) data.nextVisitAt = new Date(dto.nextVisitAt);

    await this.prisma.db.visit.update({ where: { id }, data });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Visit',
      entityId: id,
      before: {
        subjective: visit.subjective,
        objective: visit.objective,
        assessmentNote: visit.assessmentNote,
        plan: visit.plan,
        nextVisitAt: iso(visit.nextVisitAt),
      },
      after: {
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
    if (visit.status === VisitStatus.COMPLETED) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Visit is already completed',
        409,
      );
    }

    const completedAt = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt },
      });
      if (visit.appointmentId) {
        await tx.appointment.update({
          where: { id: visit.appointmentId },
          data: { status: 'COMPLETED' },
        });
      }
    });

    await this.notifications.enqueueEvent({
      event: NotificationEvent.FEEDBACK_REQUEST,
      clinicId: TenantContext.requireClinicId(),
      patientId: visit.patientId,
      vars: {
        patient_name: visit.patient.fullName,
        doctor_name: visit.doctor.fullName,
        // Portal feedback link is produced later (portal module) — empty for now.
        link: '',
      },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Visit',
      entityId: id,
      before: { status: visit.status, completedAt: iso(visit.completedAt) },
      after: { status: VisitStatus.COMPLETED, completedAt: completedAt.toISOString() },
    });

    return this.getById(id, user);
  }

  // ------------------------------------------------------------ amendments

  async amend(id: string, dto: AmendVisitDto, user: AuthUser): Promise<Record<string, unknown>> {
    // Amendments are allowed even when the visit is locked (append-only history).
    const visit = await this.requireVisit(id, user);

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const data: Prisma.VisitUpdateInput = {};
    for (const field of VISIT_EDIT_FIELDS) {
      const next = dto[field as VisitEditField];
      if (next === undefined) continue;
      if (field === 'nextVisitAt') {
        const before = iso(visit.nextVisitAt);
        const after = new Date(next).toISOString();
        if (before !== after) {
          diff[field] = { before, after };
          data.nextVisitAt = new Date(next);
        }
      } else {
        const before = visit[field];
        if (before !== next) {
          diff[field] = { before, after: next };
          data[field] = next;
        }
      }
    }
    if (Object.keys(diff).length === 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Nothing to amend', 400);
    }

    const amendmentId = await this.prisma.db.$transaction(async (tx) => {
      const amendment = await tx.visitAmendment.create({
        data: {
          clinicId: TenantContext.requireClinicId(),
          visitId: id,
          authorId: user.id,
          diff: diff as Prisma.InputJsonValue,
          reason: dto.reason,
        },
      });
      await tx.visit.update({ where: { id }, data });
      return amendment.id;
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
    const vitals = await this.prisma.db.visitVital.upsert({
      where: { visitId: id },
      create: {
        clinicId: TenantContext.requireClinicId(),
        visitId: id,
        ...fields,
        recordedById: user.id,
      },
      update: { ...fields, recordedById: user.id, recordedAt: new Date() },
    });

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
    await this.ensureEditable(visit);

    // Icd10Code is a global read-only directory (no clinicId) — justified unscoped read.
    const icd10 = await this.prisma.unscoped.icd10Code.findUnique({ where: { id: dto.icd10Id } });
    if (!icd10) throw new AppException(ErrorCode.NOT_FOUND, 'ICD-10 code not found', 404);

    const created = await this.prisma.db.$transaction(async (tx) => {
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
    await this.ensureEditable(visit);

    const diagnosis = await this.prisma.db.diagnosis.findFirst({
      where: { id: dxId, visitId: id },
    });
    if (!diagnosis) throw new AppException(ErrorCode.NOT_FOUND, 'Diagnosis not found', 404);
    await this.prisma.db.diagnosis.delete({ where: { id: dxId } });

    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Diagnosis',
      entityId: dxId,
      before: { visitId: id, icd10Id: diagnosis.icd10Id, isPrimary: diagnosis.isPrimary },
    });

    return { id: dxId };
  }

  // ------------------------------------------------------------ prescriptions

  async addPrescription(
    id: string,
    dto: AddPrescriptionDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    await this.ensureEditable(visit);

    if (dto.drugId) {
      // DrugDirectory mixes global (clinicId null) and clinic rows — justified unscoped read.
      const drug = await this.prisma.unscoped.drugDirectory.findFirst({
        where: {
          id: dto.drugId,
          OR: [{ clinicId: null }, { clinicId: TenantContext.requireClinicId() }],
        },
        select: { id: true },
      });
      if (!drug) throw new AppException(ErrorCode.NOT_FOUND, 'Drug not found', 404);
    }

    const created = await this.prisma.db.prescription.create({
      data: {
        clinicId: TenantContext.requireClinicId(),
        visitId: id,
        drugName: dto.drugName,
        drugId: dto.drugId,
        dosage: dto.dosage,
        frequency: dto.frequency,
        durationDays: dto.durationDays,
        instructions: dto.instructions,
      },
      include: { drug: true },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Prescription',
      entityId: created.id,
      after: { visitId: id, drugName: dto.drugName },
    });

    return this.toPrescription(created);
  }

  async removePrescription(id: string, rxId: string, user: AuthUser): Promise<{ id: string }> {
    const visit = await this.requireVisit(id, user);
    await this.ensureEditable(visit);

    const prescription = await this.prisma.db.prescription.findFirst({
      where: { id: rxId, visitId: id },
    });
    if (!prescription) throw new AppException(ErrorCode.NOT_FOUND, 'Prescription not found', 404);
    await this.prisma.db.prescription.delete({ where: { id: rxId } });

    await this.audit.log({
      action: AuditAction.DELETE,
      entity: 'Prescription',
      entityId: rxId,
      before: { visitId: id, drugName: prescription.drugName },
    });

    return { id: rxId };
  }

  // ------------------------------------------------------------ referrals

  async addReferral(
    id: string,
    dto: AddReferralDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
    await this.ensureEditable(visit);

    let labOrderId: string | undefined;
    if (dto.type === ReferralType.LAB) {
      if (!dto.labTestIds || dto.labTestIds.length === 0) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'labTestIds are required for a LAB referral',
          400,
        );
      }
      const order = await this.labService.createOrderFromReferral({
        patientId: visit.patientId,
        branchId: visit.branchId,
        visitId: visit.id,
        testIds: dto.labTestIds,
      });
      labOrderId = order.id;
    }

    const created = await this.prisma.db.referral.create({
      data: {
        clinicId: TenantContext.requireClinicId(),
        visitId: id,
        type: dto.type,
        targetSpecialty: dto.type === ReferralType.SPECIALIST ? dto.targetSpecialty : undefined,
        targetDoctorUserId:
          dto.type === ReferralType.SPECIALIST ? dto.targetDoctorUserId : undefined,
        labOrderId,
        note: dto.note,
      },
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Referral',
      entityId: created.id,
      after: { visitId: id, type: dto.type, labOrderId: labOrderId ?? null },
    });

    return this.toReferral(created);
  }

  // ------------------------------------------------------------ print payload

  async printPayload(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    const visit = await this.requireVisit(id, user);
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

  async updateTemplate(
    id: string,
    dto: VisitTemplatePatchDto,
  ): Promise<Record<string, unknown>> {
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
