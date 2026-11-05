import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfigService, REPO_ROOT } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { XlsxService } from '../reports/xlsx.service';
import { allStatsionarReportChatIds } from './telegram-ops';
import { buildActiveStatsionarXlsx } from './statsionar-xlsx.helper';
import {
  formatStatsionarStamp,
  msUntilNextStatsionarReport,
  statsionarReportSlot,
} from './statsionar-daily-schedule';

const STATE_FILE = join(REPO_ROOT, 'run', 'statsionar-daily-state.json');

type DailyState = {
  slot?: string;
  sentAt?: string;
  recipients?: string[];
  count?: number;
};

/**
 * Every day at 16:30 Asia/Tashkent posts the full ACTIVE statsionar roster
 * (Excel) to every configured admin and accountant Telegram chat. Missed slots
 * are sent once on the next API boot (same pattern as the 02:00 backup).
 */
@Injectable()
export class StatsionarDailyTelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatsionarDailyTelegramService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly xlsx: XlsxService,
  ) {}

  onModuleInit(): void {
    const { TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN } = this.config.env;
    if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN) return;
    if (!this.config.env.SINGLE_CLINIC_MODE) return;
    void this.loop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * On-demand export for accountant / admin.
   * Pass `asOfDate` (YYYY-MM-DD) for a historical day roster; omit for current ACTIVE.
   */
  async buildReportNow(
    asOfDate?: string,
  ): Promise<{ buffer: Buffer; count: number; filename: string; asOfDate?: string } | null> {
    const clinicId = await this.resolveClinicId();
    if (!clinicId) {
      this.logger.warn('Statsionar Excel: clinic could not be resolved');
      return null;
    }
    return TenantContext.run({ clinicId }, async () => {
      const { buffer, count } = await buildActiveStatsionarXlsx(
        this.prisma.db as never,
        this.xlsx,
        asOfDate,
      );
      const stamp = asOfDate?.replace(/-/g, '') ?? formatStatsionarStamp();
      return {
        buffer,
        count,
        asOfDate,
        filename: asOfDate ? `statsionar-${asOfDate}.xlsx` : `statsionar-${stamp}.xlsx`,
      };
    });
  }

  async sendDocument(
    chatId: string | number,
    buffer: Buffer,
    filename: string,
    caption?: string,
  ): Promise<boolean> {
    const token = this.config.env.TELEGRAM_BOT_TOKEN;
    if (!token) return false;
    try {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append(
        'document',
        new File([new Uint8Array(buffer)], filename, {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      if (caption) form.append('caption', caption);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`sendDocument ${chatId} failed: HTTP ${res.status} ${body.slice(0, 160)}`);
        return false;
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`sendDocument ${chatId} failed: ${detail}`);
      return false;
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.sendIfDue();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Statsionar daily report failed: ${detail}`);
      }
      const wait = msUntilNextStatsionarReport();
      await this.sleep(wait);
    }
  }

  private async sendIfDue(): Promise<void> {
    const slot = statsionarReportSlot();
    const state = this.readState();
    if (state.slot === slot) return;

    const recipients = allStatsionarReportChatIds();
    if (recipients.length === 0) {
      this.logger.warn('Statsionar daily report skipped: no admin/accountant chat ids');
      return;
    }

    const report = await this.buildReportNow();
    if (!report) return;

    const caption =
      `📊 Statsionar bemorlar (${slot})\n` +
      `Jami: ${report.count} ta\n` +
      `Avtomatik hisobot — 16:30 (Toshkent)`;

    const delivered: string[] = [];
    for (const chatId of recipients) {
      const ok = await this.sendDocument(chatId, report.buffer, report.filename, caption);
      if (ok) delivered.push(chatId);
    }

    this.writeState({
      slot,
      sentAt: new Date().toISOString(),
      recipients: delivered,
      count: report.count,
    });
    this.logger.log(
      `Statsionar daily Excel slot ${slot}: ${report.count} rows → ${delivered.length}/${recipients.length} chats`,
    );
  }

  private async resolveClinicId(): Promise<string | null> {
    const configured = this.config.env.TELEGRAM_CLINIC_ID;
    if (configured) return configured;
    const clinics = await this.prisma.unscoped.clinic.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
      take: 2,
    });
    return clinics.length === 1 ? clinics[0]!.id : null;
  }

  private readState(): DailyState {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as DailyState;
    } catch {
      return {};
    }
  }

  private writeState(state: DailyState): void {
    try {
      mkdirSync(dirname(STATE_FILE), { recursive: true });
      writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not persist statsionar daily state: ${detail}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timer = setTimeout(resolve, ms);
    });
  }
}
