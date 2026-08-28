import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TelegramChannel } from './channels/telegram.channel';

export interface NewClinicAlert {
  clinicName: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail?: string | null;
  planName?: string | null;
  trialEndsAt?: Date | null;
}

/** Telegram treats these as markup even inside plain text runs. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Tells the people who run AviShifo — not a clinic — that something happened
 * on the platform.
 *
 * Recipients are resolved from the database rather than an env var: whoever is
 * a SUPER_ADMIN and has linked the bot gets the message, so adding a second
 * administrator needs no deploy, and a chat id never has to live in config.
 */
@Injectable()
export class PlatformAlertsService {
  private readonly logger = new Logger(PlatformAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
  ) {}

  /**
   * Never rejects. A signup must not fail because Telegram is down, and the
   * caller is on the critical path of someone creating their account.
   */
  async newClinicRegistered(alert: NewClinicAlert): Promise<void> {
    try {
      // Unscoped: platform admins sit outside every clinic (clinicId is null),
      // so the tenant filter would return nobody (justified).
      const admins = await this.prisma.unscoped.user.findMany({
        where: {
          role: UserRole.SUPER_ADMIN,
          deletedAt: null,
          status: 'ACTIVE',
          telegramChatId: { not: null },
        },
        select: { id: true, telegramChatId: true },
      });
      if (admins.length === 0) return;

      const lines = [
        '🏥 <b>Yangi klinika ro‘yxatdan o‘tdi</b>',
        '',
        `<b>Klinika:</b> ${escapeHtml(alert.clinicName)}`,
        `<b>Direktor:</b> ${escapeHtml(alert.ownerName)}`,
        `<b>Telefon:</b> ${escapeHtml(alert.ownerPhone)}`,
      ];
      if (alert.ownerEmail) lines.push(`<b>Email:</b> ${escapeHtml(alert.ownerEmail)}`);
      if (alert.planName) lines.push(`<b>Tarif:</b> ${escapeHtml(alert.planName)}`);
      if (alert.trialEndsAt) {
        lines.push(
          `<b>Sinov muddati:</b> ${alert.trialEndsAt.toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' })} gacha`,
        );
      }
      const text = lines.join('\n');

      const results = await Promise.allSettled(
        admins.map((a) => this.telegram.send(a.telegramChatId as string, text, undefined, 'HTML')),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        this.logger.warn(`New-clinic alert: ${failed}/${admins.length} admin(s) not reached`);
      }
    } catch (err) {
      this.logger.error(`New-clinic alert failed: ${String(err)}`);
    }
  }
}
