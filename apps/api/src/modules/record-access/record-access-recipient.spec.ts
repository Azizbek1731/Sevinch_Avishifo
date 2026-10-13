import { describe, expect, it, vi } from 'vitest';
import { RecordAccessStatus, type AuthUser } from '@avishifo/shared';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { TelegramChannel } from '../notifications/channels/telegram.channel';
import type { TelegramPatientAccessService } from '../notifications/telegram-patient-access.service';
import { RecordAccessService } from './record-access.service';

describe('Record access decision Telegram recipient', () => {
  it.each([null, '5678'])(
    'resolves current ownership before notifying a patient (%s)',
    async (recipient) => {
      const patient = { id: 'patient-1', fullName: 'Test patient', phone: '+998901234567' };
      const prisma = {
        db: {
          medicalRecordAccess: {
            findUnique: vi
              .fn()
              .mockResolvedValue({
                id: 'request-1',
                clinicId: 'clinic-1',
                patient,
                status: 'PENDING',
              }),
            update: vi.fn().mockResolvedValue({
              id: 'request-1',
              status: 'APPROVED',
              patient,
              requestedAt: new Date(),
              decidedAt: new Date(),
              patientNote: null,
              decisionNote: null,
            }),
          },
        },
      } as unknown as PrismaService;
      const send = vi.fn().mockResolvedValue(undefined);
      const recipientFor = vi.fn().mockResolvedValue(recipient);
      const service = new RecordAccessService(
        prisma,
        { log: vi.fn() } as unknown as AuditService,
        {} as NotificationsService,
        { send } as unknown as TelegramChannel,
        { recipientFor } as unknown as TelegramPatientAccessService,
      );
      await service.decide('request-1', { status: RecordAccessStatus.APPROVED }, {
        id: 'doctor-1',
        fullName: 'Test doctor',
      } as AuthUser);
      expect(recipientFor).toHaveBeenCalledWith('patient-1', 'clinic-1');
      if (recipient) expect(send).toHaveBeenCalledWith(recipient, expect.any(String));
      else expect(send).not.toHaveBeenCalled();
    },
  );
});
