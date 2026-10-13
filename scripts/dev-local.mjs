// Local dev services WITHOUT Docker: embedded PostgreSQL 16 + Redis.
// Usage: pnpm dev:services   (keeps running; Ctrl+C stops both)
// Ports come from repo-root .env (DATABASE_URL / REDIS_URL); override with
// LOCAL_PG_PORT / LOCAL_REDIS_PORT env vars if needed.
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.local-run', 'pg16');
const firstRun = !existsSync(join(dataDir, 'PG_VERSION'));

/** Read a KEY=value line from .env (no dependency on dotenv). */
function envFileValue(key) {
  try {
    const env = readFileSync(join(root, '.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function portFromUrl(url, fallback) {
  try {
    return Number(new URL(url).port || fallback);
  } catch {
    return fallback;
  }
}

const pgPort = Number(
  process.env.LOCAL_PG_PORT ?? portFromUrl(envFileValue('DATABASE_URL') ?? '', 5432),
);
const redisPort = Number(
  process.env.LOCAL_REDIS_PORT ?? portFromUrl(envFileValue('REDIS_URL') ?? '', 6379),
);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'avishifo',
  password: 'avishifo',
  port: pgPort,
  persistent: true,
});

const redis = new RedisMemoryServer({
  instance: { port: redisPort },
  // Redis 7 matches docker-compose and builds without Redis 8's optional modules.
  binary: { version: '7.4.0' },
  autoStart: false,
});

async function main() {
  if (firstRun) {
    console.log('[dev-local] initialising PostgreSQL data dir...');
    await pg.initialise();
  }
  await pg.start();
  if (firstRun) {
    await pg.createDatabase('avishifo');
  }
  console.log('[dev-local] PostgreSQL 16 ready on port', pgPort);

  await redis.start();
  console.log('[dev-local] Redis ready on port', await redis.getPort());
  console.log(
    `[dev-local] DATABASE_URL=postgresql://avishifo:avishifo@localhost:${pgPort}/avishifo`,
  );
  console.log(`[dev-local] REDIS_URL=redis://localhost:${redisPort}`);
  console.log('[dev-local] Press Ctrl+C to stop.');
}

async function shutdown() {
  console.log('\n[dev-local] stopping...');
  await Promise.allSettled([pg.stop(), redis.stop()]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (err) => {
  console.error('[dev-local] failed:', err?.message ?? err);
  await Promise.allSettled([pg.stop(), redis.stop()]);
  process.exit(1);
});
