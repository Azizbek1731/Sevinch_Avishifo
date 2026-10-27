import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { formatTashkent } from './backup-schedule.mjs';

async function probe(url, timeoutMs = 4000) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok, status: response.status, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function lanIpv4() {
  const found = [];
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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function latestDump(backupDir) {
  if (!backupDir || !existsSync(backupDir)) return null;
  const files = readdirSync(backupDir)
    .filter((name) => /^avishifo-\d{8}-\d{4}\.dump$/.test(name))
    .map((name) => {
      const path = join(backupDir, name);
      return { name, path, mtime: statSync(path).mtimeMs, size: statSync(path).size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ?? null;
}

export function runPowerShell(command, spawnSyncImpl) {
  const result = spawnSyncImpl(
    'powershell',
    ['-NoProfile', '-Command', command],
    { encoding: 'utf8', windowsHide: true },
  );
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

export function summarizeLines(stdout, limit = 12) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function buildClinicStatus({
  backupDir,
  spawnSyncImpl = null,
  now = new Date(),
}) {
  const ip = lanIpv4();
  const healthLocal = await probe('http://127.0.0.1/api/v1/health');
  const healthLan = ip ? await probe(`http://${ip}/api/v1/health`) : { ok: false, status: 0, ms: 0 };
  const dump = latestDump(backupDir);
  const state = backupDir ? readJson(join(backupDir, 'backup-state.json')) : null;

  let ports = null;
  let stuckSyn = [];
  let incompleteNeighbors = [];
  if (spawnSyncImpl) {
    const listen = runPowerShell(
      '@(80,3002,3003) | ForEach-Object { $p=$_; $n=(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count; "$p=$n" }',
      spawnSyncImpl,
    );
    if (listen.ok) {
      ports = Object.fromEntries(
        summarizeLines(listen.stdout, 8).map((line) => {
          const [port, count] = line.split('=');
          return [port, Number(count) > 0];
        }),
      );
    }
    const syn = runPowerShell(
      'Get-NetTCPConnection -State SynReceived -ErrorAction SilentlyContinue | Select-Object -First 8 LocalPort,RemoteAddress | ForEach-Object { "$($_.RemoteAddress):$($_.LocalPort)" }',
      spawnSyncImpl,
    );
    if (syn.ok) stuckSyn = summarizeLines(syn.stdout, 8);
    const neighbors = runPowerShell(
      "Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' -and $_.State -eq 'Incomplete' } | Select-Object -First 12 IPAddress | ForEach-Object { $_.IPAddress }",
      spawnSyncImpl,
    );
    if (neighbors.ok) incompleteNeighbors = summarizeLines(neighbors.stdout, 12);
  } else {
    ports = {
      80: healthLocal.ok || healthLan.ok,
      3002: null,
      3003: null,
    };
  }

  return {
    checkedAt: now.toISOString(),
    ip,
    healthLocal,
    healthLan,
    ports,
    dump,
    state,
    stuckSyn,
    incompleteNeighbors,
  };
}

export function formatClinicStatus(report) {
  const lines = [
    'Avishifo — klinika holati',
    `Tekshiruv: ${formatTashkent(new Date(report.checkedAt))}`,
  ];
  const mark = (ok) => (ok ? 'OK' : 'YO‘Q');
  lines.push(
    `API (shu kompyuter): ${mark(report.healthLocal.ok)} ${report.healthLocal.status || ''} (${report.healthLocal.ms} ms)`,
  );
  if (report.ip) {
    lines.push(
      `API (LAN ${report.ip}): ${mark(report.healthLan.ok)} ${report.healthLan.status || ''} (${report.healthLan.ms} ms)`,
    );
  } else {
    lines.push('LAN IP topilmadi');
  }
  if (report.ports) {
    const parts = Object.entries(report.ports).map(([port, open]) => {
      if (open === null) return `${port}: ?`;
      return `${port}: ${open ? 'ochiq' : 'yopiq'}`;
    });
    lines.push(`Portlar: ${parts.join(', ')}`);
  }
  if (report.dump) {
    const mb = (report.dump.size / (1024 * 1024)).toFixed(2);
    lines.push(`Oxirgi zaxira: ${report.dump.name} (${mb} MB)`);
  } else {
    lines.push('Oxirgi zaxira: topilmadi');
  }
  if (report.state?.slot) {
    const sent =
      report.state.telegram === true
        ? 'Telegramga yuborilgan'
        : report.state.telegram === 'unconfigured'
          ? 'Telegram sozlanmagan'
          : 'Telegramga hali yuborilmagan';
    lines.push(`Zaxira slot: ${report.state.slot} — ${sent}`);
  }
  lines.push('');
  lines.push('Kirish manzillari:');
  if (report.ip) lines.push(`http://${report.ip}/`);
  lines.push('http://sevinch/');
  lines.push('http://sevinch.local/');
  return lines.join('\n');
}

export function formatNetworkStatus(report) {
  const lines = [
    'Avishifo — tarmoq holati',
    `Tekshiruv: ${formatTashkent(new Date(report.checkedAt))}`,
  ];
  lines.push(`Server IP: ${report.ip || 'yo‘q'}`);
  lines.push(
    `LAN orqali API: ${report.healthLan.ok ? 'ishlayapti' : 'ishlamayapti'} (${report.healthLan.ms} ms)`,
  );
  lines.push('');
  lines.push('Boshqa kompyuterlar shu tarmoqda bo‘lsa ochadi:');
  if (report.ip) lines.push(`• http://${report.ip}/`);
  lines.push('• http://sevinch/');
  lines.push('• http://sevinch.local/  (ba’zi Windowsda mDNS kerak)');
  lines.push('');
  if (report.stuckSyn.length) {
    lines.push('Hozir ulanishi tugamagan so‘rovlar (SynReceived):');
    for (const item of report.stuckSyn) lines.push(`• ${item}`);
    lines.push(
      'Bu odatda boshqa qurilma serverni topadi, lekin javobni to‘liq olmaydi (Wi‑Fi izolyatsiya yoki zaif tarmoq).',
    );
  } else {
    lines.push('Hozir “yopilmagan” TCP ulanishlari yo‘q.');
  }
  lines.push('');
  if (report.incompleteNeighbors.length) {
    lines.push('ARP javob bermagan manzillar:');
    for (const item of report.incompleteNeighbors) lines.push(`• ${item}`);
    lines.push('Bu qurilmalar tarmoqda ko‘rinadi, lekin barqaror ulanmagan.');
  } else {
    lines.push('ARP “Incomplete” manzillar yo‘q.');
  }
  lines.push('');
  lines.push('Agar faqat shu server ochilsa, boshqalar esa yo‘q:');
  lines.push('1) Brauzerda http (https emas) yozing');
  lines.push('2) Mehmon Wi‑Fi emas, klinika tarmog‘ida ekanini tekshiring');
  lines.push('3) To‘g‘ridan-to‘g‘ri IP bilan urinib ko‘ring');
  return lines.join('\n');
}
