// Serve prebuilt clinic apps locally, without compiling pages on each first visit.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendEnv = {
  ...process.env,
  NODE_ENV: 'production',
  // An empty public URL means same-origin. `||` would replace that with localhost
  // and send every other clinic computer to its own machine.
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '',
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? '',
  NEXT_PUBLIC_DISPLAY_URL: process.env.NEXT_PUBLIC_DISPLAY_URL ?? '',
  NEXT_PUBLIC_PORTAL_URL: process.env.NEXT_PUBLIC_PORTAL_URL ?? '',
};
const apps = [
  { name: 'api', url: process.env.API_URL, fallbackPort: '3001' },
  { name: 'web', url: process.env.WEB_URL, fallbackPort: '3000' },
  { name: 'display', url: process.env.DISPLAY_URL, fallbackPort: '3002' },
  { name: 'portal', url: process.env.PORTAL_URL, fallbackPort: '3003' },
].map((app) => ({ ...app, port: new URL(app.url).port || app.fallbackPort }));

const children = new Set();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function run(name, args) {
  const child = spawn('pnpm', ['--filter', `@avishifo/${name}`, ...args], {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    // Windows only resolves pnpm.cmd through a shell.
    shell: process.platform === 'win32',
    // Keep the API's configured cookie/security policy for the local HTTP host.
    env: name === 'api' ? process.env : frontendEnv,
  });
  children.add(child);
  return new Promise((resolveExit, reject) => {
    child.once('error', (error) => {
      children.delete(child);
      reject(error);
    });
    child.once('exit', (code) => {
      children.delete(child);
      resolveExit(code ?? 1);
    });
  });
}

async function checkPort(port) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', () => reject(new Error(`Port ${port} is busy. Stop the running clinic apps first.`)));
    server.listen(Number(port), () => server.close(resolveListen));
  });
}

try {
  if (process.argv.includes('--build-only')) {
    // Sequential builds avoid several compilers competing for local memory.
    for (const name of ['shared', ...apps.map((app) => app.name)]) {
      if (stopping) break;
      console.log(`Building ${name}…`);
      const code = await run(name, ['build']);
      if (code !== 0) {
        process.exitCode = code;
        stop();
        break;
      }
    }
  } else {
    // Validate all outputs/ports before starting any app.
    for (const app of apps) {
      const output = app.name === 'api' ? 'dist/main.js' : '.next/BUILD_ID';
      try {
        await access(resolve(root, 'apps', app.name, output));
      } catch {
        throw new Error(`${app.name} is not built. Run pnpm build:clinic first.`);
      }
      await checkPort(app.port);
    }
    await Promise.all(apps.map(async (app) => {
      console.log(`Starting ${app.name}: ${app.url}`);
      const args = app.name === 'api' ? ['start'] : ['exec', 'next', 'start', '-p', app.port];
      const code = await run(app.name, args);
      if (!stopping) {
        process.exitCode = code || 1;
        stop();
      }
    }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  stop();
}
