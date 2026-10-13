// Start the clinic apps using the URLs configured in the root .env.
import { spawn } from 'node:child_process';

const build = spawn('pnpm', ['--filter', '@avishifo/shared', 'build'], { stdio: 'inherit' });
const buildCode = await new Promise((resolve) => build.once('exit', resolve));
if (buildCode !== 0) process.exit(buildCode ?? 1);

const apps = [
  ['api', ['dev']],
  ['web', ['exec', 'next', 'dev', '-p', new URL(process.env.WEB_URL).port || '3000']],
  ['display', ['exec', 'next', 'dev', '-p', new URL(process.env.DISPLAY_URL).port || '3002']],
  ['portal', ['exec', 'next', 'dev', '-p', new URL(process.env.PORTAL_URL).port || '3003']],
];
const children = apps.map(([name, args]) =>
  spawn('pnpm', ['--filter', `@avishifo/${name}`, ...args], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.API_URL,
      NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || process.env.API_URL,
      NEXT_PUBLIC_DISPLAY_URL: process.env.NEXT_PUBLIC_DISPLAY_URL || process.env.DISPLAY_URL,
      NEXT_PUBLIC_PORTAL_URL: process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL,
    },
  }),
);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
}
