import { spawnSync } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { backupCaption, sendTelegramDocument } from './backup-telegram.mjs';
import {
  buildClinicStatus,
  formatClinicStatus,
  formatNetworkStatus,
} from './clinic-status.mjs';

try {
  setDefaultResultOrder('ipv4first');
} catch {
  // ignore
}

const API = 'https://api.telegram.org';

function safeError(token, error) {
  const message = error instanceof Error ? error.message : String(error);
  return token ? message.split(token).join('***') : message;
}

export function adminKeyboard() {
  return {
    keyboard: [[{ text: 'Holat' }, { text: 'Tarmoq' }], [{ text: 'Zaxira' }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function serverStartedMessage({ when, ip, unexpected = false }) {
  const lines = unexpected
    ? [
        'Avishifo server kutilmaganda o‘chgan edi.',
        `Hozir qayta yoqildi: ${when}`,
      ]
    : ['Avishifo server yoqildi.', `Vaqt: ${when}`];
  if (ip && ip !== '127.0.0.1') lines.push(`IP: ${ip}`);
  lines.push('http://sevinch/');
  if (ip && ip !== '127.0.0.1') lines.push(`http://${ip}/`);
  return lines.join('\n');
}

export function serverStoppedMessage({ when }) {
  return ['Avishifo server o‘chmoqda.', `Vaqt: ${when}`].join('\n');
}

export function normalizeCommand(text) {
  const raw = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/@\w+$/, '');
  if (!raw) return '';
  if (raw === '/start' || raw === 'start') return 'start';
  if (raw === '/holat' || raw === 'holat' || raw === 'status' || raw === '/status') return 'holat';
  if (raw === '/tarmoq' || raw === 'tarmoq' || raw === 'network' || raw === '/network') return 'tarmoq';
  if (raw === '/zaxira' || raw === 'zaxira' || raw === 'backup' || raw === '/backup') return 'zaxira';
  if (raw.includes('holat') || raw.includes('status')) return 'holat';
  if (raw.includes('tarmoq') || raw.includes('wifi') || raw.includes('ulana')) return 'tarmoq';
  if (raw.includes('zaxira') || raw.includes('backup')) return 'zaxira';
  return '';
}

export function isAllowedAdmin(update, adminIds) {
  const ids = new Set(adminIds.map(String));
  const from =
    update.message?.from?.id ??
    update.callback_query?.from?.id ??
    update.edited_message?.from?.id;
  return from != null && ids.has(String(from));
}

async function telegramCall(token, method, body, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw new Error(`Telegram ${method}: ${safeError(token, error)}`);
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    const description =
      json && typeof json.description === 'string' ? json.description : `HTTP ${response.status}`;
    throw new Error(`Telegram ${method}: ${description}`);
  }
  return json.result;
}

export async function sendTelegramText({
  token,
  chatId,
  text,
  replyMarkup,
  fetchImpl = fetch,
}) {
  return telegramCall(
    token,
    'sendMessage',
    {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      disable_web_page_preview: true,
    },
    fetchImpl,
  );
}

export async function setupAdminBot({ token, fetchImpl = fetch }) {
  await telegramCall(
    token,
    'setMyCommands',
    {
      commands: [
        { command: 'holat', description: 'Klinika loyihasi holati' },
        { command: 'tarmoq', description: 'Wi‑Fi / LAN ulanishlari' },
        { command: 'zaxira', description: 'Oxirgi zaxira haqida' },
        { command: 'start', description: 'Menyu' },
      ],
    },
    fetchImpl,
  );
}

export async function handleAdminUpdate(update, context) {
  const {
    token,
    adminIds,
    backupDir,
    latestDumpPath,
    dumpMeta,
    fetchImpl = fetch,
    spawnSyncImpl = spawnSync,
    log = () => {},
  } = context;
  if (!isAllowedAdmin(update, adminIds)) {
    const chatId = update.message?.chat?.id;
    if (chatId && update.message?.text) {
      await sendTelegramText({
        token,
        chatId,
        text: 'Bu bot faqat klinika administratori uchun.',
        fetchImpl,
      }).catch(() => {});
    }
    return;
  }
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const command = normalizeCommand(message.text);
  if (!command) {
    await sendTelegramText({
      token,
      chatId,
      text: 'Buyruqlar: Holat, Tarmoq, Zaxira. Yoki /holat /tarmoq /zaxira',
      replyMarkup: adminKeyboard(),
      fetchImpl,
    });
    return;
  }
  if (command === 'start') {
    await sendTelegramText({
      token,
      chatId,
      text: 'Avishifo admin bot.\nHolat — loyiha ishlayaptimi.\nTarmoq — boshqa kompyuterlar ulana oladimi.\nZaxira — oxirgi dump.',
      replyMarkup: adminKeyboard(),
      fetchImpl,
    });
    return;
  }

  const report = await buildClinicStatus({ backupDir, spawnSyncImpl });
  if (command === 'holat') {
    await sendTelegramText({
      token,
      chatId,
      text: formatClinicStatus(report),
      replyMarkup: adminKeyboard(),
      fetchImpl,
    });
    return;
  }
  if (command === 'tarmoq') {
    await sendTelegramText({
      token,
      chatId,
      text: formatNetworkStatus(report),
      replyMarkup: adminKeyboard(),
      fetchImpl,
    });
    return;
  }
  if (command === 'zaxira') {
    const dumpPath = latestDumpPath?.(report) || report.dump?.path;
    if (!dumpPath || !existsSync(dumpPath)) {
      await sendTelegramText({
        token,
        chatId,
        text: 'Diskda zaxira fayli topilmadi.',
        replyMarkup: adminKeyboard(),
        fetchImpl,
      });
      return;
    }
    const meta = dumpMeta?.(report) || {
      slot: report.state?.slot || 'noma’lum',
      takenAt: report.state?.dumpedAt || new Date(report.dump.mtime).toISOString(),
      fileName: basename(dumpPath),
    };
    await sendTelegramText({
      token,
      chatId,
      text: `Zaxira yuborilmoqda: ${meta.fileName}`,
      replyMarkup: adminKeyboard(),
      fetchImpl,
    });
    try {
      await sendTelegramDocument({
        token,
        chatId,
        filePath: dumpPath,
        caption: backupCaption({
          slot: meta.slot,
          takenAt: new Date(meta.takenAt),
          fileName: meta.fileName,
        }),
        fetchImpl,
      });
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      await sendTelegramText({
        token,
        chatId,
        text: 'Zaxirani yuborib bo‘lmadi. Keyinroq /zaxira qayta bosing.',
        replyMarkup: adminKeyboard(),
        fetchImpl,
      });
    }
  }
}

/**
 * Long-polls Telegram for admin commands. Patient TELEGRAM_ENABLED stays off.
 */
export async function runAdminBot({
  token,
  adminIds,
  backupDir,
  shouldStop = () => false,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
  log = () => {},
  onReady = async () => {},
}) {
  if (!token || !adminIds?.length) {
    log('Admin Telegram bot is not configured.');
    return;
  }
  await setupAdminBot({ token, fetchImpl });
  await onReady();
  let offset = 0;
  while (!shouldStop()) {
    let updates = [];
    try {
      updates = await telegramCall(
        token,
        'getUpdates',
        { offset, timeout: 25, allowed_updates: ['message'] },
        fetchImpl,
      );
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        await handleAdminUpdate(update, {
          token,
          adminIds,
          backupDir,
          fetchImpl,
          spawnSyncImpl,
          log,
        });
      } catch (error) {
        log(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
