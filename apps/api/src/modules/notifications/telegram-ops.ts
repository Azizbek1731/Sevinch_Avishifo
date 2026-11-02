import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizePhone } from '@avishifo/shared';
import { REPO_ROOT } from '../../core/config/app-config.service';

const OPS_FILE = join(REPO_ROOT, 'run', 'telegram-ops-admins.json');

export type OpsMenuMode = 'admin' | 'patient';

export type TelegramOpsRegistry = {
  chatIds: string[];
  phones: Record<string, string>;
  /** Preferred menu when the chat is both admin and patient. Default: admin. */
  modes: Record<string, OpsMenuMode>;
  updatedAt: string;
};

/** In-memory fallback when the service account cannot write run/*.json (EPERM). */
let memoryRegistry: TelegramOpsRegistry | null = null;

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Admin chat ids from .env (numeric Telegram user ids). */
export function configuredAdminChatIds(): string[] {
  return parseList(process.env.TELEGRAM_ADMIN_CHAT_ID);
}

/** Admin phones from .env — normalized to +998… */
export function configuredAdminPhones(): string[] {
  const out: string[] = [];
  for (const part of parseList(process.env.TELEGRAM_ADMIN_PHONES)) {
    const normalized = normalizePhone(part.startsWith('+') ? part : `+${part}`)
      ?? normalizePhone(part.length === 9 ? `+998${part}` : part);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function isConfiguredAdminPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return configuredAdminPhones().includes(normalized);
}

function emptyRegistry(): TelegramOpsRegistry {
  return { chatIds: [], phones: {}, modes: {}, updatedAt: new Date(0).toISOString() };
}

function readRegistry(): TelegramOpsRegistry {
  if (memoryRegistry) {
    return {
      chatIds: [...memoryRegistry.chatIds],
      phones: { ...memoryRegistry.phones },
      modes: { ...memoryRegistry.modes },
      updatedAt: memoryRegistry.updatedAt,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(OPS_FILE, 'utf8')) as TelegramOpsRegistry;
    return {
      chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map(String) : [],
      phones: raw.phones && typeof raw.phones === 'object' ? raw.phones : {},
      modes: raw.modes && typeof raw.modes === 'object' ? raw.modes : {},
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(registry: TelegramOpsRegistry): void {
  memoryRegistry = {
    chatIds: [...registry.chatIds],
    phones: { ...registry.phones },
    modes: { ...registry.modes },
    updatedAt: registry.updatedAt,
  };
  try {
    mkdirSync(dirname(OPS_FILE), { recursive: true });
    writeFileSync(OPS_FILE, `${JSON.stringify(registry, null, 2)}\n`);
  } catch {
    // Holat/Tarmoq/Zaxira must not depend on disk writes for the service account.
  }
}

/** Every chat that should receive server up/down + may use Holat/Tarmoq/Zaxira. */
export function allOpsAdminChatIds(): string[] {
  const ids = new Set([...configuredAdminChatIds(), ...readRegistry().chatIds]);
  return [...ids];
}

export function isOpsAdminChat(chatId: number | string): boolean {
  return allOpsAdminChatIds().includes(String(chatId));
}

/** Remember this chat after an admin phone was verified. Defaults to admin menu. */
export function rememberOpsAdminChat(chatId: number | string, phone: string): void {
  const id = String(chatId);
  const normalized = normalizePhone(phone) ?? phone;
  const registry = readRegistry();
  if (!registry.chatIds.includes(id)) registry.chatIds.push(id);
  registry.phones[normalized] = id;
  if (!registry.modes[id]) registry.modes[id] = 'admin';
  registry.updatedAt = new Date().toISOString();
  writeRegistry(registry);
}

/** Admin chats default to the admin menu (never mixed with patient buttons). */
export function opsMenuMode(chatId: number | string): OpsMenuMode {
  if (!isOpsAdminChat(chatId)) return 'patient';
  const mode = readRegistry().modes[String(chatId)];
  return mode === 'patient' ? 'patient' : 'admin';
}

export function setOpsMenuMode(chatId: number | string, mode: OpsMenuMode): void {
  const id = String(chatId);
  if (!isOpsAdminChat(id)) return;
  const registry = readRegistry();
  if (!registry.chatIds.includes(id)) registry.chatIds.push(id);
  registry.modes[id] = mode;
  registry.updatedAt = new Date().toISOString();
  writeRegistry(registry);
}

export function forgetOpsAdminChat(chatId: number | string): void {
  const id = String(chatId);
  const registry = readRegistry();
  registry.chatIds = registry.chatIds.filter((item) => item !== id);
  for (const [phone, bound] of Object.entries(registry.phones)) {
    if (bound === id) delete registry.phones[phone];
  }
  delete registry.modes[id];
  registry.updatedAt = new Date().toISOString();
  writeRegistry(registry);
}

function backupDir(): string | null {
  const dir = process.env.CLINIC_BACKUP_DIR || join(REPO_ROOT, 'backups');
  return existsSync(dir) ? dir : null;
}

function lanIpv4(): string | null {
  const found: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        found.push(entry.address);
      }
    }
  }
  return (
    found.find((address) => address.startsWith('192.168.') || address.startsWith('10.')) ||
    found[0] ||
    null
  );
}

async function probe(url: string, timeoutMs = 4000): Promise<{ ok: boolean; status: number; ms: number }> {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok, status: response.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started };
  }
}

function formatTashkent(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(date)
    .replace(',', '');
}

function latestDump(dir: string | null): {
  name: string;
  path: string;
  mtime: number;
  size: number;
} | null {
  if (!dir) return null;
  const files = readdirSync(dir)
    .filter((name) => /^avishifo-\d{8}-\d{4}\.dump$/.test(name))
    .map((name) => {
      const path = join(dir, name);
      const st = statSync(path);
      return { name, path, mtime: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ?? null;
}

function readBackupState(dir: string | null): { slot?: string; telegram?: unknown; dumpedAt?: string } | null {
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(join(dir, 'backup-state.json'), 'utf8')) as {
      slot?: string;
      telegram?: unknown;
      dumpedAt?: string;
    };
  } catch {
    return null;
  }
}

function logOps(kind: string, detail: string): void {
  try {
    mkdirSync(join(REPO_ROOT, 'run'), { recursive: true });
    writeFileSync(
      join(REPO_ROOT, 'run', 'telegram-ops-error.log'),
      `${new Date().toISOString()} ${kind}: ${detail}\n`,
      { flag: 'a' },
    );
  } catch {
    // ignore
  }
}

/** Built inside Nest — no child process / .mjs import (those fail under the API CJS runtime). */
export async function buildOpsStatusText(kind: 'holat' | 'tarmoq'): Promise<string> {
  const dir = backupDir();
  const ip = lanIpv4();
  // Probe the API port directly — going through :80 gateway can stall on this host.
  const apiPort = process.env.API_PORT || '13001';
  const [healthLocal, healthLan] = await Promise.all([
    probe(`http://127.0.0.1:${apiPort}/api/v1/health`),
    ip
      ? probe(`http://${ip}/api/v1/health`, 2500)
      : Promise.resolve({ ok: false, status: 0, ms: 0 }),
  ]);
  const dump = latestDump(dir);
  const state = readBackupState(dir);
  const mark = (ok: boolean) => (ok ? 'OK' : "YO'Q");
  const now = formatTashkent(new Date());

  if (kind === 'tarmoq') {
    const lines = [
      'Avishifo — tarmoq holati',
      `Tekshiruv: ${now}`,
      `Server IP: ${ip || "yo'q"}`,
      `LAN orqali API: ${healthLan.ok ? 'ishlayapti' : 'ishlamayapti'} (${healthLan.ms} ms)`,
      '',
      "Boshqa kompyuterlar shu tarmoqda bo'lsa ochadi:",
    ];
    if (ip) lines.push(`• http://${ip}/`);
    lines.push('• http://sevinch/');
    lines.push('• http://sevinch.local/');
    lines.push('');
    lines.push("Agar faqat shu server ochilsa, boshqalar esa yo'q:");
    lines.push('1) Brauzerda http (https emas) yozing');
    lines.push("2) Mehmon Wi-Fi emas, klinika tarmog'ida ekanini tekshiring");
    lines.push("3) To'g'ridan-to'g'ri IP bilan urinib ko'ring");
    return lines.join('\n');
  }

  const lines = [
    'Avishifo — klinika holati',
    `Tekshiruv: ${now}`,
    `API (shu kompyuter): ${mark(healthLocal.ok)} ${healthLocal.status || ''} (${healthLocal.ms} ms)`,
  ];
  if (ip) {
    lines.push(
      `API (LAN ${ip}): ${mark(healthLan.ok)} ${healthLan.status || ''} (${healthLan.ms} ms)`,
    );
  } else {
    lines.push('LAN IP topilmadi');
  }
  if (dump) {
    const mb = (dump.size / (1024 * 1024)).toFixed(2);
    lines.push(`Oxirgi zaxira: ${dump.name} (${mb} MB)`);
  } else {
    lines.push('Oxirgi zaxira: topilmadi');
  }
  if (state?.slot) {
    const sent =
      state.telegram === true
        ? 'Telegramga yuborilgan'
        : state.telegram === 'unconfigured'
          ? 'Telegram sozlanmagan'
          : 'Telegramga hali yuborilmagan';
    lines.push(`Zaxira slot: ${state.slot} — ${sent}`);
  }
  lines.push('');
  lines.push('Kirish manzillari:');
  if (ip) lines.push(`http://${ip}/`);
  lines.push('http://sevinch/');
  lines.push('http://sevinch.local/');
  return lines.join('\n');
}

export async function buildOpsBackupInfo(): Promise<{
  text: string;
  dumpPath: string | null;
  caption: string | null;
}> {
  const dir = backupDir();
  const dump = latestDump(dir);
  const state = readBackupState(dir);
  if (!dump) {
    logOps('zaxira', `no dump in ${dir ?? 'null'}`);
    return { text: 'Diskda zaxira fayli topilmadi.', dumpPath: null, caption: null };
  }
  const slot = state?.slot || "noma'lum";
  const takenAt = state?.dumpedAt || new Date(dump.mtime).toISOString();
  return {
    text: `Zaxira yuborilmoqda: ${dump.name}`,
    dumpPath: dump.path,
    caption: `Zaxira · ${slot} · ${takenAt}`,
  };
}
