import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { Bot, Context } from 'grammy';
import { TelegramBotService } from './telegram-bot.service';
import type { AppConfigService } from '../../core/config/app-config.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { StorageService } from '../../core/storage/storage.service';
import type { NotificationsService } from './notifications.service';
import type { TelegramPatientAccessService } from './telegram-patient-access.service';
import type { ResultPdfService } from '../lab/result-pdf.service';
import type { VisitReportPdfService } from '../visits/visit-report-pdf.service';

interface Handlers {
  registerHandlers(bot: Bot): void;
  handleDocumentFile(ctx: Context, id: string): Promise<void>;
  handleVisitReportPdf(ctx: Context, id: string): Promise<void>;
  handleResultPdf(ctx: Context, id: string): Promise<void>;
  handleLinkToken(ctx: Context, token: string): Promise<void>;
}

function harness() {
  const patientIds = vi.fn().mockResolvedValue(['owned-patient']);
  const documentFind = vi.fn().mockResolvedValue(null);
  const visitFind = vi.fn().mockResolvedValue(null);
  const labFind = vi.fn().mockResolvedValue(null);
  const tokenFind = vi.fn().mockResolvedValue({ id: 'token', phone: '+998901234567', expiresAt: new Date(Date.now() + 60000) });
  const tokenClaim = vi.fn().mockResolvedValue({ count: 0 });
  const prisma = { unscoped: {
    patientDocument: { findFirst: documentFind }, visit: { findFirst: visitFind },
    labOrder: { findFirst: labFind }, portalLinkToken: { findFirst: tokenFind, updateMany: tokenClaim },
  } } as unknown as PrismaService;
  const getStream = vi.fn();
  const service = new TelegramBotService(
    {} as AppConfigService, prisma, { log: vi.fn() } as unknown as AuditService,
    {} as NotificationsService, { getStream } as unknown as StorageService,
    { render: vi.fn() } as unknown as ResultPdfService,
    { patientIds } as unknown as TelegramPatientAccessService,
    { render: vi.fn() } as unknown as VisitReportPdfService,
  ) as unknown as Handlers;
  const reply = vi.fn().mockResolvedValue({});
  const replyWithDocument = vi.fn();
  const ctx = { chat: { id: 1234, type: 'private' }, from: { id: 1234 },
    answerCallbackQuery: vi.fn().mockResolvedValue(true), reply, replyWithDocument } as unknown as Context;
  return { service, ctx, patientIds, documentFind, visitFind, labFind, replyWithDocument, getStream, tokenClaim, reply };
}

describe('Telegram document delivery boundary (all delivery mocked)', () => {
  it('ignores non-private chats before any handler runs', async () => {
    const { service } = harness();
    const use = vi.fn();
    service.registerHandlers({ use, command: vi.fn(), on: vi.fn(), hears: vi.fn(), callbackQuery: vi.fn() } as unknown as Bot);
    const middleware = use.mock.calls[0]![0] as (ctx: Context, next: () => Promise<void>) => Promise<void>;
    const next = vi.fn();
    await middleware({ chat: { id: -1234, type: 'group' }, from: { id: 1234 } } as unknown as Context, next);
    await middleware({ chat: { id: 1234, type: 'private' }, from: { id: 9999 } } as unknown as Context, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('never loads or sends a document for an unlinked sender', async () => {
    const { service, ctx, patientIds, documentFind, getStream, replyWithDocument } = harness();
    patientIds.mockResolvedValue([]);
    await service.handleDocumentFile(ctx, 'guessed-document');
    expect(documentFind).not.toHaveBeenCalled();
    expect(getStream).not.toHaveBeenCalled();
    expect(replyWithDocument).not.toHaveBeenCalled();
  });

  it('rechecks document owner and lab confirmation when a saved button is used', async () => {
    const { service, ctx, documentFind, getStream, replyWithDocument } = harness();
    await service.handleDocumentFile(ctx, 'foreign-or-unapproved-document');
    const where = documentFind.mock.calls[0]![0].where;
    expect(where.AND[0].patientId).toEqual({ in: ['owned-patient'] });
    expect(where.AND[0].OR[1].labOrder.status.in).toEqual(['APPROVED', 'DELIVERED']);
    expect(where.AND[0].OR[1].labResults.some.approvedById).toEqual({ not: null });
    expect(where.AND[1].id).toBe('foreign-or-unapproved-document');
    expect(getStream).not.toHaveBeenCalled();
    expect(replyWithDocument).not.toHaveBeenCalled();
  });

  it('sends the selected owned confirmed file only after an explicit request', async () => {
    const { service, ctx, documentFind, getStream, replyWithDocument } = harness();
    documentFind.mockResolvedValue({ id: 'approved-document', clinicId: 'clinic-a',
      fileKey: 'clinic-a/result.pdf', fileName: 'result.pdf', title: 'Sinov natijasi' });
    getStream.mockReturnValue(Readable.from(Buffer.from('%PDF-test')));
    replyWithDocument.mockResolvedValue({});
    await service.handleDocumentFile(ctx, 'approved-document');
    expect(getStream).toHaveBeenCalledWith('clinic-a/result.pdf');
    expect(replyWithDocument).toHaveBeenCalledTimes(1);
    expect(replyWithDocument.mock.calls[0]![1]).toEqual({ caption: 'Sinov natijasi' });
  });

  it('does not disclose draft or foreign clinical reports', async () => {
    const { service, ctx, visitFind, replyWithDocument } = harness();
    await service.handleVisitReportPdf(ctx, 'draft-or-foreign-visit');
    expect(visitFind.mock.calls[0]![0].where).toMatchObject({
      id: 'draft-or-foreign-visit', patientId: { in: ['owned-patient'] },
      status: 'COMPLETED', completedAt: { not: null },
    });
    expect(replyWithDocument).not.toHaveBeenCalled();
  });

  it('does not disclose unapproved or foreign lab results', async () => {
    const { service, ctx, labFind, replyWithDocument } = harness();
    await service.handleResultPdf(ctx, 'unapproved-order');
    expect(labFind.mock.calls[0]![0].where).toMatchObject({
      id: 'unapproved-order', patientId: { in: ['owned-patient'] }, status: { in: ['APPROVED', 'DELIVERED'] },
    });
    expect(replyWithDocument).not.toHaveBeenCalled();
  });

  it('rejects a deep-link token that another request has already consumed', async () => {
    const { service, ctx, tokenClaim, reply } = harness();
    await service.handleLinkToken(ctx, 'one-time-token');
    expect(tokenClaim.mock.calls[0]![0].where).toMatchObject({ id: 'token', usedAt: null });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('ishlatilgan'));
  });
});
