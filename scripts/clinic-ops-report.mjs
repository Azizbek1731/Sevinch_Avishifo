/**
 * CLI for Nest admin Holat/Tarmoq/Zaxira (CJS cannot import this tree via require).
 * Usage: node scripts/clinic-ops-report.mjs holat|tarmoq|zaxira
 * Prints one JSON object to stdout.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildClinicStatus, formatClinicStatus, formatNetworkStatus } from './clinic-status.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kind = String(process.argv[2] || 'holat').toLowerCase();
const backupDir = process.env.CLINIC_BACKUP_DIR || join(root, 'backups');
const useBackup = existsSync(backupDir) ? backupDir : null;

// Holat stays light (no PowerShell). Tarmoq needs net probes.
const spawnSyncImpl = kind === 'tarmoq' ? spawnSync : null;

try {
  const report = await buildClinicStatus({ backupDir: useBackup, spawnSyncImpl });
  if (kind === 'tarmoq') {
    process.stdout.write(JSON.stringify({ ok: true, text: formatNetworkStatus(report) }));
  } else if (kind === 'zaxira') {
    const dumpPath = report.dump?.path ?? null;
    if (!dumpPath || !existsSync(dumpPath)) {
      process.stdout.write(
        JSON.stringify({ ok: true, text: 'Diskda zaxira fayli topilmadi.', dumpPath: null, caption: null }),
      );
    } else {
      const fileName = report.dump?.name ?? 'backup.dump';
      const slot = report.state?.slot || 'noma’lum';
      const takenAt = report.state?.dumpedAt || new Date(report.dump.mtime).toISOString();
      process.stdout.write(
        JSON.stringify({
          ok: true,
          text: `Zaxira yuborilmoqda: ${fileName}`,
          dumpPath,
          caption: `Zaxira · ${slot} · ${takenAt}`,
        }),
      );
    }
  } else {
    process.stdout.write(JSON.stringify({ ok: true, text: formatClinicStatus(report) }));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
}
