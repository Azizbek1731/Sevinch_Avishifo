import { openAsBlob, statSync, writeFileSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { BACKUP_HOUR, formatTashkent } from './backup-schedule.mjs';

/** Stay under Telegram's 50 MB bot upload limit. */
export const TELEGRAM_DOCUMENT_LIMIT = 45 * 1024 * 1024;

export function backupCaption({ slot, takenAt, fileName, part = 1, parts = 1 }) {
  const [year, month, day] = slot.split('-');
  const hour = String(BACKUP_HOUR).padStart(2, '0');
  const lines = [
    'Avishifo kunlik zaxira',
    `Reja: ${day}.${month}.${year}, soat ${hour}:00 (Toshkent)`,
    `Olingan: ${formatTashkent(takenAt)} (Toshkent)`,
    `Fayl: ${fileName}`,
  ];
  if (parts > 1) {
    lines.push(`Qism ${part}/${parts}. Tiklashdan oldin qismlarni tartib bilan birlashtiring.`);
  }
  return lines.join('\n');
}

/** One path when the dump fits, otherwise sibling `.01`, `.02`, … pieces. */
export async function splitBackupFile(filePath, limit = TELEGRAM_DOCUMENT_LIMIT) {
  const size = statSync(filePath).size;
  if (size <= limit) return [filePath];
  const pieceCount = Math.ceil(size / limit);
  const handle = await openFile(filePath, 'r');
  const paths = [];
  try {
    for (let index = 0; index < pieceCount; index += 1) {
      const length = Math.min(limit, size - index * limit);
      const piecePath = `${filePath}.${String(index + 1).padStart(2, '0')}`;
      paths.push(piecePath);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, index * limit);
      writeFileSync(piecePath, buffer);
    }
  } finally {
    await handle.close();
  }
  return paths;
}

function safeError(token, error) {
  const message = error instanceof Error ? error.message : String(error);
  return token ? message.split(token).join('***') : message;
}

export async function sendTelegramDocument({
  token,
  chatId,
  filePath,
  caption,
  fetchImpl = fetch,
}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('document', await openAsBlob(filePath), basename(filePath));
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (error) {
    throw new Error(`Telegram bilan aloqa yo'q: ${safeError(token, error)}`);
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    const description =
      json && typeof json.description === 'string' ? json.description : `HTTP ${response.status}`;
    throw new Error(`Telegram zaxirani qabul qilmadi: ${description}`);
  }
}
