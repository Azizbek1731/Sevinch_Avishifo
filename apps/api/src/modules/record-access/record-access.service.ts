import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  ErrorCode,
  RecordAccessStatus,
  UserRole,
  type AuthUser,
  type DecideRecordAccessInput,
  type RecordAccessListQuery,
  type RecordAccessRequestDto,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, type PaginatedResult } from '../../common/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramChannel } from '../notifications/channels/telegram.channel';

/**
 * Governs whether a patient may read their own clinical history (SOAP notes,
 * diagnoses, prescriptions) outside the clinic.
 *
 * Lab results are deliberately NOT gated here: once a result is approved it is
 * the patient's, and withholding it only pushes them to phone the front desk.
 * The narrative record is different — a diagnosis read alone, without a
 * clinician to explain it, can do real harm, so a doctor or clinic admin
 * releases it explicitly. Approval is one-off and holds until the clinic
 * revokes it.
 *
 * Scope is per clinic. A patient treated at two clinics needs two approvals,
 * and clinic A's decision never exposes clinic B's notes.
 */
@Injectable()
export class RecordAccessService {
  private readonly logger = new Logger(RecordAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramChannel,
  ) {}

  // ------------------------------------------------------------ read model

  /**
   * Clinic ids where this patient's history is currently readable.
   * The portal calls this with a phone verified by OTP.
   */
  async approvedClinicIds(phone: string): Promise<string[]> {
    // Unscoped (justified): the portal is cross-clinic; the patient is
    // identified by a phone number already verified by OTP, not by a tenant.
    const rows = await this.prisma.unscoped.medicalRecordAccess.findMany({
      where: { status: RecordAccessStatus.APPROVED, patient: { phone, deletedAt: null } },
      select: { clinicId: true },
    });
    return rows.map((r) => r.clinicId);
  }

  async isApprovedForClinic(phone: string, clinicId: string): Promise<boolean> {
    // Unscoped (justified): same as approvedClinicIds.
    const row = await this.prisma.unscoped.medicalRecordAccess.findFirst({
      where: {
        clinicId,
        status: RecordAccessStatus.APPROVED,
        patient: { phone, deletedAt: null },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * One row per clinic the patient has records in, each with its access state —
   * this is what the portal renders as the "request access" screen.
   */
  async patientOverview(phone: string): Promise<
    Array<{
      clinicId: string;
      clinicName: string;
      status: RecordAccessStatus | 'NONE';
      requestedAt: string | null;
      decidedAt: string | null;
      decisionNote: string | null;
      canViewHistory: boolean;
      visitCount: number;
    }>
  > {
    // Unscoped (justified): cross-clinic patient view keyed by verified phone.
    const patients = await this.prisma.unscoped.patient.findMany({
      where: { phone, deletedAt: null },
      select: {
        id: true,
        clinicId: true,
        recordAccess: {
          select: {
            status: true,
            requestedAt: true,
            decidedAt: true,
            decisionNote: true,
          },
        },
        _count: { select: { visits: true } },
      },
    });

    // Patient has no clinic relation (clinicId only), so names come separately.
    const clinics = await this.prisma.unscoped.clinic.findMany({
      where: { id: { in: [...new Set(patients.map((p) => p.clinicId))] } },
      select: { id: true, name: true },
    });
    const clinicNames = new Map(clinics.map((c) => [c.id, c.name]));

    return patients.map((p) => {
      const a = p.recordAccess;
      return {
        clinicId: p.clinicId,
        clinicName: clinicNames.get(p.clinicId) ?? '',
        status: a?.status ?? 'NONE',
        requestedAt: a?.requestedAt.toISOString() ?? null,
        decidedAt: a?.decidedAt?.toISOString() ?? null,
        decisionNote: a?.decisionNote ?? null,
        canViewHistory: a?.status === RecordAccessStatus.APPROVED,
        visitCount: p._count.visits,
      };
    });
  }

  // ------------------------------------------------------------ patient side

  /**
   * Patient asks a clinic to release their history. Re-requesting after a
   * rejection or revocation reopens the same row — the clinic sees one entry
   * per patient, never a queue of duplicates.
   */
  async request(
    phone: string,
    clinicId: string,
    note?: string,
  ): Promise<{ status: RecordAccessStatus }> {
    // Unscoped (justified): the portal patient is identified by verified phone.
    const patient = await this.prisma.unscoped.patient.findFirst({
      where: { phone, clinicId, deletedAt: null },
      select: { id: true, fullName: true, mrn: true, recordAccess: { select: { status: true } } },
    });
    if (!patient) {
      throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Bu klinikada yozuvlaringiz topilmadi', 404);
    }

    // Already open — don't reset an approval into a pending state.
    if (patient.recordAccess?.status === RecordAccessStatus.APPROVED) {
      return { status: RecordAccessStatus.APPROVED };
    }

    // Unscoped (justified): writing the row for the clinic the patient belongs
    // to; there is no staff tenant context on a portal request.
    const row = await this.prisma.unscoped.medicalRecordAccess.upsert({
      where: { patientId: patient.id },
      create: {
        clinicId,
        patientId: patient.id,
        status: RecordAccessStatus.PENDING,
        patientNote: note ?? null,
      },
      update: {
        status: RecordAccessStatus.PENDING,
        patientNote: note ?? null,
        requestedAt: new Date(),
        decidedAt: null,
        decidedById: null,
        decisionNote: null,
      },
      select: { id: true },
    });

    await this.notifyStaff(clinicId, row.id, patient.fullName, patient.mrn, note);
    return { status: RecordAccessStatus.PENDING };
  }

  // ------------------------------------------------------------ staff side

  async list(query: RecordAccessListQuery): Promise<PaginatedResult<RecordAccessRequestDto>> {
    const where = query.status ? { status: query.status } : {};
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.db.medicalRecordAccess.findMany({
        where,
        select: {
          id: true,
          status: true,
          patientNote: true,
          decisionNote: true,
          requestedAt: true,
          decidedAt: true,
          decidedById: true,
          patient: { select: { id: true, mrn: true, fullName: true, phone: true } },
        },
        // Pending first, then most recently asked — the inbox should open on work.
        orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.db.medicalRecordAccess.count({ where }),
    ]);

    const deciderIds = [...new Set(rows.map((r) => r.decidedById).filter((v): v is string => !!v))];
    const deciders = deciderIds.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: deciderIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const byId = new Map(deciders.map((d) => [d.id, d]));

    return paginated(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        patientNote: r.patientNote,
        decisionNote: r.decisionNote,
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        patient: r.patient,
        decidedBy: r.decidedById ? (byId.get(r.decidedById) ?? null) : null,
      })),
      { page: query.page, limit: query.pageSize, total },
    );
  }

  /** How many decisions are waiting — drives the sidebar badge. */
  async pendingCount(): Promise<{ pending: number }> {
    const pending = await this.prisma.db.medicalRecordAccess.count({
      where: { status: RecordAccessStatus.PENDING },
    });
    return { pending };
  }

  async decide(
    id: string,
    input: DecideRecordAccessInput,
    user: AuthUser,
  ): Promise<RecordAccessRequestDto> {
    const existing = await this.prisma.db.medicalRecordAccess.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        clinicId: true,
        patient: { select: { id: true, fullName: true, phone: true } },
      },
    });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'So‘rov topilmadi', 404);

    const updated = await this.prisma.db.medicalRecordAccess.update({
      where: { id },
      data: {
        status: input.status,
        decisionNote: input.note ?? null,
        decidedById: user.id,
        decidedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        patientNote: true,
        decisionNote: true,
        requestedAt: true,
        decidedAt: true,
        patient: { select: { id: true, mrn: true, fullName: true, phone: true } },
      },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'MedicalRecordAccess',
      entityId: id,
      clinicId: existing.clinicId,
      before: { status: existing.status },
      after: { status: input.status, note: input.note ?? null },
    });

    if (existing.patient.phone) {
      await this.notifyPatient(existing.clinicId, existing.patient.phone, input.status);
    }

    return {
      ...updated,
      requestedAt: updated.requestedAt.toISOString(),
      decidedAt: updated.decidedAt?.toISOString() ?? null,
      decidedBy: { id: user.id, fullName: user.fullName },
    };
  }

  // ------------------------------------------------------------ notifications

  /**
   * Reaches whoever can actually decide: in-app for everyone holding the
   * permission, plus Telegram for those who linked a chat (most owners run the
   * clinic from their phone and never open the panel).
   */
  private async notifyStaff(
    clinicId: string,
    requestId: string,
    patientName: string,
    mrn: string,
    note?: string,
  ): Promise<void> {
    const title = 'Kasallik tarixiga ruxsat so‘raldi';
    const body = `${patientName} (${mrn}) o‘z kasallik tarixini ko‘rish uchun ruxsat so‘radi.${
      note ? ` Izoh: ${note}` : ''
    }`;

    try {
      // Unscoped (justified): no staff tenant context on a portal request; the
      // clinic is resolved from the patient record above.
      const staff = await this.prisma.unscoped.user.findMany({
        where: {
          clinicId,
          status: 'ACTIVE',
          role: { in: [UserRole.CLINIC_OWNER, UserRole.CLINIC_ADMIN, UserRole.DOCTOR] },
        },
        select: { id: true, telegramChatId: true },
      });

      await Promise.all(
        staff.map((s) =>
          this.notifications
            .sendInApp({
              clinicId,
              userId: s.id,
              title,
              body,
              link: '/patients/record-access',
            })
            .catch((e: unknown) => this.logger.warn(`in-app notify failed: ${String(e)}`)),
        ),
      );

      await Promise.all(
        staff
          .filter((s) => s.telegramChatId)
          .map((s) =>
            this.telegram
              .send(s.telegramChatId as string, `🔐 ${title}\n\n${body}`, {
              inline_keyboard: [
                [
                  { text: '✅ Ruxsat berish', callback_data: `ra_ok:${requestId}` },
                  { text: '❌ Rad etish', callback_data: `ra_no:${requestId}` },
                ],
              ],
            })
              .catch((e: unknown) => this.logger.warn(`telegram notify failed: ${String(e)}`)),
          ),
      );
    } catch (e) {
      // A notification failure must not sink the patient's request — the row is
      // already written and will show up in the inbox regardless.
      this.logger.error(`record-access staff notification failed: ${String(e)}`);
    }
  }

  private async notifyPatient(
    clinicId: string,
    phone: string,
    status: RecordAccessStatus,
  ): Promise<void> {
    const text =
      status === RecordAccessStatus.APPROVED
        ? '✅ Kasallik tarixingizni ko‘rishga ruxsat berildi. Ilovada yoki botda ko‘rishingiz mumkin.'
        : status === RecordAccessStatus.REJECTED
          ? '❌ Kasallik tarixiga ruxsat so‘rovingiz rad etildi. Batafsil ma‘lumot uchun klinikaga murojaat qiling.'
          : '🔒 Kasallik tarixiga ruxsatingiz bekor qilindi.';

    try {
      await TenantContext.run({ clinicId }, async () => {
        const link = await this.prisma.db.telegramLink.findFirst({
          where: { patient: { phone, deletedAt: null }, isActive: true },
          select: { chatId: true },
        });
        if (link) await this.telegram.send(link.chatId, text);
      });
    } catch (e) {
      this.logger.warn(`record-access patient notification failed: ${String(e)}`);
    }
  }
}
