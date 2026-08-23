import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import type { Prisma } from '@prisma/client';
import {
  AppointmentStatus,
  AuditAction,
  ErrorCode,
  NotificationEvent,
  TIMEZONE,
  type AppointmentQueryInput,
  type AuthUser,
  type ChangeAppointmentStatusInput,
  type CreateAppointmentInput,
  type CreateRecurringAppointmentInput,
  type UpdateAppointmentInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlotsService } from './slots.service';
import { DEFAULT_SLOT_MINUTES, isoWeekdayOf } from './slots.service';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Terminal states — no further transitions allowed. */
const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.CANCELLED,
];

/** Linear state machine (spec §M4): each status → allowed next statuses. */
const NEXT_STATUS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  [AppointmentStatus.SCHEDULED]: [AppointmentStatus.CONFIRMED],
  [AppointmentStatus.CONFIRMED]: [AppointmentStatus.CHECKED_IN],
  [AppointmentStatus.CHECKED_IN]: [AppointmentStatus.IN_QUEUE],
  [AppointmentStatus.IN_QUEUE]: [AppointmentStatus.IN_PROGRESS],
  [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.NO_SHOW]: [],
  [AppointmentStatus.CANCELLED]: [],
};

const APPOINTMENT_INCLUDE = {
  patient: { select: { id: true, fullName: true, phone: true } },
  doctor: { select: { id: true, fullName: true } },
  services: {
    include: {
      service: { select: { id: true, code: true, name: true, durationMin: true } },
    },
  },
} as const;

interface AppointmentRow {
  id: string;
  branchId: string;
  patientId: string;
  doctorUserId: string;
  roomId: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  note: string | null;
  recurringGroupId: string | null;
  cancelledReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  patient: { id: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string };
  services: Array<{
    id: string;
    service: { id: string; code: string; name: unknown; durationMin: number };
  }>;
}

export interface AppointmentDto {
  id: string;
  branchId: string;
  patientId: string;
  doctorUserId: string;
  roomId: string | null;
  startAt: string;
  endAt: string;
  status: string;
  note: string | null;
  recurringGroupId: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string };
  services: Array<{ id: string; serviceId: string; code: string; name: unknown; durationMin: number }>;
}

export interface RecurringResultDto {
  recurringGroupId: string;
  created: Array<{ id: string; startAt: string; endAt: string; status: string }>;
  skipped: Array<{ date: string; startAt: string; reason: string }>;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slots: SlotsService,
    private readonly audit: AuditService,
    private readonly queueService: QueueService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------- queries

  async findAll(query: AppointmentQueryInput): Promise<PaginatedResult<AppointmentDto>> {
    const where: Prisma.AppointmentWhereInput = {};
    if (query.branchId) where.branchId = query.branchId;
    if (query.doctorUserId) where.doctorUserId = query.doctorUserId;
    if (query.patientId) where.patientId = query.patientId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.startAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const { skip, take } = skipTake(query);
    const [items, total] = await Promise.all([
      this.prisma.db.appointment.findMany({
        where,
        include: APPOINTMENT_INCLUDE,
        orderBy: { startAt: 'asc' },
        skip,
        take,
      }),
      this.prisma.db.appointment.count({ where }),
    ]);

    return paginated(
      items.map((a) => this.toDto(a)),
      { page: query.page, limit: query.limit, total },
    );
  }

  async findOne(id: string): Promise<AppointmentDto> {
    const appointment = await this.prisma.db.appointment.findFirst({
      where: { id },
      include: APPOINTMENT_INCLUDE,
    });
    if (!appointment) {
      throw new AppException(ErrorCode.APPOINTMENT_NOT_FOUND, 'Appointment not found', 404);
    }
    return this.toDto(appointment);
  }

  // -------------------------------------------------------------- create

  /**
   * Creates an appointment with a transactional double-booking guard
   * (row-locked overlap check on doctor and room). Caller must have
   * TenantContext set. Cross-module contract — do not change the signature.
   */
  async create(
    input: CreateAppointmentInput,
    actorUserId: string | null,
    opts?: { recurringGroupId?: string },
  ): Promise<{ id: string; startAt: Date; endAt: Date; status: string }> {
    const clinicId = TenantContext.requireClinicId();

    const patient = await this.prisma.db.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true, fullName: true },
    });
    if (!patient) {
      throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
    }

    // User is not covered by the tenant auto-scoping extension — clinic
    // isolation is enforced by the explicit clinicId filter here.
    const doctor = await this.prisma.unscoped.user.findFirst({
      where: { id: input.doctorUserId, clinicId, deletedAt: null },
      select: { id: true, fullName: true, staffProfile: { select: { slotMinutes: true } } },
    });
    if (!doctor) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Doctor not found in this clinic', 404);
    }

    const startAt = new Date(input.startAt);
    const durationMin = await this.resolveDurationMin(
      input,
      doctor.staffProfile?.slotMinutes ?? null,
    );
    const endAt = new Date(startAt.getTime() + durationMin * MINUTE_MS);

    // Scheduled bookings must land on a free slot; walk-ins bypass the grid.
    if (!input.walkIn) {
      await this.assertInsideFreeSlot(input, startAt);
    }

    const created = await this.prisma.db.$transaction(async (tx) => {
      // Row-locked overlap guard — raw SQL keeps concurrent creates serialized
      // on the conflicting rows. clinicId is bound manually ($queryRaw is not
      // auto-scoped by the tenant extension).
      const doctorConflicts = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Appointment"
        WHERE "doctorUserId" = ${input.doctorUserId}
          AND "clinicId" = ${clinicId}
          AND "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
          AND tstzrange("startAt", "endAt") && tstzrange(${startAt}::timestamptz, ${endAt}::timestamptz)
        FOR UPDATE`;
      if (doctorConflicts.length > 0) {
        throw new AppException(
          ErrorCode.APPOINTMENT_CONFLICT,
          'Doctor already has an appointment in this interval',
          409,
        );
      }

      if (input.roomId) {
        const roomConflicts = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Appointment"
          WHERE "roomId" = ${input.roomId}
            AND "clinicId" = ${clinicId}
            AND "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
            AND tstzrange("startAt", "endAt") && tstzrange(${startAt}::timestamptz, ${endAt}::timestamptz)
          FOR UPDATE`;
        if (roomConflicts.length > 0) {
          throw new AppException(
            ErrorCode.APPOINTMENT_CONFLICT,
            'Room is occupied in this interval',
            409,
          );
        }
      }

      return tx.appointment.create({
        data: {
          // Top-level creates are auto-stamped by the tenant extension, but the
          // Prisma input type requires clinicId — same value, kept explicit.
          clinicId,
          branchId: input.branchId,
          patientId: input.patientId,
          doctorUserId: input.doctorUserId,
          roomId: input.roomId,
          startAt,
          endAt,
          note: input.note,
          recurringGroupId: opts?.recurringGroupId,
          createdById: actorUserId,
          services:
            input.serviceIds && input.serviceIds.length > 0
              ? {
                  // Nested creates are not auto-stamped — clinicId is required.
                  create: input.serviceIds.map((serviceId) => ({ serviceId, clinicId })),
                }
              : undefined,
        },
        select: { id: true, startAt: true, endAt: true, status: true },
      });
    });

    let status: string = created.status;
    if (input.walkIn) {
      await this.queueService.enqueue({
        patientId: input.patientId,
        branchId: input.branchId,
        doctorUserId: input.doctorUserId,
        appointmentId: created.id,
        priority: 'NORMAL',
      });
      const updated = await this.prisma.db.appointment.update({
        where: { id: created.id },
        data: { status: AppointmentStatus.IN_QUEUE },
        select: { status: true },
      });
      status = updated.status;
    }

    await this.notifications.enqueueEvent({
      event: NotificationEvent.APPOINTMENT_CREATED,
      clinicId,
      patientId: input.patientId,
      vars: {
        patient_name: patient.fullName,
        doctor_name: doctor.fullName,
        time: formatInTimeZone(startAt, TIMEZONE, 'dd.MM.yyyy HH:mm'),
        clinic_name: await this.clinicName(clinicId),
      },
    });
    await this.notifications.scheduleAppointmentReminders({
      id: created.id,
      clinicId,
      patientId: input.patientId,
      startAt,
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entity: 'Appointment',
      entityId: created.id,
      after: {
        patientId: input.patientId,
        doctorUserId: input.doctorUserId,
        branchId: input.branchId,
        roomId: input.roomId ?? null,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        status,
        walkIn: input.walkIn ?? false,
      },
    });

    return { id: created.id, startAt: created.startAt, endAt: created.endAt, status };
  }

  // -------------------------------------------------------------- update / reschedule

  async update(
    id: string,
    input: UpdateAppointmentInput,
    _actorUserId: string,
  ): Promise<AppointmentDto> {
    const clinicId = TenantContext.requireClinicId();

    const existing = await this.prisma.db.appointment.findFirst({
      where: { id },
      include: { services: { select: { serviceId: true } } },
    });
    if (!existing) {
      throw new AppException(ErrorCode.APPOINTMENT_NOT_FOUND, 'Appointment not found', 404);
    }
    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Completed or cancelled appointments cannot be edited',
        409,
      );
    }

    // Duration: replacement services win; otherwise keep the current length.
    let durationMin = Math.round((existing.endAt.getTime() - existing.startAt.getTime()) / MINUTE_MS);
    if (input.serviceIds && input.serviceIds.length > 0) {
      durationMin = await this.sumServiceDurations(input.serviceIds);
    }
    if (durationMin <= 0) durationMin = DEFAULT_SLOT_MINUTES;

    const startAt = input.startAt ? new Date(input.startAt) : existing.startAt;
    const endAt = new Date(startAt.getTime() + durationMin * MINUTE_MS);
    const roomId = input.roomId !== undefined ? input.roomId : existing.roomId;
    const rescheduled = startAt.getTime() !== existing.startAt.getTime();

    await this.prisma.db.$transaction(async (tx) => {
      // Reschedule re-checks conflicts (excluding this appointment) under lock.
      const doctorConflicts = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Appointment"
        WHERE "doctorUserId" = ${existing.doctorUserId}
          AND "clinicId" = ${clinicId}
          AND "id" <> ${id}
          AND "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
          AND tstzrange("startAt", "endAt") && tstzrange(${startAt}::timestamptz, ${endAt}::timestamptz)
        FOR UPDATE`;
      if (doctorConflicts.length > 0) {
        throw new AppException(
          ErrorCode.APPOINTMENT_CONFLICT,
          'Doctor already has an appointment in this interval',
          409,
        );
      }

      if (roomId) {
        const roomConflicts = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Appointment"
          WHERE "roomId" = ${roomId}
            AND "clinicId" = ${clinicId}
            AND "id" <> ${id}
            AND "status"::text NOT IN ('CANCELLED', 'NO_SHOW')
            AND tstzrange("startAt", "endAt") && tstzrange(${startAt}::timestamptz, ${endAt}::timestamptz)
          FOR UPDATE`;
        if (roomConflicts.length > 0) {
          throw new AppException(
            ErrorCode.APPOINTMENT_CONFLICT,
            'Room is occupied in this interval',
            409,
          );
        }
      }

      if (input.serviceIds !== undefined) {
        await tx.appointmentService.deleteMany({ where: { appointmentId: id } });
        if (input.serviceIds.length > 0) {
          await tx.appointmentService.createMany({
            data: input.serviceIds.map((serviceId) => ({ appointmentId: id, serviceId, clinicId })),
          });
        }
      }

      await tx.appointment.update({
        where: { id },
        data: {
          startAt,
          endAt,
          roomId: input.roomId,
          note: input.note,
        },
      });
    });

    if (rescheduled) {
      // Reschedule = cancel old reminders and schedule for the new time.
      await this.notifications.cancelAppointmentReminders(id);
      await this.notifications.scheduleAppointmentReminders({
        id,
        clinicId,
        patientId: existing.patientId,
        startAt,
      });
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Appointment',
      entityId: id,
      before: {
        startAt: existing.startAt.toISOString(),
        endAt: existing.endAt.toISOString(),
        roomId: existing.roomId,
        note: existing.note,
        serviceIds: existing.services.map((s) => s.serviceId),
      },
      after: {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        roomId,
        note: input.note !== undefined ? input.note : existing.note,
        serviceIds:
          input.serviceIds !== undefined
            ? input.serviceIds
            : existing.services.map((s) => s.serviceId),
      },
    });

    return this.findOne(id);
  }

  // -------------------------------------------------------------- status machine

  async changeStatus(
    id: string,
    input: ChangeAppointmentStatusInput,
    actor: AuthUser,
  ): Promise<AppointmentDto> {
    const clinicId = TenantContext.requireClinicId();

    const existing = await this.prisma.db.appointment.findFirst({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
        doctor: { select: { fullName: true } },
      },
    });
    if (!existing) {
      throw new AppException(ErrorCode.APPOINTMENT_NOT_FOUND, 'Appointment not found', 404);
    }

    const from = existing.status;
    const to = input.status;

    const isTerminalRequest =
      to === AppointmentStatus.CANCELLED || to === AppointmentStatus.NO_SHOW;
    const allowed = isTerminalRequest
      ? !TERMINAL_STATUSES.includes(from) // NO_SHOW / CANCELLED from any pre-COMPLETED state
      : (NEXT_STATUS[from] ?? []).includes(to);
    if (!allowed) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot change appointment status from ${from} to ${to}`,
        409,
      );
    }

    // Transition-level checks live HERE, not on the controller: the endpoint
    // serves two distinct rights. Cancellation needs appointments.cancel, every
    // other transition needs appointments.write — requiring write at the
    // controller made a cancel-only grant a dead end: the button rendered, the
    // server refused.
    if (to === AppointmentStatus.CANCELLED) {
      if (!actor.permissions.includes('appointments.cancel')) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Missing appointments.cancel permission', 403);
      }
    } else if (!actor.permissions.includes('appointments.write')) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing appointments.write permission', 403);
    }

    await this.prisma.db.appointment.update({
      where: { id },
      data: {
        status: to,
        cancelledReason: to === AppointmentStatus.CANCELLED ? (input.reason ?? null) : undefined,
      },
    });

    if (to === AppointmentStatus.NO_SHOW) {
      // Patient reliability tracking.
      await this.prisma.db.patient.update({
        where: { id: existing.patientId },
        data: { noShowCount: { increment: 1 } },
      });
    }

    if (to === AppointmentStatus.CANCELLED) {
      await this.notifications.cancelAppointmentReminders(id);
      await this.notifications.enqueueEvent({
        event: NotificationEvent.APPOINTMENT_CANCELLED,
        clinicId,
        patientId: existing.patientId,
        vars: {
          patient_name: existing.patient.fullName,
          doctor_name: existing.doctor.fullName,
          time: formatInTimeZone(existing.startAt, TIMEZONE, 'dd.MM.yyyy HH:mm'),
          clinic_name: await this.clinicName(clinicId),
        },
      });
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Appointment',
      entityId: id,
      before: { status: from },
      after: { status: to, reason: input.reason ?? null },
    });

    return this.findOne(id);
  }

  // -------------------------------------------------------------- recurring

  /**
   * Creates a course of N sessions every `intervalDays` days at the same
   * local time. Dates with conflicts / no free slot are skipped, not failed.
   * (Asia/Tashkent has no DST, so day arithmetic preserves the local time.)
   */
  async createRecurring(
    input: CreateRecurringAppointmentInput,
    actorUserId: string,
  ): Promise<RecurringResultDto> {
    const { sessionsCount, intervalDays, ...base } = input;
    const recurringGroupId = randomUUID();
    const firstStart = new Date(base.startAt);

    const created: RecurringResultDto['created'] = [];
    const skipped: RecurringResultDto['skipped'] = [];

    for (let session = 0; session < sessionsCount; session += 1) {
      const startAt = new Date(firstStart.getTime() + session * intervalDays * DAY_MS);
      try {
        const result = await this.create(
          { ...base, startAt: startAt.toISOString(), walkIn: false },
          actorUserId,
          { recurringGroupId },
        );
        created.push({
          id: result.id,
          startAt: result.startAt.toISOString(),
          endAt: result.endAt.toISOString(),
          status: result.status,
        });
      } catch (err) {
        if (
          err instanceof AppException &&
          (err.code === ErrorCode.APPOINTMENT_CONFLICT ||
            err.code === ErrorCode.SLOT_OUTSIDE_SCHEDULE)
        ) {
          skipped.push({
            date: formatInTimeZone(startAt, TIMEZONE, 'yyyy-MM-dd'),
            startAt: startAt.toISOString(),
            reason: err.code,
          });
          continue;
        }
        throw err;
      }
    }

    return { recurringGroupId, created, skipped };
  }

  // -------------------------------------------------------------- helpers

  private async assertInsideFreeSlot(input: CreateAppointmentInput, startAt: Date): Promise<void> {
    const date = formatInTimeZone(startAt, TIMEZONE, 'yyyy-MM-dd');
    const free = await this.slots.getFreeSlots({
      doctorUserId: input.doctorUserId,
      branchId: input.branchId,
      date,
      serviceId: input.serviceIds?.[0],
    });
    const startMs = startAt.getTime();
    const inside = free.some(
      (s) => startMs >= new Date(s.startAt).getTime() && startMs < new Date(s.endAt).getTime(),
    );
    if (!inside) {
      throw new AppException(
        ErrorCode.SLOT_OUTSIDE_SCHEDULE,
        'Start time is outside the doctor free slots',
        409,
      );
    }
  }

  private async resolveDurationMin(
    input: CreateAppointmentInput,
    staffSlotMinutes: number | null,
  ): Promise<number> {
    if (input.serviceIds && input.serviceIds.length > 0) {
      return this.sumServiceDurations(input.serviceIds);
    }
    // No services: use the schedule window slot length for that time of day.
    const startAt = new Date(input.startAt);
    const date = formatInTimeZone(startAt, TIMEZONE, 'yyyy-MM-dd');
    const time = formatInTimeZone(startAt, TIMEZONE, 'HH:mm');
    const schedules = await this.prisma.db.doctorSchedule.findMany({
      where: {
        doctorUserId: input.doctorUserId,
        branchId: input.branchId,
        weekday: isoWeekdayOf(date),
        isActive: true,
      },
      select: { startTime: true, endTime: true, slotMinutes: true },
    });
    const window = schedules.find((s) => s.startTime <= time && time < s.endTime);
    return window?.slotMinutes ?? staffSlotMinutes ?? DEFAULT_SLOT_MINUTES;
  }

  private async sumServiceDurations(serviceIds: string[]): Promise<number> {
    const services = await this.prisma.db.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, durationMin: true },
    });
    if (services.length !== serviceIds.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'One or more services not found', 404);
    }
    return services.reduce((sum, s) => sum + s.durationMin, 0);
  }

  private async clinicName(clinicId: string): Promise<string> {
    // Clinic is the tenant root (not auto-scoped); lookup restricted to the
    // current clinic id from TenantContext.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    return clinic?.name ?? '';
  }

  private toDto(a: AppointmentRow): AppointmentDto {
    return {
      id: a.id,
      branchId: a.branchId,
      patientId: a.patientId,
      doctorUserId: a.doctorUserId,
      roomId: a.roomId,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
      note: a.note,
      recurringGroupId: a.recurringGroupId,
      cancelledReason: a.cancelledReason,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      patient: { id: a.patient.id, fullName: a.patient.fullName, phone: a.patient.phone },
      doctor: { id: a.doctor.id, fullName: a.doctor.fullName },
      services: a.services.map((s) => ({
        id: s.id,
        serviceId: s.service.id,
        code: s.service.code,
        name: s.service.name,
        durationMin: s.service.durationMin,
      })),
    };
  }
}
