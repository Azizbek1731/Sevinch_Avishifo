import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../core/config/app-config.service';

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/**
 * Telegram delivery channel — plain Bot API `sendMessage` calls (independent of
 * the long-polling bot in telegram-bot.service.ts). Recipient is the chat id
 * stored on TelegramLink.
 */
@Injectable()
export class TelegramChannel {
  constructor(private readonly config: AppConfigService) {}

  /**
   * `parseMode` is opt-in: templated bodies interpolate patient data, and a name
   * containing `<` would make Telegram reject the whole message. Only pass it
   * for text this codebase builds and escapes itself.
   */
  async send(
    chatId: string,
    text: string,
    replyMarkup?: TelegramInlineKeyboard,
    parseMode?: 'HTML',
  ): Promise<void> {
    const { TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN } = this.config.env;
    if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN) {
      throw new Error('Telegram bot is not enabled (TELEGRAM_ENABLED / TELEGRAM_BOT_TOKEN)');
    }
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as unknown;
      const description =
        typeof json === 'object' && json !== null
          ? (json as { description?: unknown }).description
          : undefined;
      throw new Error(
        `Telegram send failed: HTTP ${res.status}${typeof description === 'string' ? ` (${description})` : ''}`,
      );
    }
  }
}
