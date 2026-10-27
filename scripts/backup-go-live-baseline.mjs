/**
 * One-shot: dump the current DB as the go-live baseline and post it to the
 * clinic Telegram backup chat.
 *
 *   node scripts/backup-go-live-baseline.mjs
 */
import { config as loadEnv } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupCaption, sendTelegramDocument, splitBackupFile } from './backup-telegram.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: join(root, '.env') });

const PG_DUMP = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
const BACKUP_DIR = process.env.CLINIC_BACKUP_DIR || join('D:\\Avishifo\\runtime', 'backups');

function parseDatabaseUrl(url) {
  const match = String(url || '').match(/^postgresql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!match) throw new Error('DATABASE_URL is missing or invalid');
  return { user: match[1], password: decodeURIComponent(match[2]), host: match[3], port: match[4], database: match[5] };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  if (!existsSync(PG_DUMP)) throw new Error(`pg_dump not found: ${PG_DUMP}`);
  const db = parseDatabaseUrl(process.env.DATABASE_URL);
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.CLINIC_BACKUP_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and CLINIC_BACKUP_TELEGRAM_CHAT_ID are required');
  }

  const fileName = `avishifo-go-live-baseline-${stamp()}.dump`;
  const filePath = join(BACKUP_DIR, fileName);
  const env = { ...process.env, PGPASSWORD: db.password };
  const dump = spawnSync(
    PG_DUMP,
    ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database, '-Fc', '-f', filePath],
    { env, encoding: 'utf8' },
  );
  if (dump.status !== 0) {
    throw new Error(dump.stderr || dump.stdout || `pg_dump exit ${dump.status}`);
  }
  const size = statSync(filePath).size;
  console.log(`Dump saved: ${filePath} (${size} bytes)`);

  const takenAt = new Date();
  const slot = takenAt.toISOString().slice(0, 10);
  const pieces = await splitBackupFile(filePath);
  for (let i = 0; i < pieces.length; i += 1) {
    await sendTelegramDocument({
      token,
      chatId,
      filePath: pieces[i],
      caption: [
        backupCaption({
          slot,
          takenAt,
          fileName: pieces.length > 1 ? `${fileName} (qism ${i + 1}/${pieces.length})` : fileName,
          part: i + 1,
          parts: pieces.length,
        }),
        '',
        'Ishga tayyor 0-holat (baseline):',
        'katalog + xodimlar + palatalar saqlangan;',
        'bemorlar / hisoblar / to‘lovlar yo‘q.',
      ].join('\n'),
    });
  }
  console.log(`Sent to Telegram chat ${chatId}: ${pieces.length} file(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
