// This computer is the clinic server.
// Staff panel:  http://sevinch.local/   and   http://sevinch/   and   http://<LAN-IP>/
// TV screen:    http://sevinch.local:3002/
// Patient portal: http://sevinch.local:3003/
// sevinch.local is advertised with mDNS. The short name sevinch is advertised
// with LLMNR, which other Windows computers resolve without a hosts file.
// Postgres and Redis stay on this machine.
// The "Sevinch Avishifo" scheduled task starts this at boot and re-runs it every
// minute; a second copy exits at once, so the re-run only revives a dead server.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { setDefaultResultOrder } from 'node:dns';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect, createConnection, createServer as createNetServer } from 'node:net';
import { networkInterfaces, hostname } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backupFileStamp,
  backupSlot,
  formatTashkent,
  msUntilNextBackup,
} from './backup-schedule.mjs';
import { backupCaption, sendTelegramDocument, splitBackupFile } from './backup-telegram.mjs';
import {
  adminKeyboard,
  runAdminBot,
  sendTelegramText,
  serverStartedMessage,
  serverStoppedMessage,
} from './clinic-admin-bot.mjs';
import { announceA, answerA } from './lan-names.mjs';

// This clinic PC often resolves api.telegram.org to unreachable IPv6 first.
try {
  setDefaultResultOrder('ipv4first');
} catch {
  // Older Node builds ignore the hint.
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REFRESH_ENV_KEYS = new Set([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_ID',
  'CLINIC_BACKUP_TELEGRAM_CHAT_ID',
]);

function loadEnvFile({ refresh = false } = {}) {
  let text = '';
  try {
    text = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (refresh && REFRESH_ENV_KEYS.has(key)) {
      process.env[key] = value;
      continue;
    }
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}
loadEnvFile();

const runDir = join(root, '.local-run');
mkdirSync(runDir, { recursive: true });
const logPath = join(runDir, 'server.log');
const LOG_LIMIT = 50 * 1024 * 1024;

const INTERNAL = { api: 13001, web: 13000, display: 13002, portal: 13003 };
const CLINIC_NAME = 'sevinch.local';
const RUNTIME_DIR = 'D:\\Avishifo\\runtime';
const PG_DUMP = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
const BACKUP_DIR = process.env.CLINIC_BACKUP_DIR || join(RUNTIME_DIR, 'backups', 'auto');
const BACKUPS_KEPT = 30;
const pgPort = 5432;
const redisPort = 6379;
const apiDir = join(root, 'apps', 'api');

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function appendLog(text) {
  try {
    writeFileSync(logPath, text, { flag: 'a' });
  } catch {
    // Logging must not take the clinic server down.
  }
}

function rotateLog() {
  try {
    if (statSync(logPath).size < LOG_LIMIT) return;
    rmSync(`${logPath}.old`, { force: true });
    renameSync(logPath, `${logPath}.old`);
  } catch {
    // A locked log is rotated on the next check.
  }
}

function say(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  appendLog(line);
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function ipv4Addresses() {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
        found.push(entry);
    }
  }
  return found;
}

function lanAddress() {
  const found = ipv4Addresses().map((entry) => entry.address);
  return (
    found.find((address) => address.startsWith('192.168.') || address.startsWith('10.')) ||
    found[0] ||
    '127.0.0.1'
  );
}

const ipToInt = (address) =>
  address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);

/** Read on every query: the LAN address can change or appear only after boot. */
function addressFor(remoteAddress) {
  const remote = ipToInt(remoteAddress);
  const sameSubnet = ipv4Addresses().find((entry) => {
    const mask = ipToInt(entry.netmask);
    return (ipToInt(entry.address) & mask) >>> 0 === (remote & mask) >>> 0;
  });
  return sameSubnet ? sameSubnet.address : lanAddress();
}

function publishHosts() {
  if (process.platform !== 'win32') return;
  const hostsPath = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'drivers',
    'etc',
    'hosts',
  );
  const marker = '# sevinch-avishifo';
  // Loopback keeps the name working on this computer even while the LAN is down.
  const wanted = `127.0.0.1 ${CLINIC_NAME} sevinch ${marker}`;
  try {
    const current = existsSync(hostsPath) ? readFileSync(hostsPath, 'utf8') : '';
    const lines = current.split(/\r?\n/);
    if (lines.includes(wanted)) return;
    const kept = lines
      .filter((line) => !line.includes(marker))
      .filter((line) => line.trim().length > 0);
    kept.push(wanted);
    writeFileSync(hostsPath, `${kept.join('\r\n')}\r\n`);
    say(`hosts: 127.0.0.1 ${CLINIC_NAME} sevinch`);
  } catch (error) {
    say(`hosts update skipped: ${error.message}`);
  }
}

const MDNS_NAMES = [CLINIC_NAME, `${CLINIC_NAME}.local`];
const LLMNR_NAME = 'sevinch';

let mdns = null;
let llmnr = null;
let announcedIp = '';

function joinMulticast(socket) {
  for (const entry of ipv4Addresses()) {
    // Windows drops the membership when the cable or Wi-Fi link goes down, and
    // the link can bounce between two checks, so leave and join every time.
    try {
      socket.dropMembership('224.0.0.251', entry.address);
    } catch {
      // Not joined yet.
    }
    try {
      socket.addMembership('224.0.0.251', entry.address);
    } catch {
      // The interface is not ready yet; the next check joins it.
    }
  }
  const ip = lanAddress();
  if (ip !== announcedIp) {
    announcedIp = ip;
    say(ip === '127.0.0.1' ? 'Network: no LAN connection yet' : `mDNS: ${CLINIC_NAME} -> ${ip}`);
  }
}

function publishMdns() {
  const sockets = [];
  let timer = null;
  const closeAll = () => {
    clearInterval(timer);
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  };
  const onQuery = (socket, multicast) => (message, remote) => {
    const ip = addressFor(remote.address);
    const packet = answerA(message, MDNS_NAMES, ip, { flags: 0x8400, ttl: 120, cacheFlush: true });
    if (!packet) return;
    // Callbacks keep "network unreachable" during a link drop from killing the socket.
    socket.send(packet, remote.port, remote.address, () => {});
    socket.send(packet, 5353, multicast, () => {});
  };
  let retried = false;
  const onError = (error) => {
    if (retried) return;
    retried = true;
    say(`mDNS error: ${error.message}. Retrying in 10s.`);
    closeAll();
    if (!stopping) setTimeout(() => (mdns = publishMdns()), 10_000);
  };
  const ipv4 = createSocket({ type: 'udp4', reuseAddr: true });
  sockets.push(ipv4);
  ipv4.on('error', onError);
  ipv4.on('message', onQuery(ipv4, '224.0.0.251'));
  ipv4.bind(5353, () => {
    try {
      ipv4.setMulticastTTL(255);
    } catch {
      // TTL is a hint; queries are still answered.
    }
    joinMulticast(ipv4);
    const ip = lanAddress();
    const announcement =
      ip === '127.0.0.1'
        ? null
        : announceA(CLINIC_NAME, ip, { flags: 0x8400, ttl: 120, cacheFlush: true });
    if (announcement) ipv4.send(announcement, 5353, '224.0.0.251', () => {});
    timer = setInterval(() => {
      joinMulticast(ipv4);
      const ip = lanAddress();
      if (ip === '127.0.0.1') return;
      const announcement = announceA(CLINIC_NAME, ip, { flags: 0x8400, ttl: 120, cacheFlush: true });
      if (announcement) ipv4.send(announcement, 5353, '224.0.0.251', () => {});
    }, 30_000);
  });
  // Windows often asks for .local over IPv6 only. The DNS client already holds
  // this port, so the socket shares it.
  try {
    const ipv6 = createSocket({ type: 'udp6', reuseAddr: true });
    sockets.push(ipv6);
    ipv6.on('error', (error) => say(`mDNS IPv6 skipped: ${error.message}`));
    ipv6.on('message', onQuery(ipv6, 'ff02::fb'));
    ipv6.bind(5353, () => {
      try {
        ipv6.addMembership('ff02::fb');
      } catch {
        // No IPv6 link; IPv4 answers still cover the LAN.
      }
    });
  } catch (error) {
    say(`mDNS IPv6 skipped: ${error.message}`);
  }
  return { close: closeAll };
}

let llmnrLogged = false;

function publishLlmnr() {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (error) => {
    say(`LLMNR error: ${error.message}. Retrying in 10s.`);
    try {
      socket.close();
    } catch {
      // Already closed.
    }
    if (!stopping) setTimeout(() => (llmnr = publishLlmnr()), 10_000);
  });
  socket.on('message', (message, remote) => {
    const ip = addressFor(remote.address);
    const packet = answerA(message, [LLMNR_NAME], ip, { flags: 0x8000, ttl: 30, cacheFlush: false });
    if (!packet) return;
    socket.send(packet, remote.port, remote.address, () => {});
    if (!llmnrLogged && ip !== '127.0.0.1') {
      llmnrLogged = true;
      say(`LLMNR: ${LLMNR_NAME} -> ${ip}`);
    }
  });
  socket.bind(5355, () => {
    try {
      socket.addMembership('224.0.0.252');
    } catch {
      // Joining can fail before the link is up; the next retry joins it.
    }
    say(`LLMNR: ${LLMNR_NAME} on UDP 5355`);
  });
  return socket;
}

function ensureLanFirewall() {
  if (process.platform !== 'win32') return;
  const rules = [
    ['Sevinch Avishifo', 'TCP', '80,3002,3003'],
    ['Sevinch Avishifo mDNS', 'UDP', '5353'],
    ['Sevinch Avishifo LLMNR', 'UDP', '5355'],
  ];
  for (const [name, protocol, ports] of rules) {
    const shown = spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (shown.status === 0) continue;
    const added = spawnSync(
      'netsh',
      [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        `name=${name}`,
        'dir=in',
        'action=allow',
        `protocol=${protocol}`,
        `localport=${ports}`,
        'profile=any',
        'remoteip=any',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (added.status === 0) {
      say(`Firewall: ${name} ${protocol} ${ports}`);
      continue;
    }
    say(`Firewall rule ${name} was not added.`);
  }
}

function corsOrigins(ip) {
  const names = new Set([
    CLINIC_NAME,
    'sevinch',
    hostname().toLowerCase(),
    ip,
    '127.0.0.1',
    'localhost',
  ]);
  const origins = [];
  for (const name of names) {
    origins.push(`http://${name}`, `http://${name}:3002`, `http://${name}:3003`);
  }
  return origins.join(',');
}

function resolveExisting(paths) {
  const found = paths.find((path) => existsSync(path));
  if (!found) throw new Error(`Missing ${paths[0]}`);
  return found;
}

function pipeChild(child, name) {
  const write = (chunk) => {
    const text = `[${name}] ${chunk}`;
    process.stdout.write(text);
    appendLog(text);
  };
  child.stdout?.on('data', write);
  child.stderr?.on('data', write);
}

const children = new Set();
let stopping = false;

function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

/** Keeps one app running: restarts it after every exit, backing off while it keeps failing. */
function supervise(name, launch, beforeRestart) {
  let quickExits = 0;
  const run = () => {
    if (stopping) return;
    const startedAt = Date.now();
    let child;
    try {
      child = launch();
    } catch (error) {
      say(`${name} could not start: ${error.message}. Retrying in 30s.`);
      setTimeout(run, 30_000);
      return;
    }
    children.add(child);
    pipeChild(child, name);
    let ended = false;
    const restart = (reason) => {
      if (ended) return;
      ended = true;
      children.delete(child);
      if (stopping) return;
      quickExits = Date.now() - startedAt > 60_000 ? 1 : quickExits + 1;
      const delay = Math.min(3000 * 2 ** (quickExits - 1), 30_000);
      say(`${name} stopped (${reason}). Restarting in ${delay / 1000}s.`);
      // Called at restart time, not on exit: the last output lines can arrive after 'exit'.
      setTimeout(() => {
        beforeRestart?.(quickExits);
        run();
      }, delay);
    };
    child.once('error', (error) => restart(error.message));
    child.once('exit', (code, signal) => restart(code ?? signal ?? 'signal'));
  };
  run();
}

function launcher(command, args, cwd, env) {
  return () =>
    spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function targetPort(url, pagePort) {
  const path = (url || '/').split('?')[0];
  if (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/socket.io' ||
    path.startsWith('/socket.io/')
  ) {
    return INTERNAL.api;
  }
  return pagePort;
}

const STARTING_PAGE = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>AviShifo</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding-top:15vh;color:#334155"><h2>Klinika serveri ishga tushmoqda…</h2><p>Sahifa bir necha soniyada o‘zi yangilanadi.</p></body></html>`;

function proxyHttp(req, res, port) {
  const headers = {
    ...req.headers,
    'x-forwarded-proto': 'http',
    'x-forwarded-host': req.headers.host,
  };
  const upstream = httpRequest(
    { hostname: '127.0.0.1', port, path: req.url, method: req.method, headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // A page opened while an app restarts reloads itself instead of staying on an error.
    if (req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(503, {
        'content-type': 'text/html; charset=utf-8',
        'retry-after': '5',
        'cache-control': 'no-store',
      });
      res.end(STARTING_PAGE);
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Clinic service is still starting');
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, port) {
  const upstream = netConnect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) lines.push(`${key}: ${item}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
}

function listenGateway(publicPort, pagePort) {
  const server = createServer((req, res) => proxyHttp(req, res, targetPort(req.url, pagePort)));
  server.on('upgrade', (req, socket, head) =>
    proxyUpgrade(req, socket, head, targetPort(req.url, pagePort)),
  );
  server.on('listening', () => say(`Listening on 0.0.0.0:${publicPort}`));
  server.on('error', (error) => {
    if (server.listening || stopping) return;
    say(`Port ${publicPort} failed: ${error.message}. Retrying in 5s.`);
    setTimeout(() => server.listen(publicPort, '0.0.0.0'), 5000);
  });
  server.listen(publicPort, '0.0.0.0');
  return server;
}

function runProcess(
  command,
  args,
  { cwd, env = process.env, name = 'prepare', timeoutMs = 0 } = {},
) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    pipeChild(child, name);
    const timer = timeoutMs ? setTimeout(() => stopChild(child), timeoutMs) : null;
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolveExit(code);
    };
    child.once('error', (error) => {
      say(`${name} could not start: ${error.message}`);
      finish(1);
    });
    child.once('close', (code) => finish(code ?? 1));
  });
}

function portOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const done = (open) => {
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(2000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** No deadline: after a power cut PostgreSQL can spend minutes replaying its journal. */
async function waitForPort(port, label) {
  const started = Date.now();
  let notice = 60_000;
  while (!(await portOpen(port))) {
    if (Date.now() - started > notice) {
      say(`Still waiting for ${label} on 127.0.0.1:${port}`);
      notice += 5 * 60_000;
    }
    await sleep(1000);
  }
}

function acquireSingleInstance() {
  const address =
    process.platform === 'win32'
      ? { path: '\\\\.\\pipe\\sevinch-avishifo-server' }
      : { port: 13999, host: '127.0.0.1' };
  return new Promise((resolveLock) => {
    const lock = createNetServer((connection) => connection.destroy());
    lock.once('error', () => resolveLock(false));
    lock.listen(address, () => resolveLock(true));
  });
}

/** Apps orphaned by a killed server still hold the internal ports; only our own runtime is touched. */
function stopLeftoverProcesses() {
  if (process.platform !== 'win32') return Promise.resolve();
  const ports = [INTERNAL.api, INTERNAL.web, INTERNAL.display, INTERNAL.portal, redisPort].join(
    ',',
  );
  const script =
    `Get-NetTCPConnection -State Listen -LocalPort ${ports} -ErrorAction SilentlyContinue | ` +
    'Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { ' +
    '$p = Get-Process -Id $_ -ErrorAction SilentlyContinue; ' +
    `if ($p.Path -and $p.Path.StartsWith('${RUNTIME_DIR}\\', 'OrdinalIgnoreCase')) { $p.Id } }`;
  return new Promise((resolveDone) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => ps.kill(), 20_000);
    ps.stdout.on('data', (chunk) => {
      out += chunk;
    });
    ps.once('error', () => {
      clearTimeout(timer);
      resolveDone();
    });
    ps.once('close', () => {
      clearTimeout(timer);
      const pids = out
        .split(/\s+/)
        .filter((value) => /^\d+$/.test(value) && Number(value) !== process.pid);
      for (const pid of pids)
        spawnSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      if (pids.length) say(`Stopped processes left from the previous run: ${pids.join(', ')}`);
      resolveDone();
    });
  });
}

function findRedisExe() {
  const base = join(RUNTIME_DIR, 'redis');
  const direct = join(base, 'redis-server.exe');
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(base, entry.name, 'redis-server.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Redis was not installed in ${base}`);
}

const redisDataDir = join(runDir, 'redis-data');
const REDIS_DATA_ERROR =
  /Bad file format|Unrecoverable error|Short read|Unexpected EOF|Wrong signature|Invalid AOF manifest|corrupt/i;

function startRedis() {
  mkdirSync(redisDataDir, { recursive: true });
  let output = '';
  supervise(
    'redis',
    () => {
      output = '';
      const child = spawn(
        findRedisExe(),
        [
          '--bind',
          '127.0.0.1',
          '--port',
          String(redisPort),
          '--dir',
          redisDataDir,
          '--dbfilename',
          'dump.rdb',
          '--appendonly',
          'yes',
          '--protected-mode',
          'yes',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      const remember = (chunk) => {
        output = (output + chunk).slice(-4000);
      };
      child.stdout?.on('data', remember);
      child.stderr?.on('data', remember);
      return child;
    },
    (quickExits) => {
      if (quickExits < 2 || !REDIS_DATA_ERROR.test(output)) return;
      // Redis only holds the notification and reminder queues; patient data lives in PostgreSQL.
      const aside = `${redisDataDir}-broken-${stamp()}`;
      try {
        renameSync(redisDataDir, aside);
        mkdirSync(redisDataDir, { recursive: true });
        say(
          `Redis could not read its files after a crash; moved them to ${aside} and started with empty queues.`,
        );
      } catch (error) {
        say(`Could not move the damaged Redis files: ${error.message}`);
      }
    },
  );
}

async function migrateDatabase(prismaCli) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (
      (await runProcess(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: apiDir })) === 0
    )
      return true;
    say(`Database migration failed (attempt ${attempt} of 5).`);
    if (attempt < 5) await sleep(5000 * attempt);
  }
  return false;
}

let backupRunning = false;
const BACKUP_STATE = join(BACKUP_DIR, 'backup-state.json');

function isDumpName(name) {
  return /^avishifo-\d{8}-\d{4}\.dump$/.test(name);
}

function readBackupState() {
  try {
    const parsed = JSON.parse(readFileSync(BACKUP_STATE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeBackupState(state) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = `${BACKUP_STATE}.part`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, BACKUP_STATE);
}

function removeDump(name) {
  rmSync(join(BACKUP_DIR, name), { force: true });
  for (const extra of readdirSync(BACKUP_DIR)) {
    if (extra.startsWith(`${name}.`)) rmSync(join(BACKUP_DIR, extra), { force: true });
  }
}

async function createDump() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  for (const name of readdirSync(BACKUP_DIR)) {
    if (name.endsWith('.dump.part')) rmSync(join(BACKUP_DIR, name), { force: true });
  }
  const db = new URL(process.env.DATABASE_URL ?? '');
  const file = join(BACKUP_DIR, `avishifo-${backupFileStamp()}.dump`);
  const code = await runProcess(
    PG_DUMP,
    [
      '--format=custom',
      '--host',
      db.hostname,
      '--port',
      db.port || '5432',
      '--username',
      decodeURIComponent(db.username),
      '--dbname',
      db.pathname.slice(1),
      '--file',
      `${file}.part`,
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(db.password) },
      name: 'backup',
      timeoutMs: 30 * 60_000,
    },
  );
  if (code !== 0) {
    rmSync(`${file}.part`, { force: true });
    say(`Database backup failed (exit ${code}); trying again soon.`);
    return null;
  }
  renameSync(`${file}.part`, file);
  say(`Database backup saved: ${file}`);
  const all = readdirSync(BACKUP_DIR).filter(isDumpName).sort();
  for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) {
    if (old === basename(file)) continue;
    removeDump(old);
  }
  const uploads = resolve(root, process.env.STORAGE_LOCAL_DIR || 'uploads');
  if (process.platform === 'win32' && existsSync(uploads)) {
    // /E without /MIR never deletes, so a file removed by mistake stays in the backup.
    const copied = await runProcess(
      'robocopy',
      [uploads, join(BACKUP_DIR, 'uploads'), '/E', '/XO', '/R:2', '/W:5', '/NP', '/NFL', '/NDL', '/NJH', '/NJS'],
      { name: 'backup' },
    );
    if (copied >= 8) say(`Uploads backup failed (robocopy exit ${copied}).`);
  }
  return file;
}

function backupEnv(name) {
  let value = process.env[name]?.trim() ?? '';
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function adminIds() {
  return backupEnv('TELEGRAM_ADMIN_CHAT_ID')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const LIFECYCLE_PATH = join(runDir, 'server-lifecycle.json');

function readLifecycle() {
  try {
    return JSON.parse(readFileSync(LIFECYCLE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeLifecycle(state) {
  try {
    writeFileSync(LIFECYCLE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    say(`Lifecycle state not saved: ${error.message}`);
  }
}

async function notifyAdmins(text) {
  loadEnvFile({ refresh: true });
  const token = backupEnv('TELEGRAM_BOT_TOKEN');
  const admins = adminIds();
  if (!token || !admins.length) return false;
  let sent = 0;
  for (const adminId of admins) {
    try {
      await sendTelegramText({
        token,
        chatId: adminId,
        text,
        replyMarkup: adminKeyboard(),
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      say(`Admin notify failed: ${message}`);
    }
  }
  return sent > 0;
}


async function deliverDump(file, slot, alreadySent, dumpedAt) {
  const token = backupEnv('TELEGRAM_BOT_TOKEN');
  const chatId = backupEnv('CLINIC_BACKUP_TELEGRAM_CHAT_ID');
  const takenAt = dumpedAt ? new Date(dumpedAt) : new Date();
  if (!token || !chatId) {
    say(
      'Telegram backup is not configured (TELEGRAM_BOT_TOKEN or CLINIC_BACKUP_TELEGRAM_CHAT_ID). The dump stays on disk.',
    );
    writeBackupState({
      slot,
      file,
      dumpedAt: takenAt.toISOString(),
      partsSent: alreadySent,
      telegram: 'unconfigured',
    });
    return true;
  }
  const parts = await splitBackupFile(file);
  for (let index = alreadySent; index < parts.length; index += 1) {
    try {
      await sendTelegramDocument({
        token,
        chatId,
        filePath: parts[index],
        caption: backupCaption({
          slot,
          takenAt,
          fileName: basename(file),
          part: index + 1,
          parts: parts.length,
        }),
      });
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      writeBackupState({
        slot,
        file,
        dumpedAt: takenAt.toISOString(),
        partsSent: index,
        telegram: false,
      });
      return false;
    }
    writeBackupState({
      slot,
      file,
      dumpedAt: takenAt.toISOString(),
      partsSent: index + 1,
      telegram: false,
    });
  }
  writeBackupState({
    slot,
    file,
    dumpedAt: takenAt.toISOString(),
    partsSent: parts.length,
    telegram: true,
    sentAt: new Date().toISOString(),
  });
  say(`Database backup sent to Telegram for ${slot}.`);
  return true;
}

/**
 * One dump for the current 02:00 Asia/Tashkent slot.
 * If the computer was off at 02:00, the first start afterwards sends that slot.
 */
async function backupIfDue() {
  if (backupRunning || stopping || !existsSync(PG_DUMP)) return false;
  backupRunning = true;
  try {
    loadEnvFile({ refresh: true });
    const slot = backupSlot();
    const state = readBackupState();
    const token = backupEnv('TELEGRAM_BOT_TOKEN');
    const chatId = backupEnv('CLINIC_BACKUP_TELEGRAM_CHAT_ID');
    const configured = Boolean(token && chatId);
    if (state?.slot === slot && state.telegram === true) return true;
    if (state?.slot === slot && state.telegram === 'unconfigured' && !configured) return true;

    let file = state?.slot === slot && state.file && existsSync(state.file) ? state.file : null;
    if (!file) {
      file = await createDump();
      if (!file) return false;
      writeBackupState({
        slot,
        file,
        dumpedAt: new Date().toISOString(),
        partsSent: 0,
        telegram: false,
      });
    }
    const alreadySent = state?.slot === slot && state.file === file ? Number(state.partsSent) || 0 : 0;
    const dumpedAt = state?.slot === slot && state.file === file ? state.dumpedAt : null;
    return await deliverDump(file, slot, alreadySent, dumpedAt);
  } catch (error) {
    say(`Database backup failed: ${error.message}`);
    return false;
  } finally {
    backupRunning = false;
  }
}

async function backupScheduler() {
  await sleep(20_000);
  while (!stopping) {
    const done = await backupIfDue();
    if (stopping) return;
    const wait = done ? msUntilNextBackup() : 15 * 60_000;
    await sleep(Math.min(Math.max(wait, 15_000), 15 * 60_000));
  }
}

async function adminBotScheduler() {
  await sleep(8_000);
  while (!stopping) {
    loadEnvFile({ refresh: true });
    const token = backupEnv('TELEGRAM_BOT_TOKEN');
    const admins = adminIds();
    if (!token || !admins.length) {
      say('Admin Telegram bot is not configured (TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID).');
      await sleep(15 * 60_000);
      continue;
    }
    try {
      await runAdminBot({
        token,
        adminIds: admins,
        backupDir: BACKUP_DIR,
        shouldStop: () => stopping,
        log: say,
        onReady: async () => {
          say(`Admin Telegram bot ready for ${admins.join(',')}.`);
        },
      });
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
    if (!stopping) await sleep(5_000);
  }
}

process.env.CORS_ORIGINS = corsOrigins(lanAddress());
process.env.API_HOST = '127.0.0.1';
process.env.API_PORT = String(INTERNAL.api);
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

let servers = [];

async function main() {
  if (!(await acquireSingleInstance())) {
    say('Another copy of the clinic server is already running; this one exits.');
    process.exit(0);
  }
  await stopLeftoverProcesses();
  publishHosts();
  ensureLanFirewall();
  mdns = publishMdns();
  llmnr = publishLlmnr();
  // Gateways first: while the rest starts, browsers get a page that reloads itself.
  servers = [
    listenGateway(80, INTERNAL.web),
    listenGateway(3002, INTERNAL.display),
    listenGateway(3003, INTERNAL.portal),
  ];

  await waitForPort(pgPort, 'PostgreSQL');
  say(`PostgreSQL ready on 127.0.0.1:${pgPort}`);
  startRedis();
  await waitForPort(redisPort, 'Redis');
  say(`Redis ready on 127.0.0.1:${redisPort}`);

  const prismaCli = resolveExisting([
    join(apiDir, 'node_modules', 'prisma', 'build', 'index.js'),
    join(root, 'node_modules', 'prisma', 'build', 'index.js'),
  ]);
  if (!(await migrateDatabase(prismaCli))) {
    say('Database migration keeps failing; starting the clinic on the current schema.');
  }

  const nextBin = (app) =>
    resolveExisting([
      join(root, 'apps', app, 'node_modules', 'next', 'dist', 'bin', 'next'),
      join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
    ]);
  const appEnv = { ...process.env };
  supervise('api', launcher(process.execPath, ['dist/main.js'], apiDir, appEnv));
  // 0.0.0.0 avoids Next proxying the request back to itself when the browser
  // host is sevinch.local. The firewall does not open these internal ports.
  const nextArgs = (app, port) => [nextBin(app), 'start', '-H', '0.0.0.0', '-p', String(port)];
  for (const [app, port] of [
    ['web', INTERNAL.web],
    ['display', INTERNAL.display],
    ['portal', INTERNAL.portal],
  ]) {
    supervise(
      app,
      launcher(process.execPath, nextArgs(app, port), join(root, 'apps', app), appEnv),
    );
  }

  const ip = lanAddress();
  say(`Clinic panel: http://${CLINIC_NAME}/  and  http://${ip}/`);
  say(`TV: http://${CLINIC_NAME}:3002/   Portal: http://${CLINIC_NAME}:3003/`);

  const previous = readLifecycle();
  const unexpected = Boolean(previous?.running && previous.cleanShutdown === false);
  const startedAt = new Date();
  writeLifecycle({
    running: true,
    cleanShutdown: false,
    startedAt: startedAt.toISOString(),
    ip,
  });
  void notifyAdmins(
    serverStartedMessage({
      when: formatTashkent(startedAt),
      ip,
      unexpected,
    }),
  ).then((ok) => {
    if (ok) say(unexpected ? 'Admin notified: unexpected restart.' : 'Admin notified: server started.');
  });

  void backupScheduler();
  void adminBotScheduler();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  say('Stopping clinic server...');
  const stoppedAt = new Date();
  try {
    await Promise.race([
      notifyAdmins(serverStoppedMessage({ when: formatTashkent(stoppedAt) })),
      sleep(12_000),
    ]);
    writeLifecycle({
      running: false,
      cleanShutdown: true,
      stoppedAt: stoppedAt.toISOString(),
      ip: lanAddress(),
    });
  } catch (error) {
    say(`Shutdown notify failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const server of servers) server.close();
  try {
    mdns?.close();
  } catch {
    // Already closed.
  }
  try {
    llmnr?.close();
  } catch {
    // Already closed.
  }
  for (const child of children) stopChild(child);
  process.exit(process.exitCode ?? 0);
}

process.stdout.on('error', () => {});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
// The gateways and the supervisor hold no state worth dying for; log and keep serving.
process.on('uncaughtException', (error) =>
  say(`Unexpected error: ${error.stack || error.message}`),
);
process.on('unhandledRejection', (reason) =>
  say(`Unexpected error: ${reason instanceof Error ? reason.stack : String(reason)}`),
);
setInterval(rotateLog, 60_000).unref();

main().catch((error) => {
  const text =
    error instanceof Error
      ? error.stack || error.message
      : String(error ?? 'Clinic server stopped');
  say(text);
  process.exitCode = 1;
  void shutdown();
});
