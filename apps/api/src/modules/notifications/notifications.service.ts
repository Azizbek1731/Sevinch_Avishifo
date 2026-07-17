import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ErrorCode,
  normalizePhone,
  type AuthUser,
  type Locale as SharedLocale,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationLogQueryInput,
  type PaginationQuery,
  type SendTestInput,
  type TemplateUpsertInput,
} from '@avishifo/shared';
import type { Locale as DbLocale } from '@prisma/client';
import { AuditAction } from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { EventsService } from '../../core/realtime/events.service';
import { AuditService } from '../../core/audit/audit.service';
import { SmsChannel } from './channels/sms.channel';
import { TelegramChannel } from './channels/telegram.channel';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const REMINDERS_QUEUE = 'reminders';

/** Job payload for the 'notifications' queue (one job per channel). */
export interface NotificationJobData {
  logId: string;
  clinicId: string;
  event: NotificationEvent;
  channel: 'SMS' | 'TELEGRAM';
  recipient: string;
  patientId?: string;
  vars: Record<string, string>;
}

export type ReminderKind = '24h' | '2h';

/** Job payload for the delayed 'reminders' queue. */
export interface ReminderJobData {
  appointmentId: string;
  clinicId: string;
  kind: ReminderKind;
}

export function reminderJobId(appointmentId: string, kind: ReminderKind): string {
  return `apt-${appointmentId}-${kind}`;
}

const HOUR_MS = 60 * 60 * 1000;

export interface TemplateResponse {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  locale: SharedLocale;
  body: string;
  isActive: boolean;
}

export interface NotificationLogResponse {
  id: string;
  patientId: string | null;
  userId: string | null;
  event: NotificationEvent;
  channel: NotificationChannel;
  recipient: string;
  body: string;
  status: string;
  error: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}

export interface InboxItemResponse {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface InboxResponse {
  items: InboxItemResponse[];
  unreadCount: number;
  page: number;
  limit: number;
  total: number;
}

/** shared 'uz-Cyrl' ↔ prisma 'uz_Cyrl' (identical otherwise). */
function toDbLocale(locale: SharedLocale): DbLocale {
  return locale === 'uz-Cyrl' ? 'uz_Cyrl' : locale;
}
function fromDbLocale(locale: DbLocale): SharedLocale {
  return locale === 'uz_Cyrl' ? 'uz-Cyrl' : locale;
}

/**
 * M13 — provider-agnostic notification hub. Other modules call the four
 * contract methods (enqueueEvent / scheduleAppointmentReminders /
 * cancelAppointmentReminders / sendInApp); delivery happens in BullMQ workers.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue,
    @InjectQueue(REMINDERS_QUEUE) private readonly remindersQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly sms: SmsChannel,
    private readonly telegram: TelegramChannel,
  ) {}

  // ------------------------------------------------------------ contract API

  /**
   * Resolve recipients for a patient-facing event and enqueue one delivery job
   * per channel (Telegram when the patient linked the bot, otherwise SMS).
   * Safe to call without an HTTP tenant context (workers pass clinicId).
   */
  async enqueueEvent(i: {
    event: NotificationEvent;
    clinicId: string;
    patientId?: string;
    vars: Record<string, string>;
  }): Promise<void> {
    const patientId = i.patientId;
    if (!patientId) return; // only patient-targeted channels are resolved here

    // Callers may be BullMQ workers without an ALS tenant context — establish it.
    const target = await TenantContext.run({ clinicId: i.clinicId }, async () => {
      const patient = await this.prisma.db.patient.findUnique({
        where: { id: patientId },
        select: { id: true, phone: true },
      });
      if (!patient) return null;
      const link = await this.prisma.db.telegramLink.findFirst({
        where: { patientId: patient.id, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { chatId: true },
      });
      return { patient, link };
    });
    if (!target) return;

    const jobs: Array<{ channel: 'SMS' | 'TELEGRAM'; recipient: string }> = [];
    if (target.link) jobs.push({ channel: 'TELEGRAM', recipient: target.link.chatId });
    else if (target.patient.phone) jobs.push({ channel: 'SMS', recipient: target.patient.phone });
    if (jobs.length === 0) return;

    for (const job of jobs) {
      const log = await TenantContext.run({ clinicId: i.clinicId }, () =>
        this.prisma.db.notificationLog.create({
          data: {
            clinicId: i.clinicId,
            patientId: target.patient.id,
            event: i.event,
            channel: job.channel,
            recipient: job.recipient,
            body: '', // rendered by the worker
            status: 'QUEUED',
          },
          select: { id: true },
        }),
      );
      const data: NotificationJobData = {
        logId: log.id,
        clinicId: i.clinicId,
        event: i.event,
        channel: job.channel,
        recipient: job.recipient,
        patientId: target.patient.id,
        vars: i.vars,
      };
      await this.notificationsQueue.add(i.event, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
  }

  /** Two delayed reminder jobs (24h / 2h before start) with deterministic job ids. */
  async scheduleAppointmentReminders(a: {
    id: string;
    clinicId: string;
    patientId: string;
    startAt: Date;
  }): Promise<void> {
    const now = Date.now();
    const plans: Array<{ kind: ReminderKind; delay: number }> = [
      { kind: '24h', delay: a.startAt.getTime() - now - 24 * HOUR_MS },
      { kind: '2h', delay: a.startAt.getTime() - now - 2 * HOUR_MS },
    ];
    for (const plan of plans) {
      if (plan.delay <= 0) continue;
      const data: ReminderJobData = { appointmentId: a.id, clinicId: a.clinicId, kind: plan.kind };
      await this.remindersQueue.add('appointment-reminder', data, {
        jobId: reminderJobId(a.id, plan.kind),
        delay: plan.delay,
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
  }

  /** Remove both pending reminder jobs (no-op if already gone/processed). */
  async cancelAppointmentReminders(appointmentId: string): Promise<void> {
    await this.remindersQueue.remove(reminderJobId(appointmentId, '24h')).catch(() => undefined);
    await this.remindersQueue.remove(reminderJobId(appointmentId, '2h')).catch(() => undefined);
  }

  /** Persist an in-app notification and push it over WebSocket to the user. */
  async sendInApp(i: {
    clinicId: string;
    userId: string;
    title: string;
    body: string;
    link?: string;
  }): Promise<void> {
    // Tenant ctx may be absent in workers — establish it explicitly.
    const created = await TenantContext.run({ clinicId: i.clinicId }, () =>
      this.prisma.db.inAppNotification.create({
        data: {
          clinicId: i.clinicId,
          userId: i.userId,
          title: i.title,
          body: i.body,
          link: i.link ?? null,
        },
      }),
    );
    this.events.toUser(i.userId, 'notification.new', {
      notification: {
        id: created.id,
        title: created.title,
        body: created.body,
        link: created.link,
        createdAt: created.createdAt.toISOString(),
      },
    });
  }

  // ------------------------------------------------------------ templates

  async listTemplates(query: PaginationQuery): Promise<PaginatedResult<TemplateResponse>> {
    const [rows, total] = await Promise.all([
      this.prisma.db.notificationTemplate.findMany({
        orderBy: [{ event: 'asc' }, { channel: 'asc' }, { locale: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.db.notificationTemplate.count(),
    ]);
    return paginated(
      rows.map((t) => ({
        id: t.id,
        event: t.event,
        channel: t.channel,
        locale: fromDbLocale(t.locale),
        body: t.body,
        isActive: t.isActive,
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async upsertTemplate(dto: TemplateUpsertInput): Promise<TemplateResponse> {
    const clinicId = TenantContext.requireClinicId();
    const locale = toDbLocale(dto.locale);
    const before = await this.prisma.db.notificationTemplate.findFirst({
      where: { event: dto.event, channel: dto.channel, locale },
    });
    const row = await this.prisma.db.notificationTemplate.upsert({
      where: {
        clinicId_event_channel_locale: {
          clinicId,
          event: dto.event,
          channel: dto.channel,
          locale,
        },
      },
      update: { body: dto.body, isActive: true },
      create: {
        clinicId,
        event: dto.event,
        channel: dto.channel,
        locale,
        body: dto.body,
      },
    });
    // Templates are clinic settings — audited per CONVENTIONS.
    await this.audit.log({
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      entity: 'NotificationTemplate',
      entityId: row.id,
      before: before ?? undefined,
      after: row,
    });
    return {
      id: row.id,
      event: row.event,
      channel: row.channel,
      locale: fromDbLocale(row.locale),
      body: row.body,
      isActive: row.isActive,
    };
  }

  // ------------------------------------------------------------ delivery log

  async listLogs(query: NotificationLogQueryInput): Promise<PaginatedResult<NotificationLogResponse>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.event ? { event: query.event } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.notificationLog.count({ where }),
    ]);
    return paginated(
      rows.map((l) => ({
        id: l.id,
        patientId: l.patientId,
        userId: l.userId,
        event: l.event,
        channel: l.channel,
        recipient: l.recipient,
        body: l.body,
        status: l.status,
        error: l.error,
        attempts: l.attempts,
        sentAt: l.sentAt ? l.sentAt.toISOString() : null,
        createdAt: l.createdAt.toISOString(),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  // ------------------------------------------------------------ test send

  /** Direct (synchronous) channel send for admins to verify configuration. */
  async sendTest(dto: SendTestInput, user: AuthUser): Promise<{ delivered: boolean }> {
    switch (dto.channel) {
      case 'SMS': {
        const phone = normalizePhone(dto.recipient);
        if (!phone) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid phone number', 400);
        }
        await this.sms.send(phone, dto.body);
        break;
      }
      case 'TELEGRAM':
        await this.telegram.send(dto.recipient, dto.body);
        break;
      case 'IN_APP':
        await this.sendInApp({
          clinicId: TenantContext.requireClinicId(),
          userId: dto.recipient || user.id,
          title: 'Test notification',
          body: dto.body,
        });
        break;
    }
    return { delivered: true };
  }

  // ------------------------------------------------------------ in-app inbox

  async getInbox(userId: string, query: PaginationQuery): Promise<InboxResponse> {
    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.db.inAppNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.db.inAppNotification.count({ where: { userId } }),
      this.prisma.db.inAppNotification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async markRead(userId: string, id: string): Promise<InboxItemResponse> {
    const existing = await this.prisma.db.inAppNotification.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Notification not found', 404);
    }
    const updated = existing.readAt
      ? existing
      : await this.prisma.db.inAppNotification.update({
          where: { id },
          data: { readAt: new Date() },
        });
    return {
      id: updated.id,
      title: updated.title,
      body: updated.body,
      link: updated.link,
      readAt: updated.readAt ? updated.readAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.db.inAppNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}
