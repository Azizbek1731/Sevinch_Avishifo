import { describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import { NotificationEvent } from '@avishifo/shared';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { EventsService } from '../../core/realtime/events.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { SmsChannel } from './channels/sms.channel';
import type { TelegramChannel } from './channels/telegram.channel';
import type { TelegramPatientAccessService } from './telegram-patient-access.service';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService, type NotificationJobData } from './notifications.service';

function harness(recipient: string | null = '1234') {
  const patient = { id: 'patient-1', phone: '+998901234567' };
  const update = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockResolvedValue({ id: 'log-1' });
  const findTemplate = vi.fn().mockResolvedValue({ body: 'Results for {{patient_name}}' });
  const prisma = {
    db: {
      patient: { findUnique: vi.fn().mockResolvedValue(patient) },
      notificationLog: { update, create },
      notificationTemplate: { findFirst: findTemplate },
    },
    unscoped: { clinic: { findUnique: vi.fn().mockResolvedValue({ defaultLocale: 'uz' }) } },
  } as unknown as PrismaService;
  const add = vi.fn().mockResolvedValue({});
  const queue = { add } as unknown as Queue;
  const send = vi.fn().mockResolvedValue(undefined);
  const sendSms = vi.fn().mockResolvedValue(undefined);
  const telegram = { send } as unknown as TelegramChannel;
  const sms = { send: sendSms } as unknown as SmsChannel;
  const recipientFor = vi.fn().mockResolvedValue(recipient);
  const patientAccess = { recipientFor } as unknown as TelegramPatientAccessService;
  const service = new NotificationsService(
    queue,
    queue,
    prisma,
    {} as EventsService,
    {} as AuditService,
    sms,
    telegram,
    patientAccess,
  );
  const processor = new NotificationsProcessor(prisma, sms, telegram, patientAccess);
  const data: NotificationJobData = {
    logId: 'log-1',
    clinicId: 'clinic-1',
    patientId: 'patient-1',
    channel: 'TELEGRAM',
    recipient: '1234',
    event: NotificationEvent.LAB_RESULT_READY,
    vars: { patient_name: 'Test patient' },
  };
  const job = (overrides: Partial<NotificationJobData> = {}, attemptsMade = 0) =>
    ({ data: { ...data, ...overrides }, attemptsMade }) as Job<NotificationJobData>;
  return {
    service,
    processor,
    recipientFor,
    add,
    create,
    update,
    send,
    sendSms,
    findTemplate,
    job,
    data,
  };
}

describe('Patient Telegram notification recipient guard', () => {
  it('enqueues only the currently verified patient recipient', async () => {
    const h = harness('5678');
    await h.service.enqueueEvent(h.data);
    expect(h.recipientFor).toHaveBeenCalledWith('patient-1', 'clinic-1');
    expect(h.add).toHaveBeenCalledWith(
      NotificationEvent.LAB_RESULT_READY,
      expect.objectContaining({ channel: 'TELEGRAM', recipient: '5678', patientId: 'patient-1' }),
      expect.any(Object),
    );
    expect(h.send).not.toHaveBeenCalled();
  });

  it('never queues an old Telegram link when current access is unavailable', async () => {
    const h = harness(null);
    await h.service.enqueueEvent(h.data);
    expect(h.add).toHaveBeenCalledWith(
      NotificationEvent.LAB_RESULT_READY,
      expect.objectContaining({ channel: 'SMS', recipient: '+998901234567' }),
      expect.any(Object),
    );
  });

  it.each([null, '5678'])(
    'cancels queued messages after unlinking or rebinding (%s)',
    async (recipient) => {
      const h = harness(recipient);
      await h.processor.process(h.job());
      expect(h.send).not.toHaveBeenCalled();
      expect(h.sendSms).not.toHaveBeenCalled();
      expect(h.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'FAILED', sentAt: null, attempts: 1 }),
      });
      expect(h.findTemplate).not.toHaveBeenCalled();
    },
  );

  it('fails closed for legacy or manually queued patient jobs lacking a patient id', async () => {
    const h = harness();
    await h.processor.process(h.job({ patientId: undefined }));
    expect(h.send).not.toHaveBeenCalled();
    expect(h.recipientFor).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('delivers to an unchanged verified chat and records success', async () => {
    const h = harness();
    await h.processor.process(h.job());
    expect(h.recipientFor).toHaveBeenCalledWith('patient-1', 'clinic-1');
    expect(h.send).toHaveBeenCalledWith('1234', 'Results for Test patient', undefined);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT', body: 'Results for Test patient' }),
      }),
    );
  });

  it('checks ownership again on a retry following a delivery error', async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(h.processor.process(h.job())).rejects.toThrow('Provider unavailable');
    h.recipientFor.mockResolvedValue(null);
    await expect(h.processor.process(h.job({}, 1))).resolves.toBeUndefined();
    expect(h.recipientFor).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', attempts: 2, sentAt: null }),
      }),
    );
  });

  it('does not deliver if the current ownership check fails', async () => {
    const h = harness();
    h.recipientFor.mockRejectedValue(new Error('Database unavailable'));
    await expect(h.processor.process(h.job())).rejects.toThrow('Database unavailable');
    expect(h.send).not.toHaveBeenCalled();
  });
});
