// Updates the clinic server from GitHub: pull, install, build, restart.
// Run on the server as Administrator:
//   D:\Avishifo\runtime\node\node.exe scripts\clinic-update.mjs [--force]
// The clinic is offline while it builds (a few minutes). When the new version
// does not build, the previous one is rebuilt and started again.
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = process.env.CLINIC_RUNTIME_DIR || 'D:\\Avishifo\\runtime';
const TASK = 'Sevinch Avishifo';
const BRANCH = 'main';
const SERVER_PORTS = [80, 3002, 3003, 13000, 13001, 13002, 13003];
const HEALTH_URL = 'http://127.0.0.1:13001/api/v1/health';

// pnpm lives next to the portable node; git is portable too unless installed.
process.env.PATH = [
  dirname(process.execPath),
  join(RUNTIME_DIR, 'git', 'cmd'),
  process.env.PATH,
].join(delimiter);

const log = (message) => console.log(`[update] ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(command, args, { capture = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    // pnpm is pnpm.cmd on Windows, which only a shell resolves.
    shell: command === 'pnpm' && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  return capture ? result.stdout.trim() : '';
}

const git = (...args) => run('git', args, { capture: true });
const powershell = (script) =>
  run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { capture: true });

function portOpen(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

async function stopServer() {
  log('Stopping the clinic server…');
  // Disabled first: the every-minute watchdog would start it again mid-build.
  powershell(
    `Disable-ScheduledTask -TaskName '${TASK}' | Out-Null; schtasks /End /TN '${TASK}' | Out-Null`,
  );
  for (let second = 0; second < 60; second += 1) {
    const open = await Promise.all(SERVER_PORTS.map(portOpen));
    if (!open.includes(true)) return;
    await sleep(1000);
  }
  throw new Error('the clinic server did not stop within a minute');
}

function startServer() {
  log('Starting the clinic server…');
  powershell(
    `Enable-ScheduledTask -TaskName '${TASK}' | Out-Null; schtasks /Run /TN '${TASK}' | Out-Null`,
  );
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // Still starting.
    }
    await sleep(3000);
  }
  return false;
}

function build() {
  const installEnv = { ...process.env };
  // NODE_ENV=production makes pnpm skip the devDependencies the build needs.
  delete installEnv.NODE_ENV;
  // --prefer-offline: putting the previous version back must work without internet.
  run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { env: installEnv });
  // Must run while the API is stopped: Windows locks the Prisma engine it loaded.
  run('pnpm', ['--filter', '@avishifo/api', 'db:generate'], { env: installEnv });
  run(process.execPath, ['--env-file=.env', 'scripts/start-clinic.mjs', '--build-only']);
}

function envKeys(text) {
  return new Set(
    text.split(/\r?\n/).flatMap((line) => /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1] ?? []),
  );
}

async function main() {
  if (spawnSync('net', ['session'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('run this as Administrator: it stops and starts the server task');
  }
  if (git('status', '--porcelain', '--untracked-files=no')) {
    throw new Error(
      'files tracked by git were edited on this computer; commit and push or discard them first',
    );
  }

  log(`Fetching ${BRANCH} from GitHub…`);
  run('git', ['fetch', '--quiet', 'origin', BRANCH]);
  const current = git('rev-parse', 'HEAD');
  const target = git('rev-parse', `origin/${BRANCH}`);
  if (current === target && !process.argv.includes('--force')) {
    log('Already up to date.');
    return;
  }
  if (
    spawnSync('git', ['merge-base', '--is-ancestor', current, target], { cwd: root }).status !== 0
  ) {
    throw new Error(
      `this computer has commits that are not on GitHub ${BRANCH}; push or reset them first`,
    );
  }
  if (current !== target)
    console.log(git('log', '--oneline', '--no-decorate', `${current}..${target}`));

  let failure = null;
  try {
    await stopServer();
    try {
      run('git', ['merge', '--ff-only', '--quiet', target]);
      build();
    } catch (error) {
      failure = error;
      log(`The new version failed: ${error.message}`);
      log('Rebuilding the previous version…');
      run('git', ['reset', '--hard', '--quiet', current]);
      build();
    }
  } finally {
    startServer();
  }

  const healthy = await waitForHealth(5 * 60_000);
  const before = envKeys(git('show', `${current}:.env.example`));
  const added = [...envKeys(git('show', 'HEAD:.env.example'))].filter((key) => !before.has(key));
  if (added.length) log(`New settings in .env.example (check .env): ${added.join(', ')}`);

  const version = git('log', '-1', '--format=%h %s');
  if (failure) {
    log(`Update FAILED; the previous version is back: ${version}`);
    process.exitCode = 1;
  } else {
    log(`Updated to ${version}`);
  }
  if (!healthy) {
    log('The server did not report healthy within 5 minutes; see .local-run\\server.log');
    process.exitCode = 1;
  } else {
    log('The clinic server is running.');
  }
}

main().catch((error) => {
  log(`Stopped: ${error.message}`);
  process.exitCode = 1;
});
