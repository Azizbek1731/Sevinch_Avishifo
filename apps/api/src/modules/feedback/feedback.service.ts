import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { AuditAction, ErrorCode, UserRole, UserStatus, type AuthUser } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FeedbackQueryDto, FeedbackStatsQueryDto, FeedbackVisibilityDto, PublicFeedbackDto, SubmitFeedbackDto } from './dto';

/** Signed into the SMS/Telegram feedback link; verified on public submission. */
interface FeedbackTokenPayload {
  typ: 'feedback';
  visitId: string;
  clinicId: string;
}

const FEEDBACK_TOKEN_TTL = '30d';
const LOW_RATING_THRESHOLD = 2;

const iso = (d: Date): string => d.toISOString();

type FeedbackRow = Prisma.FeedbackGetPayload<{
  include: {
    patient: { select: { id: true; fullName: true; mrn: true } };
    doctor: { select: { id: true; fullName: true } };
  };
}>;

const FEEDBACK_INCLUDE = {
  patient: { select: { id: true, fullName: true, mrn: true } },
  doctor: { select: { id: true, fullName: true } },
} satisfies Prisma.FeedbackInclude;

function isFeedbackTokenPayload(v: unknown): v is FeedbackTokenPayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return p.typ === 'feedback' && typeof p.visitId === 'string' && typeof p.clinicId === 'string';
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ mapping

  private toResponse(f: FeedbackRow): Record<string, unknown> {
    return {
      id: f.id,
      branchId: f.branchId,
      patientId: f.patientId,
      visitId: f.visitId,
      doctorUserId: f.doctorUserId,
      rating: f.rating,
      comment: f.comment,
      isPublic: f.isPublic,
      createdAt: iso(f.createdAt),
      patient: f.patient
        ? { id: f.patient.id, fullName: f.patient.fullName, mrn: f.patient.mrn }
        : null,
      doctor: f.doctor ? { id: f.doctor.id, fullName: f.doctor.fullName } : null,
    };
  }

  // ------------------------------------------------------------ token

  /** Signed link payload for the post-visit rating request (staff copies the link). */
  async issueToken(visitId: string): Promise<{ token: string; link: string }> {
    const visit = await this.prisma.db.visit.findFirst({
      where: { id: visitId },
      select: { id: true },
    });
    if (!visit) {
      throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
    }
    const payload: FeedbackTokenPayload = {
      typ: 'feedback',
      visitId,
      clinicId: TenantContext.requireClinicId(),
    };
    const token = await this.jwt.signAsync({ ...payload }, { expiresIn: FEEDBACK_TOKEN_TTL });
    return { token, link: `/feedback?token=${token}` };
  }

  // ------------------------------------------------------------ public submission

  /** Anonymous-link submission: token → visit → one feedback per visit (upsert). */
  async submitPublic(dto: PublicFeedbackDto): Promise<Record<string, unknown>> {
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(dto.token);
    } catch {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired feedback token', 401);
    }
    if (!isFeedbackTokenPayload(payload)) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid feedback token', 401);
    }
    const { visitId, clinicId } = payload;

    // Public route has no tenant context — enter the clinic scope from the token.
    return TenantContext.run({ clinicId }, async () => {
      const visit = await this.prisma.db.visit.findFirst({
        where: { id: visitId },
        select: { id: true, branchId: true, patientId: true, doctorUserId: true },
      });
      if (!visit) {
        throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
      }

      const saved = await this.upsertForVisit(visit, dto.rating, dto.comment);
      await this.alertOnLowRating(clinicId, saved.id, dto.rating, dto.comment);
      return this.toResponse(saved);
    });
  }

  // ------------------------------------------------------------ authed submission

  /** Staff on-behalf / portal submission (submitFeedbackSchema). */
  async submit(dto: SubmitFeedbackDto, user: AuthUser): Promise<Record<string, unknown>> {
    const clinicId = TenantContext.requireClinicId();

    if (dto.visitId) {
      const visit = await this.prisma.db.visit.findFirst({
        where: { id: dto.visitId },
        select: { id: true, branchId: true, patientId: true, doctorUserId: true },
      });
      if (!visit) {
        throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
      }
      const saved = await this.upsertForVisit(visit, dto.rating, dto.comment);
      await this.alertOnLowRating(clinicId, saved.id, dto.rating, dto.comment);
      return this.toResponse(saved);
    }

    // No visit: only a PATIENT-role user can rate the clinic/doctor directly —
    // the patient card comes from their own user row link.
    if (user.role !== UserRole.PATIENT) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'visitId is required', 400);
    }
    // unscoped: own User row lookup by id (User.clinicId is nullable so the
    // tenant-scoped client is not reliable for this model); id comes from the JWT.
    const self = await this.prisma.unscoped.user.findUnique({
      where: { id: user.id },
      select: { patientId: true, clinicId: true },
    });
    if (!self?.patientId || self.clinicId !== clinicId) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No linked patient card', 403);
    }
    // Feedback.branchId is required — without a visit, attach to the oldest branch.
    const branch = await this.prisma.db.branch.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic has no branches', 404);
    }
    const saved = await this.prisma.db.feedback.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        branchId: branch.id,
        patientId: self.patientId,
        doctorUserId: dto.doctorUserId ?? null,
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
      include: FEEDBACK_INCLUDE,
    });
    await this.alertOnLowRating(clinicId, saved.id, dto.rating, dto.comment);
    return this.toResponse(saved);
  }

  // ------------------------------------------------------------ list & stats

  async list(query: FeedbackQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const where: Prisma.FeedbackWhereInput = {};
    if (query.doctorUserId) where.doctorUserId = query.doctorUserId;
    if (query.minRating !== undefined || query.maxRating !== undefined) {
      where.rating = { gte: query.minRating, lte: query.maxRating };
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [total, rows] = await Promise.all([
      this.prisma.db.feedback.count({ where }),
      this.prisma.db.feedback.findMany({
        where,
        include: FEEDBACK_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
    ]);
    return paginated(
      rows.map((r) => this.toResponse(r)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async stats(query: FeedbackStatsQueryDto): Promise<Record<string, unknown>> {
    const where: Prisma.FeedbackWhereInput = {};
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const rows = await this.prisma.db.feedback.findMany({
      where,
      select: { rating: true, doctorUserId: true },
    });

    const distribution: Record<'1' | '2' | '3' | '4' | '5', number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    let sum = 0;
    const perDoctor = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      sum += r.rating;
      const key = String(r.rating) as keyof typeof distribution;
      if (key in distribution) distribution[key] += 1;
      if (r.doctorUserId) {
        const agg = perDoctor.get(r.doctorUserId) ?? { sum: 0, count: 0 };
        agg.sum += r.rating;
        agg.count += 1;
        perDoctor.set(r.doctorUserId, agg);
      }
    }
    const count = rows.length;
    const round2 = (n: number): number => Math.round(n * 100) / 100;

    const doctorIds = [...perDoctor.keys()];
    const doctors = doctorIds.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: doctorIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(doctors.map((d) => [d.id, d.fullName]));

    return {
      count,
      avg: count > 0 ? round2(sum / count) : null,
      distribution,
      perDoctor: doctorIds
        .map((id) => {
          const agg = perDoctor.get(id) as { sum: number; count: number };
          return {
            doctor: { id, fullName: nameById.get(id) ?? null },
            avg: round2(agg.sum / agg.count),
            count: agg.count,
          };
        })
        .sort((a, b) => b.count - a.count),
    };
  }

  // ------------------------------------------------------------ visibility

  async setVisibility(
    id: string,
    dto: FeedbackVisibilityDto,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.db.feedback.findFirst({ where: { id } });
    if (!existing) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Feedback not found', 404);
    }
    const updated = await this.prisma.db.feedback.update({
      where: { id },
      data: { isPublic: dto.isPublic },
      include: FEEDBACK_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Feedback',
      entityId: id,
      before: { isPublic: existing.isPublic },
      after: { isPublic: updated.isPublic },
      userId: user.id,
    });
    return this.toResponse(updated);
  }

  // ------------------------------------------------------------ internals

  /** One feedback per visit — update in place on repeat submission. */
  private async upsertForVisit(
    visit: { id: string; branchId: string; patientId: string; doctorUserId: string },
    rating: number,
    comment: string | undefined,
  ): Promise<FeedbackRow> {
    const existing = await this.prisma.db.feedback.findFirst({
      where: { visitId: visit.id },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.db.feedback.update({
        where: { id: existing.id },
        data: { rating, comment: comment ?? null },
        include: FEEDBACK_INCLUDE,
      });
    }
    return this.prisma.db.feedback.create({
      data: {
        // Required by Prisma's checked input type; the tenant extension re-stamps the same value.
        clinicId: TenantContext.requireClinicId(),
        branchId: visit.branchId,
        patientId: visit.patientId,
        visitId: visit.id,
        doctorUserId: visit.doctorUserId,
        rating,
        comment: comment ?? null,
      },
      include: FEEDBACK_INCLUDE,
    });
  }

  /** rating ≤ 2 → in-app alert to every clinic owner/admin. Never blocks the submission. */
  private async alertOnLowRating(
    clinicId: string,
    feedbackId: string,
    rating: number,
    comment: string | undefined,
  ): Promise<void> {
    if (rating > LOW_RATING_THRESHOLD) return;
    try {
      // unscoped: recipients are looked up by clinicId + role because the alert
      // may fire from the public (tokened) route where only the token names the
      // clinic; filter is pinned to that clinicId so no cross-tenant leak.
      const admins = await this.prisma.unscoped.user.findMany({
        where: {
          clinicId,
          role: { in: [UserRole.CLINIC_OWNER, UserRole.CLINIC_ADMIN] },
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: { id: true },
      });
      await Promise.all(
        admins.map((a) =>
          this.notifications.sendInApp({
            clinicId,
            userId: a.id,
            title: `Past baho: ${rating} yulduz`,
            body: comment?.slice(0, 200) ?? 'Bemor tashrifga past baho berdi',
            link: '/feedback',
          }),
        ),
      );
    } catch (err) {
      // Alert delivery must not fail the feedback write. Ids only — no PHI.
      this.logger.error(`low-rating alert failed for feedback ${feedbackId}: ${(err as Error).message}`);
    }
  }
}
